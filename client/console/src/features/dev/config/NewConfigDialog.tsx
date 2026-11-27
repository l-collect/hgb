import { useMemo, useState } from "react";
import { join } from "../../../components/ui";
import type { Json, Obj } from "../api";
import { useDev } from "../context";
import { str, tasks } from "../model";
import { fieldProblem, idFromLabel, idProblem, isChoice, isNumeric, placeText, tidy, typeName } from "./fields";
import { retype } from "./ConfigForm";
import { useFieldOps } from "./ops";
import { Bounds, DefaultControl, Flag, Line, OptionsEditor, Segs, StepPick, VisibleWhen, type SetKey } from "./parts";
import { Dialog } from "./Dialog";
import w from "../Wb.module.css";
import k from "./config.module.css";

export type ConfigPreset = Partial<{ label: string; widget: string; minimum: number; maximum: number; step: number; unit: string; recommended: unknown; options: { value: string; label: string }[] }>;
type Kind = "number" | "switch" | "choice" | "multi" | "other";
const KINDS: [Kind, string][] = [["number", "数值"], ["switch", "开关"], ["choice", "单选"], ["multi", "多选"], ["other", "其他"]];
const OTHER = ["RANGE", "TIME", "DATE", "DATE_RANGE", "TEXT"];
const kindOf = (widget: Json | undefined): Kind => widget === "NUMBER" ? "number" : widget === "SWITCH" ? "switch" : widget === "SINGLE_CHOICE" ? "choice" : widget === "MULTI_CHOICE" ? "multi" : "other";
const widgetOf = (kind: Kind, other: string) => kind === "number" ? "NUMBER" : kind === "switch" ? "SWITCH" : kind === "choice" ? "SINGLE_CHOICE" : kind === "multi" ? "MULTI_CHOICE" : other;
const MORE_KEY = "hgb.dev.configMore";
const readMore = () => { try { return localStorage.getItem(MORE_KEY) === "1"; } catch { return false; } };
const writeMore = (on: boolean) => { try { localStorage.setItem(MORE_KEY, on ? "1" : "0"); } catch { /* not kept */ } };
/** What 更多 holds, compared with how the dialog opened, for its dot. */
const MORE_KEYS = ["description", "required", "readOnly", "visibleWhen", "stepId", "section", "step", "unit"];

/**
 * 新建配置项 (ConfigDialog.dc.html): 简约 asks only the name, the type, the range or options and the default; 更多 opens
 * (440 → 720 wide, the lower part sliding open) onto 编号, 说明, 必填, 只读, 显示条件, 归在, 小标题. Which one shows is
 * remembered; closed, a dot by 更多 says something changed in there. 保存 writes the field into the draft and answers
 * its id; 取消 answers null. [kinds] keeps the type to those (a `按设置` asks for a switch or a choice).
 */
