import { useEffect, useState } from "react";
import { Chips, Stepper, Switch, join, ui } from "../../components/ui";
import { TimePicker } from "../../components/TimePicker";
import { Link, navigate, useQuery } from "../../router";
import { NameButton } from "./NameButton";
import { dev, type Json, type Obj, type SettingUse } from "./api";
import { devPaths, useDev } from "./context";
import { uniqueId } from "./HomePage";
import { childIds, childrenOf, isObj, nodeDigest, objs, programOf, snippets, str, tasks } from "./model";
import { caseValue, readsAsNumber, readsOf, settingReason, slotOf, slotOfUse, valuesOf, type Slot } from "./settingUse";
import { wbPaths } from "./wb";
import w from "./Wb.module.css";
import c from "./Config.module.css";

const WIDGETS: [string, string][] = [["SINGLE_CHOICE", "单选"], ["MULTI_CHOICE", "多选"], ["NUMBER", "数字"], ["RANGE", "范围"],
  ["SWITCH", "开关"], ["TIME", "时间"], ["DATE", "日期"], ["DATE_RANGE", "日期段"], ["TEXT", "文字"]];
interface Use { label: string; href: string }
/** One value line of a branch on the setting: what it matches, and where it is. */
interface Handler { value?: Json; otherwise?: boolean; missing?: boolean; text: string; at: Use }
/** Where a setting is read: branches on it (each with its value lines), numbers it stands for, and the rest. */
interface Uses { branches: { at: Use; cases: Handler[] }[]; numbers: { role: string; at: Use; slot: Slot | null; fallback: string | null }[]; other: Use[] }
/** How a number use takes [f] where it is (the engine's rule for that place); null when fine. */
const numberProblem = (f: Obj, fields: Obj[], n: Uses["numbers"][number]) => n.slot ? settingReason(String(f.id), n.fallback, n.slot, fields) : null;
/** What is wrong with a setting's uses: bad (a number out of its place's range, a value not among the options), warn (a value nobody handles, nobody reads it). */
function standingOf(f: Obj, fields: Obj[], uses: Uses): "bad" | "warn" | null {
  if (uses.numbers.some((n) => numberProblem(f, fields, n))) return "bad";
  const values = valuesOf(f);
  const known = new Set(values.map((x) => JSON.stringify(x.value)));
  if (values.length && uses.branches.some((b) => b.cases.some((cs) => !cs.otherwise && !cs.missing && !known.has(JSON.stringify(cs.value))))) return "bad";
  if (!uses.branches.length && !uses.numbers.length && !uses.other.length) return "warn";
  if (uses.branches.some((b) => !b.cases.some((cs) => cs.otherwise) && values.some((v) => !b.cases.some((cs) => !cs.otherwise && !cs.missing && cs.value === v.value)))) return "warn";
  return null;
}

