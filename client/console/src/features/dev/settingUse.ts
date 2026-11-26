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
  | { kind: "number"; field: string; line: number; col: number; len: number; role: string; fallback: string | null };
export interface ScriptReads { reads: SettingRead[]; calls: { line: number; snippet: string }[] }

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
  const reads: SettingRead[] = []; const calls: ScriptReads["calls"] = [];
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
    for (const m of t.matchAll(/\{\s*([^{}\s=:|?]+)\s*(?:[=:|?]\s*([^{}]*?)\s*)?\}/g)) {
      const name = m[1];
      if (inQuote(t, m.index!) || loops.some((x) => name === x.name || name.includes(x.name)) || /^[-\d+*\s]+$/.test(name) || /[+*]/.test(name)) continue;
      const after = t.slice(m.index! + m[0].length);
      reads.push({ kind: "number", field: name, line: i + 1, col: m.index! + m[0].indexOf(name, 1), len: name.length, role: roleOf(t, after), fallback: m[2] ?? null });
    }
    if (each) loops.push({ indent: l.indent, name: each[1] });
  });
  return { reads, calls };
}

export const isNumberField = (f: Obj) => f.widget === "NUMBER" || f.widget === "RANGE";
/** The values a setting can take that a branch should handle: a switch's 开/关, a single choice's options; else none. */
export function valuesOf(f: Obj): { value: Json; label: string; word: string }[] {
  if (f.widget === "SWITCH") return [{ value: true, label: "开", word: "开" }, { value: false, label: "关", word: "关" }];
  if (f.widget === "SINGLE_CHOICE") return objs(f.options).map((o) => ({ value: o.value as Json, label: str(o.label) ?? String(o.value), word: String(o.value) }));
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

const listOf = (words: string[], max = 8) => words.length > max ? `${words.slice(0, max).join("、")}…` : words.join("、");

/** Wrong setting names and values, and values left unhandled, in [script]; [fields] null when no task gives them. */
export function lintSettings(script: string, fields: Obj[] | null): LocalProblem[] {
  if (!fields) return [];
  const out: LocalProblem[] = [];
  const byId = new Map(fields.map((f) => [String(f.id), f]));
  for (const r of readsOf(script).reads) {
    const f = byId.get(r.field);
    if (!f) {
      out.push({ line: r.line, col: r.col, len: r.len, severity: "error", reason: `没有配置项“${r.field}”${fields.length ? `，有：${listOf(fields.map((x) => String(x.id)))}` : ""}` });
      continue;
    }
    if (r.kind === "number") {
      if (!isNumberField(f)) out.push({ line: r.line, col: r.col, len: r.len, severity: "error", reason: `“${r.field}”不是数字，{…} 只能放数字类配置项` });
      continue;
    }
    const values = valuesOf(f);
    const handled = new Set<string>(); let otherwise = false;
    for (const c of r.cases) {
      if (c.text.includes("{")) { otherwise = true; continue; } // made by 逐个; the server checks it
      const v = caseValue(f, c);
      const words = values.map((x) => x.word);
      if (v === null) out.push({ line: c.line, col: c.col, len: c.len, severity: "error", reason: isNumberField(f) ? "这里要写数字" : `可选：${listOf([...words, "其他"])}` });
      else if (v.otherwise) otherwise = true;
      else if (v.value !== undefined && values.length) {
        const hit = values.find((x) => x.value === v.value);
        if (hit) handled.add(hit.word);
        else {
          const byLabel = values.find((x) => x.label === c.text);
          out.push({ line: c.line, col: c.col, len: c.len, severity: "error", reason: byLabel ? `写值 ${byLabel.word}（“${c.text}”是显示名）` : `不在选项里，可选：${listOf(words)}` });
        }
      }
    }
    const left = values.filter((x) => !handled.has(x.word));
    if (!otherwise && values.length && left.length)
      out.push({ line: r.line, col: r.col, len: r.len, severity: "warning", reason: `没处理：${listOf(left.map((x) => x.label === x.word ? x.word : `${x.word}（${x.label}）`))} · 玩家选了无效，可加“其他”` });
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