export function NewConfigDialog({ taskId, stepId, preset, place, onDone, kinds }: { taskId: string; stepId?: string; preset?: ConfigPreset; place?: string;
  onDone: (fieldId: string | null) => void; kinds?: ("number" | "switch" | "choice" | "multi" | "other")[] }) {
  const { draft } = useDev();
  const ops = useFieldOps(taskId);
  const task = draft ? tasks(draft.body).find((t) => t.id === taskId) : undefined;
  const fields = task?.fields ?? [];
  const taken = fields.map((x) => String(x.id));
  const start = useMemo((): Obj => {
    const widget = preset?.widget ?? (kinds?.[0] ? widgetOf(kinds[0], "TIME") : "NUMBER");
    const f: Obj = { label: preset?.label ?? "", widget };
    for (const key of ["minimum", "maximum", "step", "unit"] as const) if (preset?.[key] !== undefined) f[key] = preset[key] as Json;
    if (preset?.options) f.options = preset.options;
    if (preset?.recommended !== undefined) f.recommended = preset.recommended as Json;
    else if (widget === "SWITCH") f.recommended = true;
    if (isChoice(widget) && !preset?.options) f.options = [{ label: "", value: "" }, { label: "", value: "" }];
    if (isNumeric(widget) && f.step === undefined) f.step = 1;
    if (stepId) f.stepId = stepId;
    return f;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [f, setF] = useState<Obj>(start);
  const [id, setId] = useState<string | null>(null); // typed by hand; null: made from the name
  const [expanded, setExpanded] = useState(readMore);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set: SetKey = (key, value) => { setProblem(null); setF((prev) => { const n = { ...prev }; if (value === undefined) delete n[key]; else n[key] = value; return n; }); };
  const label = str(f.label) ?? "";
  const autoId = idFromLabel(label, taken);
  const fid = id ?? autoId;
  const kind = kindOf(f.widget);
  const allowed = kinds ?? KINDS.map(([x]) => x);
  const moreChanged = id !== null || MORE_KEYS.some((key) => JSON.stringify(f[key]) !== JSON.stringify(start[key]));
  const toggle = () => { const on = !expanded; setExpanded(on); writeMore(on); };
  const pick = (to: string) => setF((prev) => {
    const { next } = retype(prev, to);
    if (isChoice(to) && !(next.options as Obj[]).length) next.options = [{ label: "", value: "" }, { label: "", value: "" }];
    if (isNumeric(to) && next.step === undefined) next.step = 1;
    return next;
  });

  const save = async () => {
    // Rows left empty are not options.
    const rows = Array.isArray(f.options) ? (f.options as Obj[]).filter((o) => str(o.label)?.trim() || str(o.value)?.trim()) : undefined;
    const next = tidy({ ...f, id: fid, label: label.trim(), ...(rows ? { options: rows } : {}) });
    const why = idProblem(fid, taken) ?? fieldProblem(next);
    if (why) { setProblem(why); if (why.startsWith("编号") && !expanded) toggle(); return; }
    setBusy(true);
    const result = await ops.create(next);
    setBusy(false);
    if (result) { setProblem(result); return; }
    onDone(fid);
  };
  const step = stepId ? task?.steps.find((s) => s.id === stepId) : undefined;
  return (
    <Dialog label="新建配置项" onClose={() => onDone(null)} className={k.sized} style={{ width: expanded ? 720 : 440 }}>
      <form onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <div className={k.dh}>
          <span className={k.dhTitle}>新建配置项</span>
          {place && <span className={k.dhSub}>{place}</span>}
          <span className={k.dhAside}>归在 {step ? placeText({ stepId } as Obj, task!.steps) : placeText(f, task?.steps ?? [])}</span>
        </div>
        <div className={k.bd}>
          <Line label="名称" htmlFor="nc-label"><input id="nc-label" data-autofocus className={join(k.input, k.fill)} value={label} placeholder={kind === "switch" ? "如：退四打九" : kind === "number" ? "如：打几轮" : "如：阵容"}
            onChange={(e) => set("label", e.target.value)} /></Line>
          <Line label="类型"><Segs label="类型" items={KINDS.filter(([x]) => allowed.includes(x))} value={kind} onChange={(x) => pick(widgetOf(x, OTHER.includes(String(f.widget)) ? String(f.widget) : "TIME"))} /></Line>
          {kind === "other" && <Line label="具体类型"><select aria-label="具体类型" className={join(k.select, k.fill)} value={String(f.widget)} onChange={(e) => pick(e.target.value)}>
            {OTHER.map((x) => <option key={x} value={x}>{typeName(x)}</option>)}</select></Line>}
          {isNumeric(f.widget) && <Line label="范围"><Bounds f={f} set={set} note={preset?.minimum !== undefined ? `按${place ? "这个位置" : "用途"}推荐 ${preset.minimum}–${preset.maximum ?? ""}` : undefined} /></Line>}
          {isChoice(f.widget) ? <Line label="选项" top><OptionsEditor f={f} set={set} values={expanded} /></Line>
            : <Line label="默认"><DefaultControl f={f} set={set} />{preset?.recommended !== undefined && f.recommended === preset.recommended && <span className={k.hint}>原来的值</span>}</Line>}

          <div className={k.more} style={{ gridTemplateRows: expanded ? "1fr" : "0fr", opacity: expanded ? 1 : 0 }} inert={!expanded} aria-hidden={!expanded}>
            <div>
              <span className={k.st}>基本</span>
              <Line label="编号" htmlFor="nc-id"><div className={k.idBox}><input id="nc-id" className={join(k.input, k.mono)} value={fid} spellCheck={false}
                onChange={(e) => setId(e.target.value.trim() || null)} /><span className={k.hint}>{id === null ? "按名称自动，可改" : "手写"}</span></div></Line>
              <Line label="说明" htmlFor="nc-desc"><input id="nc-desc" className={join(k.input, k.fill)} placeholder="一行，告诉玩家这项做什么" value={str(f.description) ?? ""} onChange={(e) => set("description", e.target.value || undefined)} /></Line>
              {isNumeric(f.widget) && <Line label="步长 / 单位"><input aria-label="步长" placeholder="步长" inputMode="decimal" className={join(k.input, k.num)} value={f.step === undefined ? "" : String(f.step)}
                onChange={(e) => { const t = e.target.value.trim(); set("step", t === "" ? undefined : Number.isNaN(Number(t)) ? t : Number(t)); }} />
                <input aria-label="单位" placeholder="单位" className={join(k.input, k.num)} value={str(f.unit) ?? ""} onChange={(e) => set("unit", e.target.value || undefined)} /></Line>}
              <span className={k.st}>规则</span>
              <Line label="必填"><Flag label="必填" on={f.required === true} set={(on) => set("required", on || undefined)} hint={f.widget === "SWITCH" ? "开关总有值" : "不必填时脚本要处理「没有值」"} /></Line>
              <Line label="只读"><Flag label="只读" on={f.readOnly === true} set={(on) => set("readOnly", on || undefined)} hint="玩家只能看" /></Line>
              <Line label="显示条件"><VisibleWhen f={f} fields={fields} set={set} /></Line>
              <span className={k.st}>位置</span>
              <Line label="归在"><StepPick f={f} steps={task?.steps ?? []} set={set} /></Line>
              <Line label="小标题" htmlFor="nc-section"><input id="nc-section" className={join(k.input, k.fill)} placeholder="可选" value={str(f.section) ?? ""} onChange={(e) => set("section", e.target.value || undefined)} /></Line>
            </div>
          </div>
        </div>
        <div className={k.df}>
          <button type="button" className={k.ghost} aria-expanded={expanded} onClick={toggle}>
            {expanded ? "更少" : "更多"} <span className={k.chev} style={{ transform: expanded ? "rotate(180deg)" : "none" }} aria-hidden="true">▾</span>
            {!expanded && moreChanged && <span className={k.dot} aria-label="更多里有改动" />}
          </button>
          <span className={k.grow} />
          {problem && <span className={k.problem} role="alert">{problem}</span>}
          <button type="button" className={w.btn} onClick={() => onDone(null)}>取消</button>
          <button type="submit" className={join(w.btn, w.primary)} disabled={busy}>{busy ? "保存中…" : "保存"}</button>
        </div>
      </form>
    </Dialog>
  );
}
