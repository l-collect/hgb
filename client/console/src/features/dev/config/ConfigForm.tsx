import { useMemo, useRef, useState, type ReactNode } from "react";
import { join } from "../../../components/ui";
import type { Json, Obj } from "../api";
import { useDev } from "../context";
import { objs, snippets, str, tasks } from "../model";
import { valuesOf } from "../settingUse";
import { fieldProblem, idProblem, isChoice, isNumeric, placeText, tidy, typeName } from "./fields";
import { useFieldOps } from "./ops";
import { Bounds, DefaultControl, Flag, Line, OptionsEditor, StepPick, TypeGrid, VisibleWhen, type SetKey } from "./parts";
import { Preview } from "./Preview";
import { fieldUses, snippetBlock, usesCount, usesText, withEdits } from "./uses";
import { UsesView, findUses, numberProblem, type Uses } from "./UsesView";
import { Dialog } from "./Dialog";
import w from "../Wb.module.css";
import k from "./config.module.css";

const SECTIONS: [string, string][] = [["basic", "基本"], ["values", "取值"], ["rules", "规则"], ["place", "位置"], ["uses", "用在"]];

/** [f] taking the widget [to]: what still applies is kept (name, rules, place; a range between numbers, options between choices). */
export function retype(f: Obj, to: string): { next: Obj; reset: boolean } {
  const from = f.widget;
  const next: Obj = { ...f, widget: to };
  if (from === to) return { next, reset: false };
  const numbers = isNumeric(from) && isNumeric(to), choices = isChoice(from) && isChoice(to);
  const had = f.recommended !== undefined || f.minimum !== undefined || f.maximum !== undefined || objs(f.options).length > 0;
  if (!numbers) for (const key of ["minimum", "maximum", "step", "unit"]) delete next[key];
  if (!choices) delete next.options;
  const r = f.recommended;
  if (choices) {
    if (to === "MULTI_CHOICE" && r !== undefined && !Array.isArray(r)) next.recommended = [r];
    else if (to === "SINGLE_CHOICE" && Array.isArray(r)) { if (r.length) next.recommended = r[0]; else delete next.recommended; }
  } else if (!numbers) delete next.recommended;
  if (to === "SWITCH" && next.recommended === undefined) next.recommended = false;
  if (isChoice(to) && !Array.isArray(next.options)) next.options = [];
  return { next, reset: !numbers && !choices && had };
}

/** Why [w] does not fit how the scripts read the field ([uses]); null when it does. */
export function typeMisfit(w: string, uses: Uses): string | null {
  if (uses.numbers.length && !(isNumeric(w) || w === "SINGLE_CHOICE")) return "脚本在数字位置读它（{x}），只能是数值、滑块或选项全是数字的单选";
  if (uses.branches.length && !(w === "SWITCH" || isChoice(w) || isNumeric(w) || w === "TEXT")) return "脚本按设置分支读它，换成这种就分不了支";
  return null;
}

/**
 * The whole form of one 配置项 (ConfigForm.dc.html): 基本 / 取值 / 规则 / 位置 / 用在, what the player sees and the
 * checks beside it, 删除 · 取消 · 保存 under it. Edits stay here until 保存; a new id renames every reference.
 * [inline]: drawn in the page (配置项), without the layer; else a dialog closed by [onClose].
 */