/** 配置项 (v7 V7WbConfig): fields | the selected one's form and where it is read | what the player sees, whose values a trial takes. */
export function ConfigPage({ id }: { id: string }) {
  const { draft, apply } = useDev();
  const [pick, setPick] = useState(0);
  // ?field=<id> (the editor's 去配置项) opens on that setting.
  const wanted = useQuery().get("field");
  const [test, setTest] = useState<Obj>({});
  const [text, setText] = useState<string | null>(null);
  const task = draft ? tasks(draft.body).find((x) => x.id === id) : undefined;
  const wantedAt = wanted && task ? task.fields.findIndex((x) => String(x.id) === wanted) : -1;
  useEffect(() => { if (wantedAt >= 0) setPick(wantedAt); }, [wanted, wantedAt >= 0]); // eslint-disable-line react-hooks/exhaustive-deps
  // Where the server's check says each setting is read (it compiles the scripts, so it sees every {x}); null until it
  // answers, or when it is an older server: then the scripts are read here.
  const [served, setServed] = useState<SettingUse[] | null>(null);
  const body = draft?.body;
  useEffect(() => {
    setServed(null);
    if (!body || !task) return;
    let live = true;
    const timer = setTimeout(() => {
      dev.check({ bundle: body, task: id, measure: false }).then((r) => { if (live) setServed(r.settingUses ?? null); }, () => undefined);
    }, 400);
    return () => { live = false; clearTimeout(timer); };
  }, [body, id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!draft || !task) return <div className={w.card}><div className={w.empty}>草稿里没有这个任务</div></div>;
  const fields = task.fields;

  const f = fields[Math.min(pick, fields.length - 1)];
  const lib = snippets(draft.body);
  const usesOf = (fid: string) => findUses(task.raw, task.steps, lib, fid, id, served);
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
    if (wanted && childIds(task.raw).includes(wanted)) { setText(`编号 ${wanted} 已有，换一个`); return; }
    const problem = await apply([{ op: "insert", path: `tasks:${id}`, field: "fields", after: fields.length ? String(fields.at(-1)!.id) : null, value: { id: fid, label, widget: "SWITCH" } }]);
    if (problem) setText(problem); else setPick(fields.length);
  };
  const stepOf = (x: Obj) => {
    const sid = str(x.stepId);
    if (!sid) return str(x.section) ? `分组 ${str(x.section)}` : "随步骤";
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
        <NameButton label="＋ 配置项" placeholder="名称" askId idOptional className={w.btn} onName={add} />
      </header>
      {text && <div className={w.message} role="status">{text}</div>}
      <div className={c.layout}>
        <nav aria-label="配置项" className={`${w.card} ${c.nav}`}>
          {fields.map((x, i) => { const tone = standingOf(x, fields, usesOf(String(x.id)));
            return <button key={String(x.id)} type="button" className={c.field} aria-current={i === pick ? "true" : undefined} style={{ paddingLeft: x.visibleWhen ? 22 : undefined }} onClick={() => setPick(i)}>
              <b className={c.name}>{str(x.label)}{tone && <span className={c.flag} data-tone={tone} aria-label={tone === "bad" ? "用法有错" : "有没处理的值"} />}</b><span className={w.muted}>{stepOf(x)} · {widgetOf(x)}</span>
            </button>; })}
          {!fields.length && <div className={w.empty}>还没有</div>}
        </nav>

        {f ? (
          <section aria-label="字段" key={String(f.id)} className={`${w.card} ${c.form}`}>
            {row("名称", <input id="lb" defaultValue={str(f.label)} onBlur={(e) => e.target.value !== f.label && set("label", e.target.value)} />, "lb")}
            {row("编号", <IdLine field={f} />)}
            {row("说明", <input id="ds" defaultValue={str(f.description) ?? ""} placeholder="一行内" onBlur={(e) => e.target.value !== (f.description ?? "") && set("description", e.target.value)} />, "ds")}
            {row("控件", <select id="wd" value={str(f.widget)} onChange={(e) => set("widget", e.target.value)}>
              {!WIDGETS.some(([k]) => k === f.widget) && <option value={str(f.widget)}>{str(f.widget)}</option>}
              {WIDGETS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}</select>, "wd")}
            {(f.widget === "SINGLE_CHOICE" || f.widget === "MULTI_CHOICE") && row("选项", <div className={c.options}>
              <div className={c.optionHead}><span>玩家看到</span><span>脚本里写</span></div>
              {[...objs(f.options), { label: "", value: "" }].map((o, i) => (
                <div key={`${i}/${objs(f.options).length}`} className={c.option}>
                  <input aria-label="显示" defaultValue={str(o.label)} placeholder={i === objs(f.options).length ? "＋ 选项" : ""} onBlur={(e) => editOption(i, "label", e.target.value)} />
                  <input aria-label="值" className={c.mono} defaultValue={str(o.value)} onBlur={(e) => editOption(i, "value", e.target.value)} />
                </div>
              ))}</div>)}
            {(f.widget === "NUMBER" || f.widget === "RANGE") && (() => {
              // A {x} somewhere this setting cannot be read as it is: the range is what to change.
              const off = usesOf(String(f.id)).numbers.some((n) => numberProblem(f, fields, n));
              const num = (k: string, label: string) => <input aria-label={label} inputMode="decimal" className={ui.numberInput} placeholder={label} data-bad={off || undefined}
                defaultValue={f[k] === undefined ? "" : String(f[k])} onBlur={(e) => { const v = e.target.value.trim(); set(k, v === "" || Number.isNaN(Number(v)) ? undefined : Number(v)); }} />;
              return row("范围", <div className={c.option}>
                {num("minimum", "最小")}{num("maximum", "最大")}{num("step", "步长")}
                <input aria-label="单位" placeholder="单位" defaultValue={str(f.unit) ?? ""} onBlur={(e) => set("unit", e.target.value)} />
              </div>);
            })()}
            {row("推荐", <Recommended field={f} onChange={(v) => set("recommended", v)} />)}
            {row("归在", <div className={c.stack}><select id="stId" value={str(f.stepId) ?? ""} onChange={(e) => set("stepId", e.target.value || undefined)}>
              <option value="">随步骤</option>
              {task.steps.map((st, idx) => <option key={String(st.id)} value={String(st.id)}>步骤 {idx + 1} · {str(st.name) ?? String(st.id)}</option>)}
            </select><span className={c.hint}>决定玩家界面里归在哪一步下；脚本任意位置都能读</span></div>, "stId")}
            {row("分组", <input id="sc" defaultValue={str(f.section) ?? ""} onBlur={(e) => set("section", e.target.value)} />, "sc")}
            {row("显示条件", <select id="vw" value={isObj(f.visibleWhen) ? condKey(f.visibleWhen) : ""} onChange={(e) => set("visibleWhen", e.target.value ? JSON.parse(e.target.value) as Json : undefined)}>
              <option value="">—</option>
              {fields.filter((x) => x !== f && (!x.visibleWhen || (isObj(f.visibleWhen) && f.visibleWhen.field === x.id))).flatMap((x) => x.widget === "SWITCH"
                ? [true, false].map((on) => { const k = condKey({ field: String(x.id), equals: on }); return <option key={k} value={k}>{str(x.label)} {on ? "开" : "关"}</option>; })
                : objs(x.options).map((o) => { const k = condKey({ field: String(x.id), contains: str(o.value) ?? "" });
                  return <option key={k} value={k}>{str(x.label)} 选「{str(o.label)}」</option>; }))}
            </select>, "vw")}
            {row("必填", <Switch label="必填" checked={f.required === true} onChange={(on) => set("required", on || undefined)} />)}
            <div className={c.row} style={{ alignItems: "flex-start" }}><span className={c.k} style={{ paddingTop: 10 }}>用在</span>
              <div className={c.v}><UsesView field={f} fields={fields} uses={usesOf(String(f.id))} /></div></div>
          </section>
        ) : <section className={`${w.card} ${c.form}`}><div className={w.empty}>还没有配置项</div></section>}

        <aside aria-label="玩家看到的" className={c.aside}>
          <span className={c.k}>玩家看到的</span>
          <div className={`${w.card} ${c.preview}`}>
            {groups.map((gname) => (
              <div key={gname} className={c.group}>
                {gname !== "随步骤" && <div className={w.muted}>{gname}</div>}
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
  } else if (x.widget === "NUMBER" || x.widget === "RANGE") control = <Stepper label={label} value={typeof value === "number" || typeof value === "string" ? value : undefined}
    min={typeof x.minimum === "number" ? x.minimum : undefined} max={typeof x.maximum === "number" ? x.maximum : undefined} step={typeof x.step === "number" && x.step > 0 ? x.step : 1} unit={str(x.unit)} clearable={x.required !== true} onChange={(v) => onChange(v ?? null)} />;
  else if (x.widget === "TIME") control = <TimePicker label={label} value={typeof value === "string" ? value : ""} clearable={x.required !== true} onChange={(v) => onChange(v || null)} />;
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

/** What a number read from a setting counts, by the action input it fills (the engine's SettingUse). */
const INPUT_ROLES: Record<string, string> = { durationMs: "等待秒数", timeoutMs: "最多秒数", maximum: "点击次数" };
const caseText = (v: Json | undefined) => v === true ? "开" : v === false ? "关" : typeof v === "string" ? v : JSON.stringify(v);

/**
 * Where [fid] is read: 运行条件, each 按设置 with its value lines, each {fid} as a number, block inputs and branches, the
 * passive trigger. [served]: the server's [SettingUse]s for this task, used for the steps' own scripts and programs when
 * given; the snippets they call, 运行条件 and the trigger are read here either way.
 */
export function findUses(raw: Obj, steps: Obj[], lib: Obj[], fid: string, task: string, served: SettingUse[] | null = null): Uses {
  const found: Uses = { branches: [], numbers: [], other: [] };
  const field = objs(raw.fields).find((x) => x.id === fid);
  const bound = (v: unknown) => isObj(v as never) && (v as Obj).type === "configuration" && (v as Obj).fieldId === fid;
  const walk = (program: Obj[], where: string, href: string) => program.forEach((node) => {
    const a = isObj(node.action) ? node.action : null;
    if (a && isObj(a.bindings)) for (const [input, b] of Object.entries(a.bindings)) if (bound(b)) found.other.push({ label: `${where} · 输入 ${input}`, href });
    if (node.type === "branch" && bound(node.value)) {
      const at = { label: `${where} · 分支`, href };
      found.branches.push({ at, cases: objs(node.cases).map((cs) => ({ value: cs.equals as Json | undefined, otherwise: cs.otherwise === true || undefined, missing: cs.missing === true || undefined,
        text: cs.otherwise === true ? "其他" : cs.missing === true ? "没有值" : JSON.stringify(cs.equals), at })) });
    }
    if ((node.type === "repeat" && bound(node.count)) || (node.type === "until" && bound(node.maximum))) {
      const b = (node.type === "repeat" ? node.count : node.maximum) as Obj;
      found.numbers.push({ role: node.type === "repeat" ? "反复次数" : "直到次数", at: { label: where, href }, slot: slotOfUse(String(node.type)), fallback: b.default === undefined || b.default === null ? null : String(b.default) });
    }
    childrenOf(node).forEach(([, child]) => walk(child, where, href));
  });
  const fromServer = (u: SettingUse, where: string, href: (line: number | null) => string) => {
    const at = (line: number | null | undefined) => ({ label: line ? `${where} · L${line}` : where, href: href(line ?? null) });
    const fallback = u.default !== undefined && u.default !== null ? ` · 没值时 ${String(u.default)}` : "";
    const given = u.default !== undefined && u.default !== null ? String(u.default) : null;
    if (u.kind === "branch") found.branches.push({ at: at(u.line), cases: (u.cases ?? []).map((cs) => ({
      value: cs.test === "equals" || cs.test === "contains" ? cs.value : undefined, otherwise: cs.test === "otherwise" || undefined, missing: cs.test === "missing" || undefined,
      text: cs.test === "otherwise" ? "其他" : cs.test === "missing" ? "没有值" : cs.test === "range" ? `${String(cs.atLeast ?? "")}–${String(cs.atMost ?? "")}` : caseText(cs.value),
      at: at(cs.line ?? u.line) })) });
    else if (u.kind === "repeat" || u.kind === "until") found.numbers.push({ role: (u.kind === "repeat" ? "反复次数" : "直到次数") + fallback, at: at(u.line), slot: slotOfUse(u.kind), fallback: given });
    else if (u.kind === "input") {
      if (u.scale !== undefined && u.scale !== null) found.numbers.push({ role: (INPUT_ROLES[String(u.input)] ?? `输入 ${String(u.input)}`) + fallback, at: at(u.line), slot: slotOfUse(u.kind, u.input, u.capability), fallback: given });
      else found.other.push({ label: `${at(u.line).label} · 输入 ${String(u.input)}`, href: href(u.line ?? null) });
    }
  };
  const scan = (script: string, where: string, href: (line: number) => string, seen: Set<string>, own = true) => {
    const { reads, calls } = readsOf(script);
    const at = (line: number) => ({ label: `${where} · L${line}`, href: href(line) });
    for (const r of own ? reads : []) {
      if (r.field !== fid) continue;
      if (r.kind === "number") { found.numbers.push({ role: r.role, at: at(r.line), slot: slotOf(r.head, r.unit), fallback: r.fallback }); continue; }
      found.branches.push({ at: at(r.line), cases: r.cases.map((cs) => ({ ...(caseValue(field, cs) ?? {}), text: cs.text, at: at(cs.line) })) });
    }
    for (const call of calls) {
      const sn = !seen.has(call.snippet) ? lib.find((x) => x.id === call.snippet) : undefined;
      if (sn && typeof sn.script === "string") { seen.add(call.snippet); scan(sn.script, `${where} · ${call.snippet}`, (l) => `${devPaths.taskSnippet(task, call.snippet)}?line=${l}`, seen); }
    }
  };
  for (const st of steps) {
    const name = `步骤 ${steps.indexOf(st) + 1}`;
    const when = isObj(st.when) ? st.when : null;
    if (when && when.field === fid) found.other.push({ label: `${name} · 运行条件`, href: devPaths.step(task, String(st.id)) });
    const use = str(st.use);
    const sn = use ? lib.find((x) => x.id === use) : undefined;
    const owner = sn ?? st;
    const scriptHref = (l: number) => `${devPaths.step(task, String(st.id))}?line=${l}`;
    if (served && !sn) {
      // A line under 逐个 is compiled once per value: one use per line is enough here.
      const seenUse = new Set<string>();
      served.filter((u) => u.field === fid && u.task === task && u.step === st.id)
        .filter((u) => { const k = `${u.kind}|${u.line ?? u.path}|${u.input ?? ""}`; if (seenUse.has(k)) return false; seenUse.add(k); return true; })
        .forEach((u) => fromServer(u, name, (l) => typeof st.script === "string" && l ? scriptHref(l) : devPaths.blocks(task, String(st.id))));
      // The server does not follow 用 into snippets: those are still read here.
      if (typeof st.script === "string") scan(st.script, name, scriptHref, new Set(), false);
    } else if (typeof owner.script === "string") scan(owner.script, name, scriptHref, new Set(use ? [use] : []));
    else walk(programOf(owner), name, sn ? devPaths.snippetBlocks(use!) : devPaths.blocks(task, String(st.id)));
  }
  const trigger = isObj(raw.trigger) ? raw.trigger : null;
  if (trigger && trigger.enabledBy === fid) found.other.push({ label: "被动触发", href: devPaths.task(task) });
  return found;
}

/** 用在 as a cross-reference: for a switch or choice, each value and where it is handled (or that nothing handles it); numbers by what they count. */

function UsesView({ field, fields, uses }: { field: Obj; fields: Obj[]; uses: Uses }) {
  const { branches, numbers, other } = uses;
  if (!branches.length && !numbers.length && !other.length) return <span className={c.warn}>没人读 · 发布前删掉或用上</span>;
  const values = valuesOf(field);
  const many = branches.length > 1;
  const go = (u: Use, text = u.label) => <Link to={u.href} className={c.use}>{text} ›</Link>;
  const short = (u: Use) => u.label.split(" · ").pop()!;
  /** 「步骤 1 · L2」 said short, for a header: 「步骤1 L2」. */
  const compact = (u: Use) => u.label.replace(/步骤 (\d+)/g, "步骤$1").replace(/ · /g, " ");
  /** How one branch takes [v]: its own line, its 其他, or nothing. With several branches each is a column and cells give only the line. */
  const take = (b: Uses["branches"][number], v: Json) => {
    const own = b.cases.find((cs) => !cs.otherwise && !cs.missing && cs.value === v);
    if (own) return go(own.at, many ? short(own.at) : own.at.label);
    const rest = b.cases.find((cs) => cs.otherwise);
    if (rest) return <span className={c.muted}>其他 {go(rest.at, short(rest.at))}</span>;
    return <span className={c.warn}>{many ? "没写分支" : "没写分支：选它时什么也不做"}</span>;
  };
  const known = new Set(values.map((x) => JSON.stringify(x.value)));
  const strays = (b: Uses["branches"][number]) => b.cases.filter((cs) => !cs.otherwise && (cs.missing || !known.has(JSON.stringify(cs.value))));
  const strayRows = branches.flatMap((b, col) => strays(b).map((cs) => ({ col, cs })));
  return (
    <div className={c.usesBox}>
      {branches.length > 0 && values.length > 0 && <table className={c.map}>
        <thead><tr><th>取值</th>{many ? branches.map((b, i) => <th key={i}>按设置 {go(b.at, compact(b.at))}</th>) : <th><span className={c.thin}>按设置 {go(branches[0].at, compact(branches[0].at))}</span></th>}</tr></thead>
        <tbody>
          {values.map((x) => <tr key={x.word}><td>{x.label}{x.label !== x.word && <span className={c.muted}> {x.word}</span>}</td>
            {branches.map((b, i) => <td key={i}>{take(b, x.value)}</td>)}</tr>)}
          {strayRows.map(({ col, cs }, i) => <tr key={`s${i}`}><td>{cs.text}</td>
            {branches.map((_, j) => <td key={j}>{j !== col ? null : cs.missing ? <span className={c.muted}>没设值时 {go(cs.at, many ? short(cs.at) : cs.at.label)}</span>
              : <span className={c.warn}>不在选项里 {go(cs.at, many ? short(cs.at) : cs.at.label)}</span>}</td>)}</tr>)}
        </tbody>
      </table>}
      {branches.length > 0 && !values.length && <div className={c.uses}>{branches.map((b, i) => <span key={i}>{go(b.at, `按设置 ${b.at.label}`)} <span className={c.muted}>{b.cases.map((cs) => cs.text).join(" / ")}</span></span>)}</div>}
      {numbers.length > 0 && <div className={c.numbers}>{numbers.map((n, i) => { const why = numberProblem(field, fields, n);
        return <div key={i} className={c.numberUse} data-bad={why ? "true" : undefined}><span><span className={c.muted}>用作</span> {n.role} {go(n.at)}</span>
          {why && <span className={c.warn}>{why}</span>}</div>; })}</div>}
      {other.length > 0 && <div className={c.uses}>{other.map((u, i) => <span key={i}>{go(u)}</span>)}</div>}
    </div>
  );
}

/** 编号: the setting's id as the script writes it, and how to read it there, to copy. */
function IdLine({ field: f }: { field: Obj }) {
  const id = String(f.id);
  const [copied, setCopied] = useState(false);
  const choice = f.widget === "SWITCH" || f.widget === "SINGLE_CHOICE" || f.widget === "MULTI_CHOICE";
  const snippet = choice && !(f.widget === "SINGLE_CHOICE" && readsAsNumber(f)) ? `按设置 ${id}` : readsAsNumber(f) ? `{${id}}` : null;
  return <div className={c.idLine}>
    <code className={c.idCode} title="编号写进任务包和账号配置，改了旧配置就对不上">{id}</code>
    {snippet && <button type="button" className={`${w.btn} ${w.sm}`} onClick={() => { void navigator.clipboard?.writeText(snippet); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
      {copied ? "已复制" : `复制 ${snippet}`}</button>}
  </div>;
}

/** 推荐 by the setting's own control: a switch, a list of its options, a stepper, a time; each with 不设. */
function Recommended({ field: f, onChange }: { field: Obj; onChange: (v: Json | undefined) => void }) {
  const v = f.recommended;
  const unset = v === undefined || v === null;
  const clear = !unset && <button type="button" className={`${w.btn} ${w.sm}`} onClick={() => onChange(undefined)}>不设</button>;
  if (f.widget === "SWITCH") return <div className={c.recommend}><Switch label="推荐" checked={v === true} onChange={(on) => onChange(on)} />
    <span className={c.muted}>{unset ? "不设" : v === true ? "开" : "关"}</span>{clear}</div>;
  if (f.widget === "SINGLE_CHOICE") return <select id="rc" aria-label="推荐" className={c.select} value={unset ? "" : JSON.stringify(v)} onChange={(e) => onChange(e.target.value ? JSON.parse(e.target.value) as Json : undefined)}>
    <option value="">不设</option>
    {objs(f.options).map((o) => <option key={JSON.stringify(o.value)} value={JSON.stringify(o.value)}>{str(o.label) ?? String(o.value)}</option>)}
  </select>;
  if (f.widget === "MULTI_CHOICE") {
    const cur = Array.isArray(v) ? v : [];
    return <div className={c.recommend}><div className={ui.chips}>{objs(f.options).map((o) => { const on = cur.includes(o.value as Json);
      return <button key={str(o.value)} type="button" aria-pressed={on} className={join(ui.chip, on && ui.chipOn)}
        onClick={() => { const next = on ? cur.filter((x) => x !== o.value) : [...cur, o.value as Json]; onChange(next.length ? next : undefined); }}>{str(o.label) ?? String(o.value)}</button>; })}</div>
      {unset && <span className={c.muted}>不设</span>}</div>;
  }
  if (f.widget === "NUMBER" || f.widget === "RANGE") return <div className={c.recommend}>
    <Stepper label="推荐" value={typeof v === "number" || typeof v === "string" ? v : undefined} placeholder="不设" clearable
      min={typeof f.minimum === "number" ? f.minimum : undefined} max={typeof f.maximum === "number" ? f.maximum : undefined}
      step={typeof f.step === "number" && f.step > 0 ? f.step : 1} unit={str(f.unit)} onChange={(n) => onChange(n)} />{clear}</div>;
  if (f.widget === "TIME") return <div className={c.recommend}><TimePicker label="推荐" value={typeof v === "string" ? v : ""} clearable onChange={(t) => onChange(t || undefined)} />{clear}</div>;
  return <input id="rc" aria-label="推荐" defaultValue={typeof v === "string" ? v : unset ? "" : JSON.stringify(v)} placeholder="不设" onBlur={(e) => onChange(e.target.value === "" ? undefined : e.target.value)} />;
}

/** A display condition as the select's value: its two keys in a fixed order, so the current one is found again. */
function condKey(cond: Obj): string {
  return JSON.stringify(typeof cond.equals === "boolean" ? { field: cond.field, equals: cond.equals } : { field: cond.field, contains: cond.contains });
}
