import type { ReactNode } from "react";
import { Stepper, Switch, join } from "../../../components/ui";
import { TimePicker } from "../../../components/TimePicker";
import type { Json, Obj } from "../api";
import { isObj, objs, str } from "../model";
import { TYPES, isChoice, optionValue } from "./fields";
import k from "./config.module.css";

/**
 * The pieces of a 配置项 form, shared by 新建 (简约 ↔ 详细) and the whole form: each edits one field object [f]
 * through [set] (a key and its new value; undefined drops it).
 */
export type SetKey = (key: string, value: Json | undefined) => void;
const num = (v: Json | undefined) => typeof v === "number" ? v : undefined;

/** A labelled line: the name on the left, the control on the right. */
export function Line({ label, children, top, htmlFor }: { label: string; children: ReactNode; top?: boolean; htmlFor?: string }) {
  return <div className={join(k.f, top && k.top)}><label className={k.fl} htmlFor={htmlFor}>{label}</label><div className={k.fv}>{children}</div></div>;
}

/** Segments that pick one of [items]. */
export function Segs<T extends string>({ items, value, onChange, label, narrow, disabled }: { items: [T, string][]; value: T | null; onChange: (v: T) => void; label: string; narrow?: boolean; disabled?: (v: T) => string | null }) {
  return <div className={join(k.segs, narrow && k.narrow)} role="radiogroup" aria-label={label}>
    {items.map(([id, text]) => { const off = disabled?.(id) ?? null;
      return <button key={id} type="button" role="radio" aria-checked={id === value} className={k.seg} disabled={!!off} title={off ?? undefined} onClick={() => onChange(id)}>{text}</button>; })}
  </div>;
}

/** The nine types as cards, each with how a script reads it; [why] says why one cannot be chosen (null: it can). */
export function TypeGrid({ value, onChange, why }: { value: string; onChange: (w: string) => void; why?: (w: string) => string | null }) {
  return <div className={k.types} role="radiogroup" aria-label="类型">
    {TYPES.map((t) => { const off = why?.(t.widget) ?? null;
      return <button key={t.widget} type="button" role="radio" aria-checked={t.widget === value} className={k.ty} disabled={!!off} title={off ?? undefined}
        onClick={() => onChange(t.widget)}><b>{t.label}</b><span>{t.hint}</span></button>; })}
  </div>;
}

/** 最小 – 最大, and with [full] 步长 and 单位. */
export function Bounds({ f, set, full, note }: { f: Obj; set: SetKey; full?: boolean; note?: ReactNode }) {
  const box = (key: string, label: string, width = k.num) => <input aria-label={label} placeholder={label} inputMode="decimal" className={join(k.input, width)}
    value={f[key] === undefined ? "" : String(f[key])} data-bad={f[key] !== undefined && typeof f[key] !== "number" ? true : undefined}
    onChange={(e) => { const t = e.target.value.trim(); set(key, t === "" ? undefined : Number.isNaN(Number(t)) ? t : Number(t)); }} />;
  return <>
    {box("minimum", "最小")}<span aria-hidden="true">–</span>{box("maximum", "最大")}
    {full && <>{box("step", "步长")}<input aria-label="单位" placeholder="单位" className={join(k.input, k.num)} value={str(f.unit) ?? ""} onChange={(e) => set("unit", e.target.value || undefined)} /></>}
    {note && <span className={k.hint}>{note}</span>}
  </>;
}