export function ConfigForm({ taskId, fieldId, onClose, inline, onSaved, onDeleted }: { taskId: string; fieldId: string; onClose?: () => void; inline?: boolean;
  /** The id it was saved under (a new one when renamed). */
  onSaved?: (id: string) => void; onDeleted?: () => void }) {
  const { draft, edits } = useDev();
  const ops = useFieldOps(taskId);
  const body = useMemo(() => draft ? withEdits(draft.body, taskId, edits) : null, [draft, taskId, edits]);
  const task = body ? tasks(body).find((t) => t.id === taskId) : undefined;
  const source = task?.fields.find((x) => x.id === fieldId);
  const [f, setF] = useState<Obj | null>(source ? { ...source } : null);
  const [problem, setProblem] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Option values changed by hand: saved value → what it is now; saving renames them in the scripts too.
  const [renames, setRenames] = useState<Record<string, string>>({});
  const [at, setAt] = useState("basic");
  const scroller = useRef<HTMLDivElement>(null);
  const secs = useRef<Record<string, HTMLElement | null>>({});
  if (!task || !source || !f || !body) {
    const empty = <div className={k.empty}>没有这个配置项{onClose && <button type="button" className={w.btn} onClick={onClose}>关闭</button>}</div>;
    return inline ? <section className={k.inline}>{empty}</section> : <Dialog label="配置项" onClose={onClose ?? (() => undefined)} style={{ width: 420 }}>{empty}</Dialog>;
  }
  const fields = task.fields;
  const set: SetKey = (key, value) => { setProblem(null); setF((prev) => { const n = { ...(prev ?? {}) }; if (value === undefined) delete n[key]; else n[key] = value; return n; }); };
  const next = tidy(f);
  const dirty = JSON.stringify(next) !== JSON.stringify(source);
  const uses = findUses(task.raw, task.steps, snippets(body), fieldId, taskId, null);
  const lines = fieldUses(body, taskId, fieldId);
  const id = String(f.id ?? "");
  const idBad = id !== fieldId ? idProblem(id, fields.map((x) => String(x.id)).filter((x) => x !== fieldId)) : null;
  const shape = fieldProblem(next);
  const label = str(f.label) ?? fieldId;

  const save = async () => {
    const why = idBad ?? shape;
    if (why) { setProblem(why); return; }
    setBusy(true);
    const now = new Set(objs(next.options).map((o) => String(o.value)));
    const was = new Set(objs(source.options).map((o) => String(o.value)));
    const values = Object.fromEntries(Object.entries(renames).filter(([a, b]) => a !== b && was.has(a) && now.has(b)));
    const result = await ops.save(fieldId, next, values);
    setBusy(false);
    if (result) { setProblem(result); return; }
    onSaved?.(String(next.id));
    if (!inline) onClose?.();
  };
  const remove = async () => {
    const done = await ops.remove(fieldId);
    if (typeof done === "string") setProblem(done);
    else if (done) { onDeleted?.(); onClose?.(); }
  };
  const addCase = async (value: Json, text: string) => {
    setBusy(true);
    const result = await ops.addCase(next, value, text);
    setBusy(false);
    setProblem(result);
  };
  const go = (key: string) => { setAt(key); secs.current[key]?.scrollIntoView({ block: "start", behavior: "smooth" }); };
  const follow = () => {
    const top = scroller.current?.scrollTop ?? 0;
    let cur = "basic";
    for (const [key] of SECTIONS) { const el = secs.current[key]; if (el && el.offsetTop - (scroller.current?.offsetTop ?? 0) <= top + 24) cur = key; }
    setAt(cur);
  };
  const sec = (key: string, title: string, children: ReactNode) => (
    <div className={k.sec} ref={(el) => { secs.current[key] = el; }} aria-labelledby={`cf-${key}`}><span id={`cf-${key}`} className={k.st}>{title}</span>{children}</div>
  );

  // Per option: whether the scripts' 按设置 on it take that value (✓), only through 其他, or not at all.
  const branchOf = uses.branches.length ? (value: string) => {
    const own = uses.branches.some((b) => b.cases.some((cs) => !cs.otherwise && !cs.missing && cs.value === value));
    if (own) return <span className={k.ok}>✓</span>;
    if (uses.branches.every((b) => b.cases.some((cs) => cs.otherwise))) return <span className={k.hint}>其他</span>;
    return <span className={k.warn}>没写</span>;
  } : undefined;
  const unhandled = uses.branches.length ? valuesOf(next).filter((v) => uses.branches.some((b) => !b.cases.some((cs) => cs.otherwise) && !b.cases.some((cs) => !cs.otherwise && !cs.missing && cs.value === v.value))) : [];
  const numberIssues = uses.numbers.map((n) => numberProblem(next, fields.map((x) => x.id === fieldId ? next : x), n)).filter((x): x is string => !!x);

  const values = (() => {
    if (isNumeric(f.widget)) return <>
      <Line label="范围"><Bounds f={f} set={set} full /></Line>
      <Line label="默认"><DefaultControl f={f} set={set} /><span className={k.hint}>{f.widget === "RANGE" ? "滑块要有最小、最大、步长" : "用作次数时要整数；用作秒数时不超过 600"}</span></Line>
    </>;
    if (isChoice(f.widget)) {
      const fixed = objs(source.options).map((o) => String(o.value));
      const pending = Object.entries(renames).filter(([a, b]) => a !== b);
      return <>
        <OptionsEditor f={f} set={set} values branch={branchOf} fixed={fixed} onValueRename={(from, to) => setRenames((all) => {
          // Keyed by the saved value: a second change of the same option follows on from the first.
          const orig = Object.entries(all).find(([, now]) => now === from)?.[0] ?? (fixed.includes(from) ? from : null);
          return orig === null ? all : { ...all, [orig]: to };
        })} />
        {pending.length > 0 && <span className={k.hint}>保存时同步改脚本里「按设置 {fieldId}」下的值：{pending.map(([a, b]) => `${a} → ${b}`).join("、")}{snippetBlock(lines, "") ? "（片段也用到它，要先去片段里改）" : ""}</span>}
      </>;
    }
    if (f.widget === "SWITCH") return <Line label="默认"><DefaultControl f={f} set={set} /><span className={k.hint}>开关总有值，不用必填</span></Line>;
    return <Line label="默认"><DefaultControl f={f} set={set} /></Line>;
  })();

  const content = <>
    <div className={k.dh}>
      <span className={k.dhTitle}>配置项 · {label}</span><code className={join(k.dhSub, k.mono)}>{fieldId}</code>
      <span className={k.dhAside} title={usesText(body, taskId, lines, 99)}>{lines.length ? `用在 ${usesCount(lines)} · ${usesText(body, taskId, lines, 3)}` : "还没有脚本读它"}</span>
    </div>
    <div className={k.formBody} style={{ borderTop: "1px solid var(--color-line)" }}>
      <nav className={k.toc} aria-label="表单分区">{SECTIONS.map(([key, name]) => <button key={key} type="button" aria-current={at === key ? "true" : undefined} onClick={() => go(key)}>{name}</button>)}</nav>
      <div className={join(k.sections, k.wide)} ref={scroller} onScroll={follow}>
        {sec("basic", "基本", <>
          <Line label="名称" htmlFor="cf-label"><input id="cf-label" data-autofocus className={join(k.input, k.fill)} value={str(f.label) ?? ""} onChange={(e) => set("label", e.target.value)} /></Line>
          <Line label="编号" htmlFor="cf-id"><div className={k.idBox}><input id="cf-id" className={join(k.input, k.mono)} value={id} data-bad={idBad ? true : undefined}
            onChange={(e) => set("id", e.target.value.trim())} spellCheck={false} />
            <span className={k.hint}>{id !== fieldId ? (snippetBlock(lines, "") ? "片段也用到，要先去片段里改" : lines.length ? `会同时改 ${lines.length} 处引用` : "改名") : lines.length ? `改了会同时改 ${lines.length} 处` : "脚本里用的名字"}</span></div></Line>
          {idBad && <span className={k.problem} style={{ marginLeft: 106 }}>{idBad}</span>}
          <Line label="说明" htmlFor="cf-desc"><input id="cf-desc" className={join(k.input, k.fill)} placeholder="一行，告诉玩家这项做什么" value={str(f.description) ?? ""} onChange={(e) => set("description", e.target.value || undefined)} /></Line>
          <Line label="类型" top><TypeGrid value={String(f.widget)} why={(x) => x === f.widget ? null : typeMisfit(x, uses)}
            onChange={(x) => { const r = retype(f, x); setF(r.next); setNote(r.reset ? "取值已按新类型重置" : null); }} /></Line>
          <span className={k.hint} style={{ marginLeft: 106 }}>{note ?? "已被脚本用到时，只能换成能用在同样位置的类型"}</span>
        </>)}
        {sec("values", `取值 · ${typeName(f.widget)}`, values)}
        {sec("rules", "规则", <>
          <Line label="必填"><Flag label="必填" on={f.required === true} set={(on) => set("required", on || undefined)} hint={f.widget === "SWITCH" ? "开关总有值" : "不必填：玩家可以不填，脚本读到「没有值」，走「其他」或用 {x|默认}"} /></Line>
          <Line label="只读"><Flag label="只读" on={f.readOnly === true} set={(on) => set("readOnly", on || undefined)} hint="玩家只能看，不能改" /></Line>
          <Line label="显示条件"><VisibleWhen f={f} fields={fields} set={set} /></Line>
          <span className={k.hint} style={{ marginLeft: 106 }}>被隐藏时脚本读到的是默认值</span>
        </>)}
        {sec("place", "位置", <>
          <Line label="归在"><StepPick f={f} steps={task.steps} set={set} /><span className={k.hint}>参数页按步骤分组</span></Line>
          <Line label="小标题" htmlFor="cf-section"><input id="cf-section" className={join(k.input, k.fill)} placeholder="可选，如「战斗设置」" value={str(f.section) ?? ""} onChange={(e) => set("section", e.target.value || undefined)} /></Line>
          <Line label="页签" htmlFor="cf-tab"><input id="cf-tab" className={join(k.input, k.fill)} placeholder="可选：参数页分两页时写页名" value={str(f.tab) ?? ""} onChange={(e) => set("tab", e.target.value || undefined)} /></Line>
        </>)}
        {sec("uses", "用在", <UsesView field={next} fields={fields} uses={uses} />)}
      </div>
      {!inline && <aside className={k.side} aria-label="玩家看到的">
        <span className={k.sideTitle}>玩家看到的样子</span>
        <div className={k.preview}>
          <span className={k.hint}>{placeText(next, task.steps)}{str(next.section) ? ` · ${str(next.section)}` : ""}</span>
          <Preview field={next} value={next.recommended as Json | undefined} onChange={(v) => set("recommended", v)} />
        </div>
        <span className={k.sideTitle}>检查</span>
        {shape && <div className={k.warnbox} style={{ background: "var(--color-danger-bg)", color: "var(--color-danger)" }}>{shape}</div>}
        {unhandled.map((v) => <div key={v.word} className={k.warnbox}>提醒 · 「{v.label}{v.label !== v.word ? ` ${v.word}` : ""}」没写分支：选它时什么也不做
          {isChoice(next.widget) && <> <button type="button" className={w.linkBtn} disabled={busy} onClick={() => void addCase(v.value, v.label)}>补一支 ›</button></>}</div>)}
        {numberIssues.map((t, i) => <div key={i} className={k.warnbox}>{t}</div>)}
        {!lines.length && !uses.other.length && <div className={k.warnbox}>没人读 · 发布前删掉或用上</div>}
        {!shape && !unhandled.length && !numberIssues.length && (lines.length > 0 || uses.other.length > 0) && <div className={k.okbox}>没发现问题</div>}
      </aside>}
    </div>
    <div className={k.df}>
      <button type="button" className={join(w.btn, k.dangerBtn)} disabled={busy} onClick={() => void remove()}>删除</button>
      <span className={k.hint}>{lines.length ? `删除时列出 ${lines.length} 处引用，确认后那里写回默认值` : "没有脚本读它"}</span>
      <span className={k.grow} />
      {problem && <span className={k.problem} role="alert">{problem}</span>}
      {(onClose || dirty) && <button type="button" className={w.btn} disabled={busy} onClick={() => { if (inline) { setF({ ...source }); setRenames({}); setProblem(null); setNote(null); } else onClose?.(); }}>{inline ? "还原" : "取消"}</button>}
      <button type="button" className={join(w.btn, w.primary)} disabled={busy || !dirty} onClick={() => void save()}>{busy ? "保存中…" : "保存"}</button>
    </div>
  </>;
  return inline ? <section className={k.inline} aria-label={`配置项 ${label}`}>{content}</section>
    : <Dialog label={`配置项 ${label}`} onClose={() => onClose?.()} style={{ width: 960 }}>{content}</Dialog>;
}
