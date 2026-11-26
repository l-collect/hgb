import { useState } from "react";
import { Chips, Stepper, Switch, join, ui } from "../../components/ui";
import { Link, navigate } from "../../router";
import { NameButton } from "./NameButton";
import type { Json, Obj } from "./api";
import { devPaths, useDev } from "./context";
import { uniqueId } from "./HomePage";
import { childIds, childrenOf, isObj, nodeDigest, objs, programOf, snippets, str, tasks } from "./model";
import { wbPaths } from "./wb";
import w from "./Wb.module.css";
import c from "./Config.module.css";

const WIDGETS: [string, string][] = [["SINGLE_CHOICE", "单选"], ["MULTI_CHOICE", "多选"], ["NUMBER", "数字"], ["RANGE", "范围"],
  ["SWITCH", "开关"], ["TIME", "时间"], ["DATE", "日期"], ["DATE_RANGE", "日期段"], ["TEXT", "文字"]];
interface Use { label: string; href: string }

/** 配置项 (v7 V7WbConfig): fields | the selected one's form and where it is read | what the player sees, whose values a trial takes. */
export function ConfigPage({ id }: { id: string }) {
  const { draft, apply } = useDev();
  const [pick, setPick] = useState(0);
  const [test, setTest] = useState<Obj>({});
  const [text, setText] = useState<string | null>(null);
  const task = draft ? tasks(draft.body).find((x) => x.id === id) : undefined;
  if (!draft || !task) return <div className={w.card}><div className={w.empty}>草稿里没有这个任务</div></div>;
  const fields = task.fields;
  const f = fields[Math.min(pick, fields.length - 1)];
  const lib = snippets(draft.body);
  const usesOf = (fid: string) => findUses(task.raw, task.steps, lib, fid, id);
  const values: Obj = Object.fromEntries(fields.map((x) => [String(x.id), test[String(x.id)] ?? x.recommended ?? null]));
  const visible = (x: Obj) => { const v = isObj(x.visibleWhen) ? x.visibleWhen : null; if (!v) return true; const cur = values[String(v.field)];
    if (typeof v.equals === "boolean") return (cur === true) === v.equals;
    return Array.isArray(cur) ? cur.includes(v.contains as Json) : cur === v.contains; };
  /** Changes the field as the latest draft has it (expect its digest); nothing when it is already so. */
  const change = (fid: string, edit: (field: Obj) => Obj) => {
    setText(null);
    void apply(async (body) => {
      const now = tasks(body).find((x) => x.id === id)?.fields.find((x) => x.id === fid);
      if (!now) return [];
      const next = edit(now);
      return JSON.stringify(next) === JSON.stringify(now) ? [] : [{ op: "put", path: `tasks:${id}/fields:${fid}`, expect: await nodeDigest(now), value: next }];
    }).then((problem) => { if (problem) setText(problem); });
  };
  const set = (key: string, value: Json | undefined) => {
    if (!f) return;
    change(String(f.id), (now) => { const next = { ...now }; if (value === undefined || value === "") delete next[key]; else next[key] = value; return next; });
  };
  const add = async (label: string, wanted: string) => {
    const fid = uniqueId(wanted || label, childIds(task.raw), "field");
    const problem = await apply([{ op: "insert", path: `tasks:${id}`, field: "fields", after: fields.length ? String(fields.at(-1)!.id) : null, value: { id: fid, label, widget: "SWITCH" } }]);
    if (problem) setText(problem); else setPick(fields.length);
  };
  const stepOf = (x: Obj) => {
    const sid = str(x.stepId);
    if (!sid) return str(x.section) ? `分组 ${str(x.section)}` : "未绑定";
    const idx = task.steps.findIndex((st) => st.id === sid);
    return idx >= 0 ? `步骤 ${idx + 1}` : `步骤 ${sid}`;
  };
  const widgetOf = (x: Obj) => WIDGETS.find(([k]) => k === x.widget)?.[1] ?? str(x.widget) ?? "—";
  const groups = Array.from(new Set(fields.map((x) => {
    const sid = str(x.stepId); const st = sid ? task.steps.find((s) => s.id === sid) : undefined;
    return st ? `${stepOf(x)} · ${str(st.name) ?? sid}` : stepOf(x);
  })));
  const groupOf = (x: Obj) => { const sid = str(x.stepId); const st = sid ? task.steps.find((s) => s.id === sid) : undefined; return st ? `${stepOf(x)} · ${str(st.name) ?? sid}` : stepOf(x); };
  const tryValues = Object.fromEntries(fields.filter(visible).map((x) => [String(x.id), values[String(x.id)]]).filter(([, v]) => v !== null && v !== undefined));
  const row = (label: string, control: React.ReactNode, htmlFor?: string) => (
    <div className={c.row}><label className={c.k} htmlFor={htmlFor}>{label}</label><div className={c.v}>{control}</div></div>
  );
  return (
    <>
      <header className={c.header}>
        <Link to={devPaths.task(id)} className={c.back}>← {task.name}</Link>
        <h1 className={c.title}>配置项</h1>
        <NameButton label="＋ 配置项" placeholder="名称" askId className={w.btn} onName={add} />
      </header>
      {text && <div className={w.message} role="status">{text}</div>}
      <div className={c.layout}>
        <nav aria-label="配置项" className={`${w.card} ${c.nav}`}>
          {fields.map((x, i) => (
            <button key={String(x.id)} type="button" className={c.field} aria-current={i === pick ? "true" : undefined} style={{ paddingLeft: x.visibleWhen ? 22 : undefined }} onClick={() => setPick(i)}>
              <b className={c.name}>{str(x.label)}</b><span className={w.muted}>{stepOf(x)} · {widgetOf(x)}</span>
            </button>
          ))}
          {!fields.length && <div className={w.empty}>还没有</div>}
        </nav>

        {f ? (
          <section aria-label="字段" key={String(f.id)} className={`${w.card} ${c.form}`}>
            {row("名称", <input id="lb" defaultValue={str(f.label)} onBlur={(e) => e.target.value !== f.label && set("label", e.target.value)} />, "lb")}
            {row("说明", <input id="ds" defaultValue={str(f.description) ?? ""} placeholder="一行内" onBlur={(e) => e.target.value !== (f.description ?? "") && set("description", e.target.value)} />, "ds")}
            {row("控件", <select id="wd" value={str(f.widget)} onChange={(e) => set("widget", e.target.value)}>
              {!WIDGETS.some(([k]) => k === f.widget) && <option value={str(f.widget)}>{str(f.widget)}</option>}
              {WIDGETS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}</select>, "wd")}
            {(f.widget === "SINGLE_CHOICE" || f.widget === "MULTI_CHOICE") && row("选项", <div className={c.options}>
              {[...objs(f.options), { label: "", value: "" }].map((o, i) => (
                <div key={`${i}/${objs(f.options).length}`} className={c.option}>
                  <input aria-label="显示" defaultValue={str(o.label)} placeholder={i === objs(f.options).length ? "＋ 选项" : ""} onBlur={(e) => editOption(i, "label", e.target.value)} />
                  <input aria-label="值" className={c.mono} defaultValue={str(o.value)} onBlur={(e) => editOption(i, "value", e.target.value)} />
                </div>
              ))}</div>)}
            {(f.widget === "NUMBER" || f.widget === "RANGE") && row("范围", <div className={c.option}>
              <input aria-label="最小" inputMode="numeric" placeholder="最小" defaultValue={f.minimum === undefined ? "" : String(f.minimum)} onBlur={(e) => set("minimum", e.target.value === "" ? undefined : Number(e.target.value))} />
              <input aria-label="最大" inputMode="numeric" placeholder="最大" defaultValue={f.maximum === undefined ? "" : String(f.maximum)} onBlur={(e) => set("maximum", e.target.value === "" ? undefined : Number(e.target.value))} />
              <input aria-label="单位" placeholder="单位" defaultValue={str(f.unit) ?? ""} onBlur={(e) => set("unit", e.target.value)} />
            </div>)}
            {row("推荐", <input id="rc" className={c.mono} defaultValue={f.recommended === undefined ? "" : JSON.stringify(f.recommended)}
              onBlur={(e) => { try { set("recommended", e.target.value === "" ? undefined : JSON.parse(e.target.value) as Json); } catch { set("recommended", e.target.value); } }} />, "rc")}
            {row("提供", <select id="stId" value={str(f.stepId) ?? ""} onChange={(e) => set("stepId", e.target.value || undefined)}>
              <option value="">按读它的步骤</option>
              {task.steps.map((st, idx) => <option key={String(st.id)} value={String(st.id)}>步骤 {idx + 1} · {str(st.name) ?? String(st.id)}</option>)}
            </select>, "stId")}
            {row("分组", <input id="sc" defaultValue={str(f.section) ?? ""} onBlur={(e) => set("section", e.target.value)} />, "sc")}
            {row("显示条件", <select id="vw" value={isObj(f.visibleWhen) ? condKey(f.visibleWhen) : ""} onChange={(e) => set("visibleWhen", e.target.value ? JSON.parse(e.target.value) as Json : undefined)}>
              <option value="">—</option>
              {fields.filter((x) => x !== f && (!x.visibleWhen || (isObj(f.visibleWhen) && f.visibleWhen.field === x.id))).flatMap((x) => x.widget === "SWITCH"
                ? [true, false].map((on) => { const k = condKey({ field: String(x.id), equals: on }); return <option key={k} value={k}>{str(x.label)} {on ? "开" : "关"}</option>; })
                : objs(x.options).map((o) => { const k = condKey({ field: String(x.id), contains: str(o.value) ?? "" });
                  return <option key={k} value={k}>{str(x.label)} 选「{str(o.label)}」</option>; }))}
            </select>, "vw")}
            {row("必填", <Switch label="必填" checked={f.required === true} onChange={(on) => set("required", on || undefined)} />)}
            {row("用在", usesOf(String(f.id)).length ? <div className={c.uses}>{usesOf(String(f.id)).map((u, i) => <Link key={i} to={u.href} className={c.use}>{u.label} ›</Link>)}</div>
              : <span className={c.warn}>没人读 · 发布前删掉或用上</span>)}
          </section>
        ) : <section className={`${w.card} ${c.form}`}><div className={w.empty}>还没有配置项</div></section>}

        <aside aria-label="玩家看到的" className={c.aside}>
          <span className={c.k}>玩家看到的</span>
          <div className={`${w.card} ${c.preview}`}>
            {groups.map((gname) => (
              <div key={gname} className={c.group}>
                {gname !== "未绑定" && <div className={w.muted}>{gname}</div>}
                {fields.filter((x) => groupOf(x) === gname && visible(x)).map((x) => <Preview key={String(x.id)} field={x} value={values[String(x.id)]}
                  onChange={(v) => setTest({ ...test, [String(x.id)]: v })} />)}
              </div>
            ))}
            {!fields.length && <div className={w.muted}>没有设置</div>}
          </div>
          <button type="button" className={`${w.btn} ${w.primary} ${c.center}`} onClick={() => navigate(`${wbPaths.task(id)}?values=${encodeURIComponent(JSON.stringify(tryValues))}`)}>带回试跑</button>
        </aside>
      </div>
    </>
  );

  function editOption(i: number, key: "label" | "value", value: string) {
    change(String(f!.id), (now) => {
      const list = objs(now.options).map((o) => ({ ...o }));
      if (i === list.length) { if (!value.trim()) return now; list.push({ label: value, value: key === "value" ? value : uniqueId(value, list.map((o) => String(o.value)), "option") }); }
      else if (!list[i] || list[i][key] === value) return now;
      else if (!value.trim() && key === "label") list.splice(i, 1);
      else list[i][key] = value;
      return { ...now, options: list };
    });
  }
}

