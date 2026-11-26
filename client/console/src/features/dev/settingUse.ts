import type { Json, Obj } from "./api";
import { objs, str } from "./model";

/**
 * Where a task script reads its settings (配置项), worked out from the text alone: each `按设置 x` with the values
 * written under it, and each `{x}` in a number's place. The workbench uses it to show a setting beside the line, to
 * flag a wrong value before the server's check comes back, and on 配置项 to say which value is handled where.
 * It follows the engine's reading (TaskScript.kt): indentation makes the tree, `#` starts a comment except in a colour
 * point, and `{名}` under `逐个 名 …` is that loop's value, not a setting.
 */

/** One value line under a `按设置`. */
export interface ReadCase { line: number; col: number; len: number; text: string; quoted: boolean }
/** A `按设置 x` (with its value lines), or an `{x}` standing where a number goes. */
export type SettingRead =
  | { kind: "branch"; field: string; line: number; col: number; len: number; cases: ReadCase[] }
  | { kind: "number"; field: string; line: number; col: number; len: number; role: string; fallback: string | null;
      /** The statement word and the unit after the braces (秒, 次, 步, or ""), which say what the number may be. */
      head: string; unit: string };
/** Braces where a number goes that name no setting (`{}`, `{a b}`): the engine says how to write one. */
export interface BadBrace { line: number; col: number; len: number; head: string; unit: string }
export interface ScriptReads { reads: SettingRead[]; calls: { line: number; snippet: string }[]; bad: BadBrace[] }

/** `{x}` or `{x|3}` (the setting x, 3 when it has no value): the engine's SETTING_REF, matched against a whole `{…}`. */
export const SETTING_REF = /^\{\s*([^{}|\s]+)\s*(?:\|\s*([^{}|\s]*)\s*)?\}$/;

