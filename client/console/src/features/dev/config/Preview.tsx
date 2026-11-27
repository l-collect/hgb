import { Chips, Stepper, Switch, join, ui } from "../../../components/ui";
import { TimePicker } from "../../../components/TimePicker";
import type { Json, Obj } from "../api";
import { objs, str } from "../model";
import { placeText, shown } from "./fields";
import w from "../Wb.module.css";
import c from "../Config.module.css";

/** One setting as the console draws it: chips, a stepper, a switch or a field. */
export function Preview({ field: x, value, onChange }: { field: Obj; value: Json | undefined; onChange: (v: Json) => void }) {
  const options = objs(x.options);
  const label = str(x.label) ?? String(x.id);
  let control: React.ReactNode;
  if (x.widget === "SWITCH") control = <Switch label={label} checked={value === true} onChange={onChange} />;
  else if (x.widget === "SINGLE_CHOICE" && options.length > 6) control = <select className={c.select} aria-label={label} value={JSON.stringify(value ?? null)}
    onChange={(e) => onChange(JSON.parse(e.target.value) as Json)}>{value === undefined || value === null ? <option value="null">未选</option> : null}
    {options.map((o) => <option key={String(o.value)} value={JSON.stringify(o.value)}>{str(o.label) ?? String(o.value)}</option>)}</select>;
  else if (x.widget === "SINGLE_CHOICE") control = <Chips label={label} items={options.map((o, i): [number, string] => [i, str(o.label) ?? ""])}
    value={options.findIndex((o) => o.value === value)} onChange={(i) => onChange(options[i].value as Json)} />;
  else if (x.widget === "MULTI_CHOICE") {
    const cur = Array.isArray(value) ? value : [];
    control = <div className={ui.chips}>{options.map((o) => { const on = cur.includes(o.value as Json);
      return <button key={str(o.value)} type="button" aria-pressed={on} className={join(ui.chip, on && ui.chipOn)}
        onClick={() => onChange(on ? cur.filter((v) => v !== o.value) : [...cur, o.value as Json])}>{str(o.label)}</button>; })}</div>;
  } else if (x.widget === "NUMBER" || x.widget === "RANGE") control = <Stepper label={label} value={typeof value === "number" || typeof value === "string" ? value : undefined}
    min={typeof x.minimum === "number" ? x.minimum : undefined} max={typeof x.maximum === "number" ? x.maximum : undefined} step={typeof x.step === "number" && x.step > 0 ? x.step : 1} unit={str(x.unit)} clearable={x.required !== true} onChange={(v) => onChange(v ?? null)} />;
  else if (x.widget === "TIME") control = <TimePicker label={label} value={typeof value === "string" ? value : ""} clearable={x.required !== true} onChange={(v) => onChange(v || null)} />;
  else if (x.widget === "DATE") control = <input type="date" className={c.input} aria-label={label} value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value || null)} />;
  else if (x.widget === "DATE_RANGE") {
    const r = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, Json> : {};
    const put = (k: "start" | "end", v: string) => onChange({ start: (k === "start" ? v : r.start) ?? "", end: (k === "end" ? v : r.end) ?? "" } as Json);
    control = <span className={c.option}><input type="date" className={c.input} aria-label={`${label} 从`} value={typeof r.start === "string" ? r.start : ""} onChange={(e) => put("start", e.target.value)} />
      <input type="date" className={c.input} aria-label={`${label} 到`} value={typeof r.end === "string" ? r.end : ""} onChange={(e) => put("end", e.target.value)} /></span>;
  }
  else control = <input className={c.input} aria-label={label} value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value)} />;
  const inline = x.widget === "SWITCH";
  return (
    <div className={c.setting} style={x.visibleWhen ? { marginLeft: 12 } : undefined}>
      <div className={c.settingHead}><b className={c.grow}>{label}</b>{x.required === true && <span className={c.required}>必填</span>}{inline && control}</div>
      {str(x.description) && <div className={w.muted}>{str(x.description)}</div>}
      {!inline && control}
    </div>
  );
}

/** The player's settings page for [fields] with [values]: grouped by the step each is under, hidden ones left out. */
export function PlayerPreview({ fields, steps, values, onChange }: { fields: Obj[]; steps: Obj[]; values: Record<string, unknown>; onChange: (id: string, v: Json) => void }) {
  const groups = Array.from(new Set(fields.map((f) => placeText(f, steps))));
  if (!fields.length) return <div className={w.muted}>没有配置项</div>;
  return <>{groups.map((g) => (
    <div key={g} className={c.group}>
      {g !== "随步骤" && <div className={w.muted}>{g}</div>}
      {fields.filter((f) => placeText(f, steps) === g && shown(f, values)).map((f) => <Preview key={String(f.id)} field={f} value={values[String(f.id)] as Json | undefined}
        onChange={(v) => onChange(String(f.id), v)} />)}
    </div>
  ))}</>;
}
