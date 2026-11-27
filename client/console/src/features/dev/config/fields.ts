import type { Json, Obj } from "../api";
import { isObj, objs, str } from "../model";
import type { Slot } from "../settingUse";

/**
 * 配置项 as the engine has them (TaskBundle.kt ConfigurationField): id, label, widget, required, unit, minimum, maximum,
 * step, options [{value, label}], section, visibleWhen {field, equals | contains}, tab, readOnly, description,
 * recommended, stepId. Everything here reads or makes that one shape.
 */

/** The widgets, in the order the type picker shows them, with what each is read as in a script. */
export const TYPES: { widget: string; label: string; hint: string; glyph: string }[] = [
  { widget: "NUMBER", label: "数值", hint: "{x} 读次数、秒", glyph: "#" },
  { widget: "SWITCH", label: "开关", hint: "按设置 开 / 关", glyph: "开" },
  { widget: "SINGLE_CHOICE", label: "单选", hint: "按设置 每项一支", glyph: "◉" },
  { widget: "MULTI_CHOICE", label: "多选", hint: "逐个 / 包含", glyph: "☰" },
  { widget: "RANGE", label: "滑块", hint: "有范围和步长的数", glyph: "⇔" },
  { widget: "TIME", label: "时间", hint: "几点几分", glyph: "时" },
  { widget: "DATE", label: "日期", hint: "某一天", glyph: "日" },
  { widget: "DATE_RANGE", label: "日期段", hint: "从哪天到哪天", glyph: "段" },
  { widget: "TEXT", label: "文字", hint: "一段文字", glyph: "文" },
];
export const typeOf = (widget: Json | undefined) => TYPES.find((t) => t.widget === widget);
export const typeName = (widget: Json | undefined) => typeOf(widget)?.label ?? String(widget ?? "—");
export const isChoice = (w: Json | undefined) => w === "SINGLE_CHOICE" || w === "MULTI_CHOICE";
export const isNumeric = (w: Json | undefined) => w === "NUMBER" || w === "RANGE";

/** An id the script can write: a letter, then letters, digits, _ or -. */
export const ID_RULE = /^[A-Za-z][A-Za-z0-9_-]*$/;
export function idProblem(id: string, taken: string[]): string | null {
  if (!id) return "编号不能空";
  if (!ID_RULE.test(id)) return "编号用英文字母开头，只含字母、数字、_ 和 -";
  if (taken.includes(id)) return `编号 ${id} 已有`;
  return null;
}