/** 默认 (recommended) by the field's own control; a choice's is picked in its options instead (null here). */
export function DefaultControl({ f, set }: { f: Obj; set: SetKey }) {
  const v = f.recommended;
  if (isChoice(f.widget)) return null;
  if (f.widget === "SWITCH") return <Segs label="默认" narrow items={[["on", "开"], ["off", "关"]]} value={v === true ? "on" : v === false ? "off" : null}
    onChange={(x) => set("recommended", x === "on")} />;
  if (f.widget === "NUMBER" || f.widget === "RANGE") return <Stepper label="默认" value={num(v)} clearable placeholder="不设" min={num(f.minimum)} max={num(f.maximum)}
    step={num(f.step) && num(f.step)! > 0 ? num(f.step) : 1} unit={str(f.unit)} onChange={(n) => set("recommended", n)} />;
  if (f.widget === "TIME") return <TimePicker label="默认" value={typeof v === "string" ? v : ""} clearable onChange={(t) => set("recommended", t || undefined)} />;
  if (f.widget === "DATE") return <input type="date" aria-label="默认" className={k.input} value={typeof v === "string" ? v : ""} onChange={(e) => set("recommended", e.target.value || undefined)} />;
  if (f.widget === "DATE_RANGE") {
    const r = isObj(v) ? v : {};
    const put = (key: "start" | "end", t: string) => { const next = { start: str(r.start) ?? "", end: str(r.end) ?? "", [key]: t }; set("recommended", next.start || next.end ? next : undefined); };
    return <><input type="date" aria-label="默认从" className={k.input} value={str(r.start) ?? ""} onChange={(e) => put("start", e.target.value)} /><span aria-hidden="true">–</span>
      <input type="date" aria-label="默认到" className={k.input} value={str(r.end) ?? ""} onChange={(e) => put("end", e.target.value)} /></>;
  }
  return <input aria-label="默认" placeholder="空" className={join(k.input, k.fill)} value={typeof v === "string" ? v : ""} onChange={(e) => set("recommended", e.target.value || undefined)} />;
}

/**
 * A choice's options: the default picked by its dot (a single choice) or its box (a multiple one), what the player
 * sees, and with [values] what the script writes (made from the label until it is typed). [branch] says, per value,
 * whether the scripts handle it. Pasting several lines into a label adds one option each.
 */
export function OptionsEditor({ f, set, values, branch, fixed = [], onValueRename }: { f: Obj; set: SetKey; values?: boolean; branch?: (value: string) => ReactNode;
  /** Values the saved field already has: scripts may write them, so a new label leaves them as they are. */
  fixed?: string[];
  /** A value changed by hand ([from] → [to]): the form renames it in the scripts when it saves. */
  onValueRename?: (from: string, to: string) => void }) {
  const opts = objs(f.options);
  const multi = f.widget === "MULTI_CHOICE";
  const cur = f.recommended;
  const chosen = (v: Json) => multi ? Array.isArray(cur) && cur.includes(v) : cur === v;
  const cols = ["16px", "minmax(0, 1fr)", values ? "minmax(0, .8fr)" : "", branch ? "56px" : "", "24px"].filter(Boolean).join(" ");
  const write = (next: Obj[]) => {
    set("options", next as Json);
    // The default keeps only values still there.
    const keep = new Set(next.map((o) => o.value));
    if (multi && Array.isArray(cur)) { const left = cur.filter((x) => keep.has(x)); if (left.length !== cur.length) set("recommended", left.length ? left : undefined); }
    else if (!multi && cur !== undefined && !keep.has(cur)) set("recommended", undefined);
  };
  const relabel = (i: number, label: string) => {
    const lines = label.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const next = opts.map((o) => ({ ...o }));
    const others = (j: number) => next.filter((_, x) => x !== j).map((o) => String(o.value));
    // The value follows the label until it is typed by hand.
    const auto = (o: Obj, j: number, was: string) => !fixed.includes(String(o.value)) &&
      (!str(o.value) || /^o\d+$/.test(String(o.value)) || o.value === optionValue(was, others(j)) || o.value === was.trim().replace(/\s+/g, ""));
    if (lines.length > 1) {
      next.splice(i, 1);
      for (const l of lines) next.splice(i++, 0, { label: l, value: optionValue(l, next.map((o) => String(o.value))) });
      write(next); return;
    }
    const was = str(next[i].label) ?? "";
    const before = next[i].value as Json;
    if (auto(next[i], i, was)) next[i].value = optionValue(label, others(i));
    next[i].label = label;
    // The default follows its option's new value.
    if (before !== next[i].value && chosen(before)) set("recommended", multi && Array.isArray(cur) ? cur.map((x) => x === before ? next[i].value as Json : x) : next[i].value as Json);
    set("options", next as Json);
  };
  const pick = (v: Json) => {
    if (multi) { const list = Array.isArray(cur) ? cur : []; const next = chosen(v) ? list.filter((x) => x !== v) : [...list, v]; set("recommended", next.length ? next : undefined); }
    else set("recommended", chosen(v) ? undefined : v);
  };
  return <div className={k.opts}>
    {values && <div className={k.optHead} style={{ gridTemplateColumns: cols }}><span /><span>玩家看到</span><span>脚本里写</span>{branch && <span>分支</span>}<span /></div>}
    {opts.map((o, i) => (
      <div key={i} className={k.opt} style={{ gridTemplateColumns: cols }}>
        <input type={multi ? "checkbox" : "radio"} className={k.pick} aria-label={`默认 ${str(o.label) ?? ""}`} checked={chosen(o.value as Json)} onChange={() => pick(o.value as Json)} onClick={(e) => { if (!multi && chosen(o.value as Json)) { e.preventDefault(); pick(o.value as Json); } }} />
        <input aria-label="玩家看到" className={k.input} value={str(o.label) ?? ""} placeholder={`选项 ${i + 1}`} onChange={(e) => relabel(i, e.target.value)}
          onPaste={(e) => { const t = e.clipboardData.getData("text"); if (/\n/.test(t.trim())) { e.preventDefault(); relabel(i, t); } }} />
        {values && <input aria-label="脚本里写" className={join(k.input, k.mono)} value={str(o.value) ?? ""} onChange={(e) => { const next = opts.map((x) => ({ ...x })); const was = next[i].value; next[i].value = e.target.value;
          if (chosen(was as Json)) set("recommended", multi && Array.isArray(cur) ? cur.map((x) => x === was ? e.target.value : x) : e.target.value);
          set("options", next as Json); onValueRename?.(String(was ?? ""), e.target.value); }} />}
        {branch && <span>{branch(String(o.value))}</span>}
        <button type="button" className={k.x} aria-label={`删除选项 ${str(o.label) ?? ""}`} onClick={() => write(opts.filter((_, j) => j !== i))}>✕</button>
      </div>
    ))}
    <div className={k.optLine}>
      <button type="button" className={k.link} onClick={() => write([...opts, { label: "", value: "" }])}>＋ 加选项</button>
      <span className={k.hint}>{multi ? "勾 = 默认选中，可以都不勾" : "圆点 = 默认"}{values ? " · 粘贴多行一次加多项" : ""}</span>
    </div>
  </div>;
}

