import { useEffect, useMemo, useRef, useState } from "react";
import { ApiFailure } from "../../api/client";
import { Pill, SegmentTabs } from "../../components/ui";
import { dev, type Obj, type Sample } from "./api";
import { failure, useDev } from "./context";
import { GameCard } from "./GamePage";
import { describeInterruption, InterruptionForm } from "./Interruptions";
import { childIds, inlineStates, isObj, objs, states, str, target } from "./model";
import { judge, pageProbe, PageDefForm, RouteForm, serverIdOf, useLibrarySave, type Cell, type Column, type JudgeTable } from "./PageGraph";
import { conditionsOf, entryId, pageWaits, recognitionLine, type Wait } from "./StatesPage";
import { useDevice } from "./wb";
import { useQuery } from "../../router";
import w from "./Wb.module.css";
import g from "./Game.module.css";
import st from "./States.module.css";

type Tab = "pages" | "interruptions" | "states";

/** 页面: the game's pages, interruption pages and states; for a page its recognition, routes and the 判定 matrix (samples × pages). */
export function PagesPage() {
  const { draft, game } = useDev();
  const phone = useDevice();
  const save = useLibrarySave();
  const [tab, setTab] = useState<Tab>("pages");
  // ?page=<id> (the script editor's 在「页面」里打开): that page picked.
  const [pick, setPick] = useState<string | null>(useQuery().get("page"));
  const [samples, setSamples] = useState<Sample[]>([]);
  const [serverWaits, setServerWaits] = useState<Wait[] | null>(null);
  const [table, setTable] = useState<JudgeTable | null>(null);
  const [waitTable, setWaitTable] = useState<JudgeTable | null>(null);
  const [waitKey, setWaitKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [routesOpen, setRoutesOpen] = useState(false);
  const [editRoute, setEditRoute] = useState<string | null>(null);
  const [allRows, setAllRows] = useState(false);
  const pass = useRef(0);
  // Which table the running pass fills: a wait's table belongs to the state picked, so changing it drops that pass.
  const passInto = useRef<"pages" | "wait" | null>(null);
  useEffect(() => { dev.samples(game).then(setSamples, () => {}); }, [game]);
  // The server's waits are the draft's, compiled: once per revision (a draft read back again at the same one keeps them).
  const waitsOf = useRef<string | null>(null);
  useEffect(() => {
    if (!draft) return;
    const key = JSON.stringify([game, draft.revision]);
    if (waitsOf.current === key) return;
    waitsOf.current = null;
    let live = true;
    dev.waits(game).then((x) => { if (live) { waitsOf.current = key; setServerWaits(x); } }, () => { if (live) setServerWaits(null); });
    return () => { live = false; };
  }, [game, draft?.revision]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    setEditing(null); setEditRoute(null); setRoutesOpen(false); setAllRows(false); setWaitTable(null);
    if (passInto.current === "wait") { pass.current++; passInto.current = null; setBusy(false); }
  }, [pick, tab]);
  const waits = useMemo(() => serverWaits ?? (draft ? pageWaits(draft.body) : []), [serverWaits, draft]);
  if (!draft) return null;
  const app = target(draft.body, game);
  const library = isObj(app?.library) ? app!.library : {};
  const pages = objs(library.pages), routes = objs(library.routes), interruptions = objs(library.interruptions);
  const known = states(draft.body, game);
  const stateList: { key: string; state: Obj; where: string }[] = [
    ...known.map((s) => ({ key: `lib/${String(s.id)}`, state: s, where: "状态库" })),
    ...inlineStates(draft.body),
  ];
  const lib = objs(draft.body.snippets);
  const taken = app ? childIds(app) : [];
  const device = phone?.online ? phone.id : null;
  const nameOf = (id: string) => str(pages.find((p) => p.id === id)?.name) ?? id;

  // What the server can judge pages by: library states and every wait's candidates.
  const serverKnown = new Set<string>([...known.map((s) => String(s.id)), ...waits.flatMap((x) => x.states.map(entryId)).filter((x): x is string => !!x)]);
  const columns: Column[] = pages.map((p) => ({ id: String(p.id), serverId: serverIdOf(p, serverKnown), probe: pageProbe(p) }));
  const prio = new Map(pages.map((p) => [String(p.id), typeof p.priority === "number" ? p.priority : 0]));
  const analysis = analyse(table, pages, samples, prio);

  const run = async (cols: Column[], phoneOnly: boolean, into: "pages" | "wait") => {
    const n = ++pass.current;
    passInto.current = into;
    setBusy(true); setText(null);
    const set = into === "pages" ? setTable : setWaitTable;
    const before = into === "pages" ? table : waitTable;
    const merge = (t: JudgeTable): JudgeTable => !phoneOnly || !before ? t : {
      ...t, by: "phone", rows: before.rows.map((r) => { const got = t.rows.find((x) => x.sample === r.sample)?.cells;
        return { ...r, cells: typeof got === "string" ? got : typeof r.cells === "string" ? r.cells : { ...r.cells, ...(got ?? {}) } }; }),
    };
    try { await judge(game, cols, samples, device, (t) => { if (n === pass.current) set(merge(t)); }, () => n === pass.current, phoneOnly); }
    catch (error) { if (n === pass.current) setText(error instanceof Error && !(error instanceof ApiFailure) ? error.message : failure(error)); }
    if (n === pass.current) { setBusy(false); passInto.current = null; }
  };

  const count = { pages: pages.length, interruptions: interruptions.length, states: stateList.length };
  const listItems: { id: string; name: string; aside?: React.ReactNode; indent?: boolean }[] =
    tab === "pages" ? pages.map((p) => ({ id: String(p.id), name: str(p.name) ?? String(p.id), aside: pagePill(analysis.byPage.get(String(p.id))) }))
      : tab === "interruptions" ? interruptions.map((p) => ({ id: String(p.id), name: str(p.name) ?? String(p.id), aside: <span className={w.muted}>≤ {typeof p.maximum === "number" ? p.maximum : 3}</span> }))
      : stateList.map((x) => ({ id: x.key, name: str(x.state.name) ?? str(x.state.id) ?? "", aside: <span className={w.muted}>{x.where === "状态库" ? "库" : "内联"}</span>, indent: !!str(x.state.base) }));
  const current = listItems.find((x) => x.id === pick) ?? listItems[0];

  const right = (() => {
    if (editing === "new") {
      if (tab === "pages") return <PageDefForm known={known} taken={taken} onCancel={() => setEditing(null)}
        onSave={async (next) => { const p = await save("pages", null, next); if (p) setText(p); else { setEditing(null); setPick(String(next.id)); } }} />;
      if (tab === "interruptions") return <InterruptionForm lib={lib} known={known} taken={taken} onCancel={() => setEditing(null)}
        onSave={async (next) => { const p = await save("interruptions", null, next); if (p) setText(p); else { setEditing(null); setPick(String(next.id)); } }} />;
    }
    if (!current) return <div className={`${w.card} ${w.empty}`}>{tab === "states" ? "还没有状态" : "还没有，点「＋」加一个"}</div>;
    if (tab === "pages") {
      const page = pages.find((p) => p.id === current.id)!;
      const pid = String(page.id);
      const mine = routes.filter((r) => r.from === pid || r.to === pid);
      const path = shortest(pages, routes, String(pages[0]?.id ?? ""), pid);
      const info = analysis.byPage.get(pid);
      const relevant = table ? table.rows.filter((r) => allRows || (typeof r.cells === "string") || r.cells[pid]?.holds || r.cells[pid]?.unknown || expected(r.name, nameOf(pid))) : [];
      const others = table ? pages.map((p) => String(p.id)).filter((id) => id !== pid && relevant.some((r) => typeof r.cells !== "string" && (r.cells[id]?.holds || r.cells[id]?.unknown))) : [];
      const unknownCols = table ? columns.filter((c) => table.rows.some((r) => typeof r.cells !== "string" && r.cells[c.id]?.unknown)) : [];
      return (
        <>
          <div className={st.head}>
            <h2 className={st.title}>{current.name}</h2>
            <button type="button" className={w.btn} onClick={() => setEditing(editing === pid ? null : pid)}>改认法</button>
            <button type="button" className={`${w.btn} ${w.primary}`} disabled={busy || !samples.length || !pages.length} onClick={() => void run(columns, false, "pages")}>
              {busy && table ? `判定中 ${table.rows.filter((r) => typeof r.cells === "string" || Object.keys(r.cells).length).length}/${samples.length}…` : busy ? "判定中…" : `在 ${samples.length} 张样本上判`}</button>
          </div>
          {editing === pid ? <PageDefForm key={pid} page={page} known={known} onCancel={() => setEditing(null)}
            onSave={async (next) => { const p = await save("pages", pid, next); if (p) setText(p); else setEditing(null); }}
            onDelete={async () => { const p = await save("pages", pid, null); if (p) setText(p); else { setEditing(null); setPick(null); } }} /> : null}
          <div className={`${w.card} ${st.facts}`}>
            <div className={st.fact}><span className={st.k}>认法</span><span className={`${st.mono} ${st.grow}`}>{recognitionLine(page.state, known)}{typeof page.priority === "number" && page.priority ? ` · 优先级 ${page.priority}` : ""}</span></div>
            <button type="button" className={`${st.fact} ${st.factButton}`} aria-expanded={routesOpen} onClick={() => setRoutesOpen(!routesOpen)}>
              <span className={st.k}>路线</span>
              <span className={st.grow}>{pid === String(pages[0]?.id) ? "起点" : path ? <>{path.ids.map((id, i) => <span key={i}>{i > 0 && " → "}{id === pid ? <b>{nameOf(id)}</b> : nameOf(id)}</span>)} · 代价 {path.cost}</> : "走不到"}</span>
              <span className={w.muted}>{mine.length} 条 {routesOpen ? "▾" : "›"}</span>
            </button>
            {routesOpen && <div className={st.routes}>
              {mine.map((r) => editRoute === r.id
                ? <RouteForm key={String(r.id)} route={r} pages={pages} lib={lib} onCancel={() => setEditRoute(null)}
                    onSave={async (n) => { const p = await save("routes", String(r.id), n); if (p) setText(p); else setEditRoute(null); }}
                    onDelete={async () => { const p = await save("routes", String(r.id), null); if (p) setText(p); else setEditRoute(null); }} />
                : <button key={String(r.id)} type="button" className={`${g.row} ${g.rowButton}`} onClick={() => setEditRoute(String(r.id))}>
                    <b className={g.nowrap}>{nameOf(String(r.from))} → {nameOf(String(r.to))}</b>
                    <span className={`${w.muted} ${g.grow} ${g.clip}`}>片段 {str(lib.find((sn) => sn.id === r.use)?.name) ?? String(r.use)}</span>
                    <span className={`${w.chip} ${w.same}`}>代价 {typeof r.cost === "number" ? r.cost : 1}</span>
                  </button>)}
              {editRoute === "new" ? <RouteForm pages={pages} lib={lib} taken={taken} from={pid} onCancel={() => setEditRoute(null)}
                onSave={async (n) => { const p = await save("routes", null, n); if (p) setText(p); else setEditRoute(null); }} />
                : <button type="button" className={w.btn} style={{ alignSelf: "flex-start", minHeight: 32 }} disabled={pages.length < 2} onClick={() => setEditRoute("new")}>＋ 路线</button>}
            </div>}
          </div>
          <div className={st.head}>
            <b>判定</b>
            <span className={w.muted}>{table ? `${table.by === "server" ? "服务器判" : "手机判"} · ${table.total} 张 · ${Math.max(1, Math.round(table.ms / 1000))} 秒` : device ? "服务器判，判不了的让手机判" : "服务器判"}</span>
            <span className={st.grow} />
            {info && info.conflicts > 0 && <Pill tone="bad">冲突 {info.conflicts}</Pill>}
            {info && <Pill tone={info.misses ? "warn" : ""}>漏判 {info.misses}</Pill>}
            {unknownCols.length > 0 && !busy && <button type="button" className={w.btn} style={{ minHeight: 32 }} disabled={!device}
              title={device ? undefined : "当前手机不在线"} onClick={() => void run(unknownCols.map((c) => ({ ...c, serverId: null })), true, "pages")}>让手机判这些</button>}
          </div>
          {table ? <>
            <Matrix rows={relevant} cols={[pid, ...others].map((id) => [id, nameOf(id)])} bad={(sample, col) => analysis.conflictRows.get(sample)?.includes(col) ?? false} />
            <div className={st.foot}>
              <span className={`${w.muted} ${st.grow}`}>{verdictLine(pid, nameOf, analysis, relevant)}</span>
              <button type="button" className={st.linkish} onClick={() => setAllRows(!allRows)}>{allRows ? "只看相关" : `全部 ${table.rows.length} 张`}</button>
            </div>
          </> : <div className={`${w.card} ${w.empty}`}>{samples.length ? "还没判" : "还没有样本"}</div>}
        </>
      );
    }
    if (tab === "interruptions") {
      const page = interruptions.find((p) => p.id === current.id)!;
      const id = String(page.id);
      return (
        <>
          <div className={st.head}>
            <h2 className={st.title}>{current.name}</h2>
            <button type="button" className={w.btn} onClick={() => setEditing(editing === id ? null : id)}>改</button>
          </div>
          {editing === id && <InterruptionForm key={id} page={page} lib={lib} known={known} onCancel={() => setEditing(null)}
            onSave={async (n) => { const p = await save("interruptions", id, n); if (p) setText(p); else setEditing(null); }}
            onDelete={async () => { const p = await save("interruptions", id, null); if (p) setText(p); else { setEditing(null); setPick(null); } }} />}
          <div className={`${w.card} ${st.facts}`}>
            <div className={st.fact}><span className={st.k}>认法</span><span className={`${st.mono} ${st.grow}`}>{recognitionLine(page.state, known)}</span></div>
            <div className={st.fact}><span className={st.k}>处理</span><span className={st.grow}>{describeInterruption(page, known, lib).split(" · ").slice(1).join(" · ")}</span></div>
            <div className={st.fact}><span className={st.k}>次数</span><span className={st.grow}>最多 {typeof page.maximum === "number" ? page.maximum : 3} 次</span></div>
          </div>
          <div className={w.muted}>每个等页面遇到它都先处理</div>
        </>
      );
    }
    const entry = stateList.find((x) => x.key === current.id)!;
    const sid = str(entry.state.id) ?? "";
    const using = waits.filter((x) => x.states.some((s) => entryId(s) === sid || s.state === sid));
    const wait = using.find((x) => x.key === waitKey) ?? using[0];
    const cols: Column[] = wait ? Array.from(new Map(wait.states.map((s) => [entryId(s) ?? "", s])).entries()).filter(([k]) => k)
      .map(([k, s]) => ({ id: k, serverId: k, probe: s })) : [];
    const shown = waitTable && wait ? waitTable : null;
    return (
      <>
        <div className={st.head}><h2 className={st.title}>{current.name}</h2><span className={w.muted}>{entry.where}</span></div>
        <div className={`${w.card} ${st.facts}`}>
          {str(entry.state.base) && <div className={st.fact}><span className={st.k}>基于</span><span className={st.grow}>{str(entry.state.base)}</span></div>}
          {conditionsOf(entry.state).map(([kind, tone, label], i) => <div key={i} className={st.fact}><span className={st.tag} data-tone={tone}>{kind}</span><span className={`${st.mono} ${st.grow}`}>{label}</span></div>)}
          <div className={st.fact}><span className={st.k}>用处</span><span className={st.grow}>{using.length} 个等页面</span></div>
        </div>
        {wait && <>
          <div className={st.head}>
            <b>判定</b>
            <select className={st.select} value={wait.key} disabled={busy} onChange={(e) => { pass.current++; setWaitKey(e.target.value); setWaitTable(null); }}>
              {using.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
            </select>
            <span className={st.grow} />
            <button type="button" className={`${w.btn} ${w.primary}`} disabled={busy || !samples.length} onClick={() => void run(cols, false, "wait")}>{busy ? "判定中…" : `在 ${samples.length} 张样本上判`}</button>
          </div>
          {shown && <Matrix rows={shown.rows} cols={cols.map((c) => [c.id, c.id])} bad={(sample) => {
            const r = shown.rows.find((x) => x.sample === sample); return !!r && typeof r.cells !== "string" && Object.values(r.cells).filter((c) => c.holds).length > 1; }} verdict />}
        </>}
      </>
    );
  })();

  return (
    <div className={st.page}>
      <GameCard samples={samples} />
      {text && <div className={w.message} role="status">{text}</div>}
      <div className={st.layout}>
        <nav aria-label="页面" className={st.list}>
          <SegmentTabs label="种类" value={tab} onChange={(t) => { setTab(t); setPick(null); }}
            items={[["pages", `页面 ${count.pages}`], ["interruptions", `干扰页 ${count.interruptions}`], ["states", `状态 ${count.states}`]]} />
          <div className={`${w.card} ${st.rows}`}>
            {listItems.map((x) => (
              <button key={x.id} type="button" className={st.item} aria-current={x.id === current?.id && editing !== "new" ? "true" : undefined}
                style={x.indent ? { paddingLeft: 22 } : undefined} onClick={() => { setPick(x.id); setEditing(null); }}>
                <span className={st.grow}>{x.name}</span>{x.aside}
              </button>
            ))}
            {!listItems.length && <div className={w.empty}>没有</div>}
          </div>
          {tab !== "states" && <button type="button" className={`${w.btn} ${g.hit}`} onClick={() => setEditing("new")}>{tab === "pages" ? "新建页面" : "新建干扰页"}</button>}
        </nav>
        <section className={st.main} aria-label={current?.name ?? "页面"}>{right}</section>
      </div>
    </div>
  );
}

/** Whether a sample is named for [page] (its name contains the page's): what a page should be judged to be. */
const expected = (sample: string, page: string) => !!page && sample.includes(page);

interface Analysis { byPage: Map<string, { conflicts: number; misses: number; unknown: number }>; conflictRows: Map<string, string[]>; missRows: Map<string, string[]> }
/** Per sample, the pages holding at the top priority (two or more is a conflict); per page, its conflicts, misses and unknowns. */
function analyse(table: JudgeTable | null, pages: Obj[], samples: Sample[], prio: Map<string, number>): Analysis {
  const byPage = new Map<string, { conflicts: number; misses: number; unknown: number }>();
  const conflictRows = new Map<string, string[]>(), missRows = new Map<string, string[]>();
  if (!table) return { byPage, conflictRows, missRows };
  for (const p of pages) byPage.set(String(p.id), { conflicts: 0, misses: 0, unknown: 0 });
  for (const r of table.rows) {
    if (typeof r.cells === "string" || !Object.keys(r.cells).length) continue;
    const cells = r.cells;
    const holding = Object.keys(cells).filter((id) => cells[id].holds && byPage.has(id));
    const top = holding.length ? Math.max(...holding.map((id) => prio.get(id) ?? 0)) : 0;
    const winners = holding.filter((id) => (prio.get(id) ?? 0) === top);
    if (winners.length > 1) { conflictRows.set(r.sample, winners); winners.forEach((id) => byPage.get(id)!.conflicts++); }
    const name = samples.find((x) => x.id === r.sample)?.name ?? r.name;
    for (const p of pages) {
      const id = String(p.id), c = cells[id];
      if (c?.unknown) byPage.get(id)!.unknown++;
      else if (c && !c.holds && expected(name, str(p.name) ?? id)) { byPage.get(id)!.misses++; missRows.set(r.sample, [...(missRows.get(r.sample) ?? []), id]); }
    }
  }
  return { byPage, conflictRows, missRows };
}

function pagePill(info: { conflicts: number; misses: number; unknown: number } | undefined) {
  if (!info) return null;
  if (info.conflicts) return <Pill tone="bad">冲突 {info.conflicts}</Pill>;
  if (info.misses) return <Pill tone="warn">漏 {info.misses}</Pill>;
  if (info.unknown) return <Pill>? {info.unknown}</Pill>;
  return <Pill tone="ok">✓</Pill>;
}

/** One line on what the matrix says of [pid]. */
function verdictLine(pid: string, nameOf: (id: string) => string, a: Analysis, rows: JudgeTable["rows"]): string {
  const clash = rows.find((r) => a.conflictRows.get(r.sample)?.includes(pid));
  if (clash) { const both = a.conflictRows.get(clash.sample)!.map(nameOf);
    return `「${clash.name}」同时认成 ${both.join("、")} → 给其中一个提优先级，或加一个对方没有的条件`; }
  const miss = rows.find((r) => a.missRows.get(r.sample)?.includes(pid));
  if (miss) return `「${miss.name}」没认成 ${nameOf(pid)} → 看格子悬停的原因，改认法`;
  const unknown = rows.find((r) => typeof r.cells !== "string" && r.cells[pid]?.unknown);
  if (unknown && typeof unknown.cells !== "string") return `服务器判不了：${unknown.cells[pid]?.why ?? "用到了模板"} → 让手机判`;
  return rows.some((r) => typeof r.cells !== "string" && r.cells[pid]?.holds) ? "只在该认的样本上成立" : "没有样本认成它";
}

/** Samples × columns: ✓ and its score where a column holds (red when it clashes), ? where the server cannot tell. */
function Matrix({ rows, cols, bad, verdict }: { rows: JudgeTable["rows"]; cols: [string, string][]; bad: (sample: string, col: string) => boolean; verdict?: boolean }) {
  const cell = (c: Cell | undefined, clash: boolean) => {
    if (!c) return <span className={st.dash}>·</span>;
    if (c.unknown) return <span title={c.why}><Pill>?</Pill></span>;
    if (c.holds) return <span title={c.why}><Pill tone={clash ? "bad" : "ok"}>✓{c.score != null ? ` ${c.score.toFixed(2)}` : ""}</Pill></span>;
    return <span className={st.dash} title={c.why}>—</span>;
  };
  return (
    <div className={`${w.card} ${st.scroll}`}>
      <table className={st.table}>
        <thead><tr><th scope="col">样本</th>{cols.map(([id, label]) => <th key={id} scope="col">{label}</th>)}{verdict && <th scope="col">结论</th>}</tr></thead>
        <tbody>
          {rows.map((r) => {
            const holds = typeof r.cells === "string" ? 0 : Object.values(r.cells).filter((c) => c.holds).length;
            return (
              <tr key={r.sample}>
                <th scope="row">{r.name}</th>
                {typeof r.cells === "string" ? <td colSpan={cols.length + (verdict ? 1 : 0)} className={st.err}>{r.cells}</td>
                  : cols.map(([id]) => <td key={id}>{cell((r.cells as Record<string, Cell>)[id], bad(r.sample, id))}</td>)}
                {verdict && typeof r.cells !== "string" && <td>{!Object.keys(r.cells).length ? "" : holds > 1 ? <Pill tone="bad">冲突</Pill> : holds === 0 ? <Pill tone="warn">都不成立</Pill> : <Pill tone="ok">✓</Pill>}</td>}
              </tr>
            );
          })}
          {!rows.length && <tr><td colSpan={cols.length + 1 + (verdict ? 1 : 0)} className={w.empty}>没有相关样本</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

/** The cheapest way along [routes] from [from] to [to], as the navigator plans it. */
function shortest(pages: Obj[], routes: Obj[], from: string, to: string): { ids: string[]; cost: number } | null {
  if (!from || !to) return null;
  const dist = new Map<string, number>([[from, 0]]); const prev = new Map<string, string>();
  const open = new Set(pages.map((p) => String(p.id)));
  while (open.size) {
    let u: string | null = null;
    for (const id of open) if (dist.has(id) && (u === null || dist.get(id)! < dist.get(u)!)) u = id;
    if (u === null) break;
    open.delete(u);
    if (u === to) break;
    for (const r of routes) if (r.from === u) {
      const v = String(r.to), d = dist.get(u)! + (typeof r.cost === "number" ? r.cost : 1);
      if (!dist.has(v) || d < dist.get(v)!) { dist.set(v, d); prev.set(v, u); }
    }
  }
  if (!dist.has(to)) return null;
  const ids = [to]; while (ids[0] !== from) ids.unshift(prev.get(ids[0])!);
  return { ids, cost: dist.get(to)! };
}