// Short English for common words in a setting's name: 打几轮 → rounds, 每轮歇 → pause. The first two found make the id.
const WORDS: [RegExp, string][] = [
  [/轮/, "rounds"], [/次数|几次|次/, "times"], [/歇|休息|间隔|停顿/, "pause"], [/等|秒/, "wait"], [/阵|队伍|编队/, "team"],
  [/退/, "retreat"], [/领|奖励|奖/, "claim"], [/体力/, "stamina"], [/保留|留/, "keep"], [/张|数量|个数/, "count"],
  [/开始/, "start"], [/结束/, "end"], [/日期|天/, "date"], [/时间|时刻|几点/, "time"], [/自动/, "auto"], [/接受/, "accept"],
  [/邀请/, "invite"], [/名/, "name"], [/难度/, "level"], [/层/, "floor"], [/上限|最多/, "max"], [/下限|最少/, "min"],
  [/刷新/, "refresh"], [/突破/, "breach"], [/御魂/, "soul"], [/探索/, "explore"], [/协战|协助/, "coop"], [/悬赏/, "wanted"],
  [/好友/, "friend"], [/切换/, "switch"], [/开关|是否/, "enable"], [/目标/, "target"],
];
/** An id made from [label]: its own letters when it has some, else short English for its words; unique among [taken]. */
export function idFromLabel(label: string, taken: string[], fallback = "setting"): string {
  const ascii = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^[_0-9]+|_+$/g, "");
  let base = ascii;
  if (!base) {
    // In the order they come in the name: 刷新几次 → refresh_times.
    const found: { at: number; word: string }[] = [];
    for (const [re, word] of WORDS) { const m = re.exec(label); if (m && !found.some((x) => x.word === word)) found.push({ at: m.index, word }); }
    base = found.sort((a, b) => a.at - b.at).slice(0, 2).map((x) => x.word).join("_");
  }
  if (!base || !ID_RULE.test(base)) base = fallback;
  let id = base; let n = 2;
  while (taken.includes(id)) id = `${base}${n++}`;
  return id;
}
/** An option's value made from what the player sees: the label itself without spaces (锋矢阵, 1-1), else o1, o2 …; unique. */
export function optionValue(label: string, taken: string[]): string {
  const t = label.trim().replace(/\s+/g, "");
  const plain = t && !["其他", "没有值", "开", "关"].includes(t) && !/["“”{}|#@]/.test(t) ? t : "";
  if (plain) { let v = plain; let n = 2; while (taken.includes(v)) v = `${plain}-${n++}`; return v; }
  let n = taken.length + 1;
  while (taken.includes(`o${n}`)) n++;
  return `o${n}`;
}
/** A number field's range, step and unit for a number written in [slot], as the engine allows it there (settingUse's Slot). */
export function numberPreset(slot: Slot | null, n: number | null, unit: string): { minimum: number; maximum: number; step: number; unit: string } {
  const seconds = unit === "秒";
  if (!slot) return { minimum: 0, maximum: Math.max(100, (n ?? 0) * 3), step: 1, unit };
  if (slot.integer) return { minimum: slot.min, maximum: Math.min(slot.max, Math.max(30, Math.ceil((n ?? 1) * 3))), step: 1, unit: unit || "次" };
  const whole = n === null || (Number.isInteger(n) && n >= 1);
  const low = whole ? 1 : 0.1;
  return { minimum: low, maximum: Math.min(slot.max, Math.max(60, Math.ceil((n ?? 1) * 3))), step: whole ? 1 : 0.1, unit: seconds ? "秒" : unit };
}
/** A name for a number by what it counts (settingUse's roles). */
export function labelForRole(role: string): string {
  return ({ 反复次数: "打几轮", 直到次数: "最多几次", 点击次数: "点几次", 等待秒数: "等几秒", 最多秒数: "最多等几秒", 看门狗秒数: "最长等几秒" } as Record<string, string>)[role] ?? "";
}

/** A value as the player reads it: 开 / 关, an option's label, a list, a date span. */
export function valueText(f: Obj | undefined, v: Json | undefined): string {
  if (v === undefined || v === null) return "—";
  if (v === true) return "开";
  if (v === false) return "关";
  const opts = f ? objs(f.options) : [];
  const label = (x: Json) => str(opts.find((o) => o.value === x)?.label) ?? String(x);
  if (Array.isArray(v)) return v.length ? v.map(label).join("、") : "不选";
  if (isObj(v)) return `${String(v.start ?? "")} – ${String(v.end ?? "")}`;
  if (opts.length) return label(v);
  return `${String(v)}${f && isNumeric(f.widget) && str(f.unit) ? ` ${str(f.unit)}` : ""}`;
}
/** 「1–30 轮」「开关」「单选 3 项」: a field's kind and range in a few words. */
export function rangeText(f: Obj): string {
  if (isNumeric(f.widget)) {
    const lo = f.minimum, hi = f.maximum, u = str(f.unit) ?? "";
    if (lo !== undefined && hi !== undefined) return `${String(lo)}–${String(hi)}${u ? ` ${u}` : ""}`;
    if (lo !== undefined) return `≥ ${String(lo)}${u ? ` ${u}` : ""}`;
    if (hi !== undefined) return `≤ ${String(hi)}${u ? ` ${u}` : ""}`;
    return `${typeName(f.widget)}${u ? ` · ${u}` : ""}`;
  }
  if (isChoice(f.widget)) return `${typeName(f.widget)} ${objs(f.options).length} 项`;
  return typeName(f.widget);
}
/** What a trial uses when no test value is set: the recommended value; a switch is off. */
export const fallbackValue = (f: Obj): Json | undefined => f.recommended ?? (f.widget === "SWITCH" ? false : undefined);
/** Whether [f] shows with [values] (its visibleWhen). */
export function shown(f: Obj, values: Record<string, unknown>): boolean {
  const v = isObj(f.visibleWhen) ? f.visibleWhen : null;
  if (!v) return true;
  const cur = values[String(v.field)];
  if (typeof v.equals === "boolean") return (cur === true) === v.equals;
  if (v.equals !== undefined) return cur === v.equals;
  return Array.isArray(cur) ? cur.includes(v.contains) : cur === v.contains;
}
/** Where a field sits on the player's page: 「步骤 2 · 逐张打」, or 「随步骤」. */
export function placeText(f: Obj, steps: Obj[]): string {
  const sid = str(f.stepId);
  const i = sid ? steps.findIndex((s) => s.id === sid) : -1;
  return i >= 0 ? `步骤 ${i + 1} · ${str(steps[i].name) ?? sid}` : sid ? `步骤 ${sid}` : "随步骤";
}
/** [f] without empty keys (an unset unit, a blank description), as written into the draft. */
export function tidy(f: Obj): Obj {
  const out: Obj = {};
  for (const [k, v] of Object.entries(f)) {
    if (v === undefined || v === null || v === "") continue;
    if ((k === "required" || k === "readOnly") && v !== true) continue;
    if (k === "options" && (!Array.isArray(v) || !v.length || !isChoice(f.widget))) continue;
    if ((k === "minimum" || k === "maximum" || k === "step" || k === "unit") && !isNumeric(f.widget)) continue;
    out[k] = v;
  }
  return out;
}
/** What is wrong with [f] before it is saved (the engine's TaskBundle checks that apply to one field); null when fine. */
export function fieldProblem(f: Obj): string | null {
  if (!str(f.label)?.trim()) return "名称不能空";
  if (isChoice(f.widget)) {
    const opts = objs(f.options);
    if (!opts.length) return "至少要一个选项";
    if (opts.some((o) => !str(o.label)?.trim() || !str(o.value)?.trim())) return "选项的显示和值都要填";
    if (new Set(opts.map((o) => o.value)).size !== opts.length) return "选项的值不能重复";
  }
  if (isNumeric(f.widget)) {
    const lo = typeof f.minimum === "number" ? f.minimum : null, hi = typeof f.maximum === "number" ? f.maximum : null;
    if (lo !== null && hi !== null && lo > hi) return "最小不能大于最大";
    if (typeof f.step === "number" && f.step <= 0) return "步长要大于 0";
    if (f.widget === "RANGE" && (lo === null || hi === null || typeof f.step !== "number")) return "滑块要写最小、最大和步长";
    const r = f.recommended;
    if (typeof r === "number" && ((lo !== null && r < lo) || (hi !== null && r > hi))) return "默认不在范围里";
  }
  if (f.widget === "TIME" && typeof f.recommended === "string" && !/^\d{2}:\d{2}$/.test(f.recommended)) return "时间写成 21:30";
  if (f.widget === "DATE" && typeof f.recommended === "string" && !/^\d{4}-\d{2}-\d{2}$/.test(f.recommended)) return "日期写成 2026-12-05";
  return null;
}
