import { useMemo, useState } from "react";
import { Stepper, Switch, join } from "../../../components/ui";
import type { Json, Obj } from "../api";
import { useDev } from "../context";
import { objs, str, tasks } from "../model";
import { fallbackValue, isNumeric, rangeText, typeOf, valueText } from "./fields";
import { ConfigForm } from "./ConfigForm";
import { NewConfigDialog } from "./NewConfigDialog";
import { PlayerPreview } from "./Preview";
import { useTestValues } from "./testValues";
import { fieldUses, usesCount, withEdits } from "./uses";
import { Dialog } from "./Dialog";
import w from "../Wb.module.css";
import k from "./config.module.css";

const num = (v: unknown) => typeof v === "number" ? v : undefined;

/** A test value changed where the row is: a stepper, a switch, a list; anything else opens the form. */
function TestValue({ f, value, own, set }: { f: Obj; value: unknown; own: boolean; set: (v: unknown) => void }) {
  const label = `${str(f.label) ?? String(f.id)} 的测试值`;
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  let control: React.ReactNode;
  if (isNumeric(f.widget)) control = <Stepper small label={label} value={num(value)} min={num(f.minimum)} max={num(f.maximum)} step={num(f.step) && num(f.step)! > 0 ? num(f.step) : 1} onChange={(n) => set(n)} />;
  else if (f.widget === "SWITCH") control = <Switch label={label} checked={value === true} onChange={(on) => set(on)} />;
  else if (f.widget === "SINGLE_CHOICE") control = <select aria-label={label} className={k.select} value={JSON.stringify(value ?? null)} onChange={(e) => set(JSON.parse(e.target.value))}>
    {value === undefined || value === null ? <option value="null">—</option> : null}
    {objs(f.options).map((o) => <option key={String(o.value)} value={JSON.stringify(o.value)}>{str(o.label) ?? String(o.value)}</option>)}</select>;
  else control = <span className={k.valueText} title={valueText(f, value as Json)}>{valueText(f, value as Json)}</span>;
  return <span className={k.rowValue} data-own={own || undefined} onClick={stop} onKeyDown={stop}>{control}
    {own && <button type="button" className={k.x} title="改回默认" aria-label={`${label}改回默认`} onClick={() => set(undefined)}>↺</button>}</span>;
}

/**
 * 配置项 panel (ConfigCanvas.dc.html ①): every setting of the task with its kind, range, default and how many lines read
 * it (none: yellow), and on the right the test value a trial uses, changed in place. ＋ 新建 opens 新建配置项; a row
 * selects it ([onSelect], for the canvas to light the nodes reading it) and ✎ (or a double click) opens the whole form.
 * Without [onSelect] a row opens the form. [onClose] adds ✕.
 */
export function ConfigPanel({ taskId, selected, onSelect, onClose, embedded }: { taskId: string; selected?: string | null; onSelect?: (fieldId: string | null) => void; onClose?: () => void; embedded?: boolean }) {
  const { draft, edits } = useDev();
  const { values, own, set } = useTestValues(taskId);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);
  const body = useMemo(() => draft ? withEdits(draft.body, taskId, edits) : null, [draft, taskId, edits]);
  const task = body ? tasks(body).find((t) => t.id === taskId) : undefined;
  if (!task || !body) return <div className={k.empty}>草稿里没有这个任务</div>;
  const fields = task.fields;
  const open = (id: string) => setEditing(id);
  return (
    <section className={join(k.panel, !embedded && k.floating)} aria-label="配置项">
      <div className={k.ph}>
        <b>配置项</b><span className={k.hint}>本任务 {fields.length} 个</span><span className={k.grow} />
        <button type="button" className={join(w.btn, w.primary, w.sm)} onClick={() => setCreating(true)}>＋ 新建</button>
        {onClose && <button type="button" className={k.x} aria-label="关闭配置项" onClick={onClose}>✕</button>}
      </div>
      <div className={k.list} role="listbox" aria-label="配置项列表">
        {fields.map((f) => {
          const id = String(f.id);
          const uses = fieldUses(body, taskId, id);
          const other = objs(task.steps).some((st) => (st.when as Obj | undefined)?.field === id) || fields.some((x) => (x.visibleWhen as Obj | undefined)?.field === id);
          const unused = !uses.length && !other;
          const t = typeOf(f.widget);
          const fallback = fallbackValue(f);
          const sub = [rangeText(f), `默认 ${valueText(f, fallback)}`, uses.length ? `用在 ${usesCount(uses)}` : other ? "用作条件" : ""].filter(Boolean).join(" · ");
          return <div key={id} role="option" tabIndex={0} aria-selected={selected === id} className={k.row} data-unused={unused || undefined}
            onClick={() => onSelect ? onSelect(selected === id ? null : id) : open(id)} onDoubleClick={() => open(id)}
            onKeyDown={(e) => { if (e.key === "Enter") open(id); else if (e.key === " " && onSelect) { e.preventDefault(); onSelect(selected === id ? null : id); } }}>
            <span className={k.glyph} aria-hidden="true">{t?.glyph ?? "?"}</span>
            <span className={k.rowMain}>
              <span className={k.rowName}>{str(f.label) ?? id}<code>{id}</code></span>
              {unused ? <span className={k.rowSub} data-warn>没人读 · {onSelect ? "拖到节点上使用" : "在脚本里用 {" + id + "} 或 按设置 " + id}</span> : <span className={k.rowSub} title={sub}>{sub}</span>}
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <TestValue f={f} value={values[id]} own={id in own} set={(v) => set(id, v)} />
              <button type="button" className={k.x} aria-label={`改配置项 ${str(f.label) ?? id}`} title="改配置项" onClick={(e) => { e.stopPropagation(); open(id); }}>✎</button>
            </span>
          </div>;
        })}
        {!fields.length && <div className={k.empty}>还没有配置项<button type="button" className={w.btn} onClick={() => setCreating(true)}>＋ 新建配置项</button></div>}
      </div>
      <div className={k.pfoot}><span>右边是试跑用的值（只存在这个浏览器）</span>
        <button type="button" className={k.link} style={{ fontSize: "inherit" }} onClick={() => setPreview(true)}>预览玩家参数页</button></div>
      {creating && <NewConfigDialog taskId={taskId} onDone={(id) => { setCreating(false); if (id) onSelect?.(id); }} />}
      {editing && <ConfigForm taskId={taskId} fieldId={editing} onClose={() => setEditing(null)} onSaved={(id) => { if (selected === editing) onSelect?.(id); }}
        onDeleted={() => { if (selected === editing) onSelect?.(null); }} />}
      {preview && <Dialog label="玩家参数页" onClose={() => setPreview(false)} style={{ width: 420 }}>
        <div className={k.dh}><span className={k.dhTitle}>玩家看到的参数页</span><span className={k.dhAside}>按测试值显示</span></div>
        <div className={k.bd} style={{ gap: 14, maxHeight: "64vh", overflow: "auto", paddingBottom: 12 }}>
          <PlayerPreview fields={fields} steps={task.steps} values={values} onChange={(id, v) => set(id, v)} />
        </div>
        <div className={k.df}><span className={k.hint}>这里改的是测试值，不改默认</span><span className={k.grow} /><button type="button" className={w.btn} onClick={() => setPreview(false)}>关闭</button></div>
      </Dialog>}
    </section>
  );
}