/** One setting as the console draws it: chips, a stepper, a switch or a field. */
function Preview({ field: x, value, onChange }: { field: Obj; value: Json | undefined; onChange: (v: Json) => void }) {
  const options = objs(x.options);
  const label = str(x.label) ?? String(x.id);
  let control: React.ReactNode;
  if (x.widget === "SWITCH") control = <Switch label={label} checked={value === true} onChange={onChange} />;
  else if (x.widget === "SINGLE_CHOICE") control = <Chips label={label} items={options.map((o, i): [number, string] => [i, str(o.label) ?? ""])}
    value={options.findIndex((o) => o.value === value)} onChange={(i) => onChange(options[i].value as Json)} />;
  else if (x.widget === "MULTI_CHOICE") {
    const cur = Array.isArray(value) ? value : [];
    control = <div className={ui.chips}>{options.map((o) => { const on = cur.includes(o.value as Json);
      return <button key={str(o.value)} type="button" aria-pressed={on} className={join(ui.chip, on && ui.chipOn)}
        onClick={() => onChange(on ? cur.filter((v) => v !== o.value) : [...cur, o.value as Json])}>{str(o.label)}</button>; })}</div>;
  } else if (x.widget === "NUMBER" || x.widget === "RANGE") control = <Stepper label={label} value={typeof value === "number" ? value : undefined}
    min={typeof x.minimum === "number" ? x.minimum : undefined} max={typeof x.maximum === "number" ? x.maximum : undefined} unit={str(x.unit)} onChange={(v) => onChange(v ?? null)} />;
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

/** Where [fid] is read, as short links: 运行条件, a script line's 按设置, an input bound to it, counts, the passive trigger. */
function findUses(raw: Obj, steps: Obj[], lib: Obj[], fid: string, task: string): Use[] {
  const found: Use[] = [];
  const bound = (v: unknown) => isObj(v as never) && (v as Obj).type === "configuration" && (v as Obj).fieldId === fid;
  const walk = (program: Obj[], where: string, href: string) => program.forEach((node) => {
    const a = isObj(node.action) ? node.action : null;
    if (a && isObj(a.bindings)) for (const [input, b] of Object.entries(a.bindings)) if (bound(b)) found.push({ label: `${where} · 输入 ${input}`, href });
    if (node.type === "branch" && bound(node.value)) found.push({ label: `${where} · 分支`, href });
    if ((node.type === "repeat" && bound(node.count)) || (node.type === "until" && bound(node.maximum))) found.push({ label: `${where} · 次数`, href });
    childrenOf(node).forEach(([, child]) => walk(child, where, href));
  });
  const scan = (script: string, where: string, href: (line: number) => string, seen: Set<string>) => script.split("\n").forEach((text, i) => {
    const reads = /^\s*按设置\s+([^\s#]+)/.exec(text);
    if (reads?.[1] === fid) found.push({ label: `${where} · L${i + 1} 按设置`, href: href(i + 1) });
    const calls = /^\s*用\s+([^\s#]+)/.exec(text)?.[1];
    const sn = calls && !seen.has(calls) ? lib.find((x) => x.id === calls) : undefined;
    if (sn && typeof sn.script === "string") { seen.add(calls!); scan(sn.script, `${where} · ${calls}`, (l) => `${devPaths.taskSnippet(task, calls!)}?line=${l}`, seen); }
  });
  for (const st of steps) {
    const name = `步骤 ${steps.indexOf(st) + 1}`;
    const when = isObj(st.when) ? st.when : null;
    if (when && when.field === fid) found.push({ label: `${name} · 运行条件`, href: devPaths.step(task, String(st.id)) });
    const use = str(st.use);
    const sn = use ? lib.find((x) => x.id === use) : undefined;
    const owner = sn ?? st;
    if (typeof owner.script === "string") scan(owner.script, name, (l) => `${devPaths.step(task, String(st.id))}?line=${l}`, new Set(use ? [use] : []));
    else walk(programOf(owner), name, sn ? devPaths.snippetBlocks(use!) : devPaths.blocks(task, String(st.id)));
  }
  const trigger = isObj(raw.trigger) ? raw.trigger : null;
  if (trigger && trigger.enabledBy === fid) found.push({ label: "被动触发", href: devPaths.task(task) });
  return found;
}

/** A display condition as the select's value: its two keys in a fixed order, so the current one is found again. */
function condKey(cond: Obj): string {
  return JSON.stringify(typeof cond.equals === "boolean" ? { field: cond.field, equals: cond.equals } : { field: cond.field, contains: cond.contains });
}