/** A line's text without its comment, as the engine strips it. */
export function stripComment(raw: string): string {
  let quote: string | null = null;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (quote) { if (c === quote || (quote === "“" && c === "”")) quote = null; }
    else if (c === "\"" || c === "“") quote = c;
    else if (c === "#" && !(/(?:^|[\s@])\d+[,，]\d+$/.test(raw.slice(0, i)) && /^#[0-9A-Fa-f]{6}(?:\s|$)/.test(raw.slice(i)))) return raw.slice(0, i);
  }
  return raw;
}

/** Whether [at] in [text] is inside a quoted text. */
function inQuote(text: string, at: number): boolean {
  let quote: string | null = null;
  for (let i = 0; i < at; i++) { const c = text[i]; if (quote) { if (c === quote || (quote === "“" && c === "”")) quote = null; } else if (c === "\"" || c === "“") quote = c; }
  return quote !== null;
}
const indentOf = (s: string) => s.length - s.trimStart().length;

/** What a number in this place does, from the line's statement and the unit after it. */
function roleOf(text: string, after: string): string {
  const head = text.trim().split(/\s+/)[0];
  if (/^\s*秒/.test(after)) return head === "等待" ? "等待秒数" : head === "长等待" ? "看门狗秒数" : "最多秒数";
  if (/^\s*步/.test(after)) return "最多步数";
  if (/^\s*次/.test(after)) return head === "反复" ? "反复次数" : head === "直到" ? "直到次数" : head === "点" ? "点击次数" : "次数";
  return "数值";
}

/** Every setting read in [script], and every snippet it calls (`用 片段`), by line (1-based) and column. */
export function readsOf(script: string): ScriptReads {
  const raw = script.split("\n");
  const lines = raw.map((r) => { const t = stripComment(r); return { text: t, indent: indentOf(t), blank: !t.trim() }; });
  const reads: SettingRead[] = []; const calls: ScriptReads["calls"] = []; const bad: BadBrace[] = [];
  // The 逐个 loops around the line, innermost last: their names in {…} are values, not settings.
  const loops: { indent: number; name: string }[] = [];
  lines.forEach((l, i) => {
    if (l.blank) return;
    while (loops.length && loops[loops.length - 1].indent >= l.indent) loops.pop();
    const t = l.text;
    const each = /^\s*逐个\s+(\S+)\s+在\s/.exec(t);
    const call = /^\s*用\s+([^\s#]+)/.exec(t);
    if (call) calls.push({ line: i + 1, snippet: call[1] });
    const branch = /^(\s*按设置\s+)(\S+)\s*$/.exec(t);
    if (branch) {
      const cases: ReadCase[] = [];
      let child = -1;
      for (let j = i + 1; j < lines.length; j++) {
        const c = lines[j]; if (c.blank) continue;
        if (c.indent <= l.indent) break;
        if (child < 0) child = c.indent;
        if (c.indent !== child) continue;
        const v = c.text.trim();
        const q = /^["“](.*)["”]$/.exec(v);
        cases.push({ line: j + 1, col: c.indent, len: v.length, text: q ? q[1] : v, quoted: !!q });
      }
      reads.push({ kind: "branch", field: branch[2], line: i + 1, col: branch[1].length, len: branch[2].length, cases });
    }
    const head = t.trim().split(/\s+/)[0];
    for (const m of t.matchAll(/\{[^{}]*\}/g)) {
      if (inQuote(t, m.index!)) continue;
      const after = t.slice(m.index! + m[0].length);
      const unit = /^\s*(秒|次|步)/.exec(after)?.[1] ?? "";
      const ref = SETTING_REF.exec(m[0]);
      if (!ref) { if (unit) bad.push({ line: i + 1, col: m.index!, len: m[0].length, head, unit }); continue; }
      const name = ref[1];
      // Inside 逐个 名, {名} and an expression naming 名 as one of its terms are the loop's value (as the engine unrolls it).
      if (loops.some((x) => name === x.name || name.split(/[^\p{L}\p{N}_]+/u).includes(x.name)) || /^[-\d+*\s]+$/.test(name) || /[+*]/.test(name)) continue;
      reads.push({ kind: "number", field: name, line: i + 1, col: m.index! + m[0].indexOf(name, 1), len: name.length, role: roleOf(t, after),
        fallback: ref[2] ? ref[2] : null, head, unit });
    }
    if (each) loops.push({ indent: l.indent, name: each[1] });
  });
  return { reads, calls, bad };
}

export const isNumberField = (f: Obj) => f.widget === "NUMBER" || f.widget === "RANGE";
const decimal = (v: unknown): number | null => {
  const t = typeof v === "number" ? String(v) : typeof v === "string" ? v.trim() : "";
  return /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(t) ? Number(t) : null;
};
/** Whether a `{x}` can read [f] as a number: a number, a range, or a single choice whose options are all numbers (the engine's readsAsNumber). */
export const readsAsNumber = (f: Obj) => isNumberField(f) ||
  (f.widget === "SINGLE_CHOICE" && objs(f.options).length > 0 && objs(f.options).every((o) => decimal(o.value) !== null));
/** The values a setting can take that a branch should handle: a switch's 开/关, a single choice's options; else none. */
export function valuesOf(f: Obj): { value: Json; label: string; word: string }[] {
  if (f.widget === "SWITCH") return [{ value: true, label: "开", word: "开" }, { value: false, label: "关", word: "关" }];
  if (f.widget === "SINGLE_CHOICE" || f.widget === "MULTI_CHOICE") return objs(f.options).map((o) => ({ value: o.value as Json, label: str(o.label) ?? String(o.value), word: String(o.value) }));
  return [];
}
/** What a value line means for [f] (as the engine reads it): a value, 其他, 没有值, or null when it can match nothing. */
export function caseValue(f: Obj | undefined, c: ReadCase): { value?: Json; otherwise?: true; missing?: true } | null {
  if (c.quoted) return { value: c.text };
  if (c.text === "其他") return { otherwise: true };
  if (c.text === "没有值") return { missing: true };
  if (!f) return { value: c.text };
  if (f.widget === "SWITCH") return c.text === "开" ? { value: true } : c.text === "关" ? { value: false } : null;
  if (isNumberField(f)) return /^-?\d+(\.\d+)?$/.test(c.text) ? { value: Number(c.text) } : null;
  return { value: c.text };
}

/** A problem found on the spot, at a line's column range; the server's check replaces it when it comes back. */
export interface LocalProblem { line: number; col: number; len: number; severity: "error" | "warning"; reason: string }


/** Where a number goes, as the engine names it in messages (TaskScript.kt's Slot). */
interface Slot { what: string; min: number; max: number; integer: boolean; above?: boolean }
const SECONDS: Slot = { what: "等待秒数", min: 0, max: 600, integer: false, above: true };
const PAUSE: Slot = { what: "“等待”的秒数", min: 0, max: 600, integer: false, above: true };
const LOOP_TIMES: Slot = { what: "循环次数", min: 1, max: 100, integer: true };
const TAP_TIMES: Slot = { what: "最多点击次数", min: 1, max: 1000, integer: true };
const HOPS: Slot = { what: "导航步数", min: 1, max: 50, integer: true };
const rangeOf = (s: Slot) => s.above ? `大于 ${s.min}、不超过 ${s.max}` : `${s.min}–${s.max}`;
const holds = (s: Slot, n: number) => (s.above ? n > s.min : n >= s.min) && n <= s.max && (!s.integer || Number.isInteger(n));
/** The slot a number in [head]'s line before [unit] fills; null where the engine reads no setting. */
function slotOf(head: string, unit: string): Slot | null {
  if (unit === "次") return head === "反复" || head === "直到" ? LOOP_TIMES : head === "点" || head === "点空白" || head === "拖" ? TAP_TIMES : null;
  if (unit === "秒") return head === "等待" ? PAUSE : ["点", "点空白", "拖", "等", "分情况", "如果看到", "如果没看到"].includes(head) ? SECONDS : null;
  if (unit === "步") return head === "去" ? HOPS : null;
  return null;
}
/** The engine's words for a widget (TaskScript.kt's WIDGET_NAMES). */
const ENGINE_WIDGETS: Record<string, string> = { SINGLE_CHOICE: "单选", MULTI_CHOICE: "多选", NUMBER: "数值", RANGE: "范围", TIME: "时刻", DATE: "日期", DATE_RANGE: "日期范围", TEXT: "文字", SWITCH: "开关" };
const labelOf = (f: Obj) => { const id = String(f.id); const l = str(f.label); return l && l.trim() && l !== id ? `${id}（${l}）` : id; };
const unknownSetting = (id: string, fields: Obj[]) =>
  `没有配置项“${id}”` + (fields.length ? `。本任务的配置项：${fields.map(labelOf).join("、")}` : "：这个任务还没有配置项");
const LONG_WAIT = "长等待的时长要写死，不能读配置项：写成 长等待 300秒（10–3600 秒）";
const HOPS_FIXED = "“去 … 最多 N步”还不能读配置项，请写 1–50 的整数";
/** What the engine says of braces that name no setting, in a number's place. */
function badBraceReason(head: string, unit: string): string | null {
  if (head === "长等待") return LONG_WAIT;
  if (head === "等待" && unit === "秒") return "花括号里写配置项编号，如 等待 {pause}秒";
  if (head === "点" || head === "点空白" || head === "拖") return unit === "秒" ? "等待秒数需在 0–600 之间" : unit === "次" ? "最多点击次数需为 1–1000 的整数" : null;
  return slotOf(head, unit) ? `花括号里写配置项编号，如 最多 {rounds}${unit} 或 最多 {rounds|3}${unit}` : null;
}

/** What the engine says of `{id|written}` read for [slot] (TaskScript.kt's setting()), in its order; null when it is fine. */
function settingReason(id: string, written: string | null, slot: Slot, fields: Obj[]): string | null {
  const f = fields.find((x) => String(x.id) === id);
  if (!f) return unknownSetting(id, fields);
  const name = labelOf(f);
  if (!readsAsNumber(f)) return `配置项 ${name} 是${ENGINE_WIDGETS[String(f.widget)] ?? String(f.widget)}，${slot.what}要读数字：只能用数值、范围，或选项全是数字的单选`;
  const fallback = written === null ? null : decimal(written);
  if (written !== null && fallback === null) return `{${id}|…} 竖线后面写默认的数字，如 {${id}|3}`;
  if (fallback !== null && !holds(slot, fallback)) return `默认值 ${written} 不行：${slot.what}要${slot.integer ? "整数，" : ""}${rangeOf(slot)}`;
  const choice = f.widget === "SINGLE_CHOICE";
  const nums = choice ? objs(f.options).map((o) => decimal(o.value)).filter((n): n is number => n !== null) : [];
  const low = choice ? (nums.length ? Math.min(...nums) : null) : decimal(f.minimum);
  const high = choice ? (nums.length ? Math.max(...nums) : null) : decimal(f.maximum);
  if (low === null || high === null)
    return `配置项 ${name} 没写${low === null && high === null ? "最小值和最大值" : low === null ? "最小值" : "最大值"}，${slot.what}只能是 ${rangeOf(slot)}：请在配置项里写上 minimum 和 maximum`;
  if (!(slot.above ? low > slot.min : low >= slot.min) || high > slot.max)
    return `配置项 ${name} 可以填 ${low}–${high}，超出了${slot.what}允许的 ${rangeOf(slot)}：请把配置项的最小值、最大值改到这个范围里`;
  if (slot.integer) {
    const step = decimal(f.step);
    const fractional = choice ? nums.some((n) => !Number.isInteger(n)) : (step === null || !Number.isInteger(step)) || !Number.isInteger(low);
    if (fractional) return `${slot.what}要整数，配置项 ${name} 可能填出小数：${choice ? "选项要都是整数" : "请写整数的最小值和步长（step，如 1）"}`;
  }
  const mayLack = f.visibleWhen !== undefined && f.visibleWhen !== null || (f.required !== true && (f.recommended === undefined || f.recommended === null));
  if (written === null && mayLack) return `配置项 ${name} 可能没有值（${f.visibleWhen ? "按条件显示" : "选填且没有推荐值"}），请写默认值，如 {${id}|${low}}`;
  return null;
}

/**
 * Settings read wrong, and values left unhandled, in [script], in the engine's words; [fields] null when no task gives
 * them. A snippet ([inSnippet]) belongs to no task: there `{x}` is an error and 按设置 is not checked, as in the engine.
 */
export function lintSettings(script: string, fields: Obj[] | null, inSnippet = false): LocalProblem[] {
  if (!fields && !inSnippet) return [];
  const out: LocalProblem[] = [];
  const { reads, bad } = readsOf(script);
  for (const b of bad) {
    const reason = badBraceReason(b.head, b.unit);
    if (reason) out.push({ line: b.line, col: b.col, len: b.len, severity: "error", reason });
  }
  for (const r of reads) {
    if (r.kind === "number") {
      // 长等待 refuses any {…} before it looks at the setting.
      if (r.head === "长等待") { out.push({ line: r.line, col: r.col, len: r.len, severity: "error", reason: LONG_WAIT }); continue; }
      const slot = slotOf(r.head, r.unit);
      if (!slot) continue;
      if (inSnippet || !fields) { out.push({ line: r.line, col: r.col, len: r.len, severity: "error", reason: `片段不属于哪个任务，不能读配置项 {${r.field}}：请写数字，或把这一段写在任务的步骤里` }); continue; }
      const reason = settingReason(r.field, r.fallback, slot, fields) ?? (slot === HOPS ? HOPS_FIXED : null);
      if (reason) out.push({ line: r.line, col: r.col, len: r.len, severity: "error", reason });
      continue;
    }
    if (!fields || inSnippet) continue;
    const f = fields.find((x) => String(x.id) === r.field);
    if (!f) { out.push({ line: r.line, col: r.col, len: r.len, severity: "error", reason: unknownSetting(r.field, fields) }); continue; }
    const choices = f.widget === "SINGLE_CHOICE" || f.widget === "MULTI_CHOICE" ? valuesOf(f) : null;
    const hint = choices?.map((x) => x.label && x.label !== x.word ? `${x.word}（${x.label}）` : x.word).join("、") ?? "";
    const handled = new Set<string>(); let otherwise = false;
    for (const c of r.cases) {
      if (c.text.includes("{")) { otherwise = true; continue; } // made by 逐个; the server checks it
      if (!c.quoted && c.text === "其他") { otherwise = true; continue; }
      if (!c.quoted && c.text === "没有值") continue;
      if (choices) {
        if (choices.some((x) => x.word === c.text)) { handled.add(c.text); continue; }
        const byLabel = choices.find((x) => x.label === c.text);
        out.push({ line: c.line, col: c.col, len: c.len, severity: "error", reason: `“${c.text}”不是配置项 ${labelOf(f)}的选项` +
          (byLabel ? `（这是“${byLabel.word}”的显示名，这里写选项值 ${byLabel.word}）` : "") + `。可选：${hint}` });
      } else if (c.quoted) handled.add(c.text);
      else if (f.widget === "SWITCH") {
        if (c.text === "开" || c.text === "关") handled.add(c.text === "开" ? "true" : "false");
        else out.push({ line: c.line, col: c.col, len: c.len, severity: "error", reason: `配置项 ${r.field} 是开关，这里写 开 或 关` });
      } else if (isNumberField(f) && decimal(c.text) === null)
        out.push({ line: c.line, col: c.col, len: c.len, severity: "error", reason: `“${r.field}”是数值，这里要写数字` });
    }
    if (otherwise) continue;
    const left = choices ? choices.filter((x) => !handled.has(x.word)).map((x) => x.label && x.label !== x.word ? `${x.word}（${x.label}）` : x.word)
      : f.widget === "SWITCH" ? ["开", "关"].filter((w) => !handled.has(String(w === "开"))) : [];
    if (left.length) out.push({ line: r.line, col: r.col, len: r.len, severity: "warning",
      reason: `配置项 ${labelOf(f)} 的 ${left.join("、")} 没有写分支：选了${left.length > 1 ? "它们" : "它"}时这里什么也不做。要处理就补上；确实不用做事，可加一行“其他”留空` });
  }
  return out;
}

/** The short card for one setting: what hovering `按设置 x` or `{x}` shows. */
export interface SettingView { id: string; label: string; type: string; values: string; recommended: string; step: string; href: string }
export const WIDGET_NAMES: Record<string, string> = { SINGLE_CHOICE: "单选", MULTI_CHOICE: "多选", NUMBER: "数字", RANGE: "范围", SWITCH: "开关", TIME: "时间", DATE: "日期", DATE_RANGE: "日期段", TEXT: "文字" };
export function settingView(f: Obj, steps: Obj[], href: string): SettingView {
  const type = WIDGET_NAMES[String(f.widget)] ?? String(f.widget ?? "—");
  const opts = objs(f.options).map((o) => str(o.label) && o.label !== o.value ? `${str(o.label)} = ${String(o.value)}` : String(o.value));
  const values = f.widget === "SWITCH" ? "开 / 关"
    : opts.length ? (opts.length > 12 ? `${opts.slice(0, 12).join("、")} 等 ${opts.length} 项` : opts.join("、"))
    : isNumberField(f) ? [f.minimum !== undefined ? `≥ ${String(f.minimum)}` : "", f.maximum !== undefined ? `≤ ${String(f.maximum)}` : "", str(f.unit) ?? ""].filter(Boolean).join(" ") || "任意数" : "";
  const rec = f.recommended === undefined ? "—" : f.recommended === true ? "开" : f.recommended === false ? "关" : typeof f.recommended === "string" ? f.recommended : JSON.stringify(f.recommended);
  const sid = str(f.stepId); const idx = sid ? steps.findIndex((s) => s.id === sid) : -1;
  const step = idx >= 0 ? `步骤 ${idx + 1} · ${str(steps[idx].name) ?? sid}` : sid ? `步骤 ${sid}` : "按读它的步骤";
  return { id: String(f.id), label: str(f.label) ?? String(f.id), type, values, recommended: rec, step, href };
}