/** 显示条件: only while another switch / choice has a value. */
export function VisibleWhen({ f, fields, set }: { f: Obj; fields: Obj[]; set: SetKey }) {
  const key = (c: Obj) => JSON.stringify(typeof c.equals === "boolean" ? { field: c.field, equals: c.equals } : { field: c.field, contains: c.contains });
  const others = fields.filter((x) => x.id !== f.id && !x.visibleWhen && (x.widget === "SWITCH" || isChoice(x.widget)));
  return <select aria-label="显示条件" className={join(k.select, k.fill)} value={isObj(f.visibleWhen) ? key(f.visibleWhen) : ""}
    onChange={(e) => set("visibleWhen", e.target.value ? JSON.parse(e.target.value) as Json : undefined)}>
    <option value="">总是显示</option>
    {others.flatMap((x) => x.widget === "SWITCH"
      ? [true, false].map((on) => { const v = key({ field: String(x.id), equals: on }); return <option key={v} value={v}>仅当 {str(x.label)} 是 {on ? "开" : "关"}</option>; })
      : objs(x.options).map((o) => { const v = key({ field: String(x.id), contains: str(o.value) ?? "" }); return <option key={v} value={v}>仅当 {str(x.label)} 选了「{str(o.label)}」</option>; }))}
  </select>;
}

/** 归在: the step the player's page shows the field under. */
export function StepPick({ f, steps, set }: { f: Obj; steps: Obj[]; set: SetKey }) {
  return <select aria-label="归在" className={join(k.select, k.fill)} value={str(f.stepId) ?? ""} onChange={(e) => set("stepId", e.target.value || undefined)}>
    <option value="">随步骤</option>
    {steps.map((st, i) => <option key={String(st.id)} value={String(st.id)}>步骤 {i + 1} · {str(st.name) ?? String(st.id)}</option>)}
  </select>;
}

/** 必填 / 只读 as a switch with what it means. */
export function Flag({ label, on, set, hint }: { label: string; on: boolean; set: (on: boolean) => void; hint: string }) {
  return <><Switch label={label} checked={on} onChange={set} /><span className={k.hint}>{hint}</span></>;
}
