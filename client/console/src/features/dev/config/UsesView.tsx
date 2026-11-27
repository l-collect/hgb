import type { Json, Obj, SettingUse } from "../api";
import { devPaths } from "../context";
import { Link } from "../../../router";
import { childrenOf, isObj, objs, programOf, str } from "../model";
import { caseValue, readsOf, settingReason, slotOf, slotOfUse, valuesOf, type Slot } from "../settingUse";
import c from "../Config.module.css";

/** Where a setting is read, worked out from the draft (and the server's check when it has answered), and 用在 drawn as a cross-reference. */
export interface Use { label: string; href: string }
/** One value line of a branch on the setting: what it matches, and where it is. */
export interface Handler { value?: Json; otherwise?: boolean; missing?: boolean; text: string; at: Use }
/** Where a setting is read: branches on it (each with its value lines), numbers it stands for, and the rest. */
export interface Uses { branches: { at: Use; cases: Handler[] }[]; numbers: { role: string; at: Use; slot: Slot | null; fallback: string | null }[]; other: Use[] }
/** How a number use takes [f] where it is (the engine's rule for that place); null when fine. */
export const numberProblem = (f: Obj, fields: Obj[], n: Uses["numbers"][number]) => n.slot ? settingReason(String(f.id), n.fallback, n.slot, fields) : null;
/** What is wrong with a setting's uses: bad (a number out of its place's range, a value not among the options), warn (a value nobody handles, nobody reads it). */
export function standingOf(f: Obj, fields: Obj[], uses: Uses): "bad" | "warn" | null {
  if (uses.numbers.some((n) => numberProblem(f, fields, n))) return "bad";
  const values = valuesOf(f);
  const known = new Set(values.map((x) => JSON.stringify(x.value)));
  if (values.length && uses.branches.some((b) => b.cases.some((cs) => !cs.otherwise && !cs.missing && !known.has(JSON.stringify(cs.value))))) return "bad";
  if (!uses.branches.length && !uses.numbers.length && !uses.other.length) return "warn";
  if (uses.branches.some((b) => !b.cases.some((cs) => cs.otherwise) && values.some((v) => !b.cases.some((cs) => !cs.otherwise && !cs.missing && cs.value === v.value)))) return "warn";
  return null;
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

export function UsesView({ field, fields, uses }: { field: Obj; fields: Obj[]; uses: Uses }) {
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
