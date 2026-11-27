import { useState } from "react";
import { Stepper } from "../../components/ui";
import { dev, follow, judgeOnServer, type Json, type Obj, type Sample } from "./api";
import { useDev } from "./context";
import { uniqueId } from "./HomePage";
import { idOf } from "./NameButton";
import { arr, isObj, nodeDigest, objs, str, target } from "./model";
import w from "./Wb.module.css";
import { PickOnScreen } from "./ScreenPick";
import g from "./Game.module.css";

/** The page graph's pieces (pages, routes, generic close fallbacks) and judging pages on samples, for the 页面 section. */

export type LibList = "pages" | "routes" | "fallbacks" | "interruptions";
/** Writes [next] as item [id] of the game's library list (new when [id] is null, deleted when [next] is null), with expect digests. */
export function useLibrarySave() {
  const { game, apply } = useDev();
  return (listKey: LibList, id: string | null, next: Obj | null) => apply(async (body) => {
    const now = target(body, game);
    const list = objs(isObj(now?.library) ? now!.library[listKey] : undefined);
    const old = id ? list.find((x) => x.id === id) : undefined;
    if (old && next) return [{ op: "put", path: `targets:${game}/${listKey}:${id}`, expect: await nodeDigest(old), value: next }];
    if (old) return [{ op: "delete", path: `targets:${game}/${listKey}:${id}`, expect: await nodeDigest(old) }];
    if (next) return [{ op: "insert", path: `targets:${game}`, field: `library.${listKey}`, after: str(list.at(-1)?.id) ?? null, value: next }];
    return [];
  });
}

/** A page as a page wait's candidate that reports the page's own id. */
export function pageProbe(p: Obj): Json {
  const id = String(p.id);
  const prio: Obj = typeof p.priority === "number" && p.priority !== 0 ? { priority: p.priority } : {};
  const st = p.state;
  if (typeof st === "string") return { state: st, as: id, ...prio };
  if (isObj(st)) return { ...st, ...("state" in st ? { as: id } : { id }), ...prio };
  return { id };
}
/** Fields of an inline page state that name it rather than add a condition. */
const NAMING = new Set(["id", "as", "priority", "state"]);
/**
 * The id the server judges a page by: its library state, or an inline state that only refers to one (no conditions
 * of its own) when a wait or the library knows it. An inline state with conditions is judged on the phone: the server
 * would judge only the referred state, or a same-named wait candidate, not these conditions.
 */
export function serverIdOf(p: Obj, known: Set<string>): string | null {
  const st = p.state;
  if (typeof st === "string") return known.has(st) ? st : null;
  if (isObj(st)) {
    if (Object.keys(st).some((k) => !NAMING.has(k))) return null;
    if ("state" in st && typeof st.state !== "string") return null;
    const id = str(st.state) ?? str(st.id);
    return id && known.has(id) ? id : null;
  }
  return null;
}

export interface Cell { holds: boolean; score: number | null; unknown?: boolean; why?: string }
export interface JudgeTable { by: "server" | "phone"; ms: number; total: number; rows: { sample: string; name: string; cells: Record<string, Cell> | string }[] }
/** A column to judge: its id in the table, the id the server knows it by (null: phone only), and the candidate the phone gets. */
export interface Column { id: string; serverId: string | null; probe: Json }

/** What a phone judgement's trace says of each candidate: it holds when every condition it read passed. */
function cellsOf(trace: Obj | undefined): Record<string, Cell> {
  const by = new Map<string, { passes: boolean[]; best: number | null }>();
  for (const c of objs(trace?.conditions)) {
    const sid = str(c.state); if (!sid) continue;
    const e = by.get(sid) ?? { passes: [], best: null };
    e.passes.push(c.pass === true);
    if (typeof c.score === "number") e.best = Math.max(e.best ?? 0, c.score);
    by.set(sid, e);
  }
  const held = str(trace?.state);
  const out: Record<string, Cell> = Object.fromEntries([...by].map(([sid, e]) => [sid, { holds: e.passes.length > 0 && e.passes.every(Boolean), score: e.best }]));
  if (held && !out[held]) out[held] = { holds: true, score: null };
  return out;
}

/**
 * Judges [columns] on [samples]: on the server in one request for the columns it knows, the rest (or all, with
 * [phoneOnly]) on [device] one sample at a time. [seen] gets the table as it fills; [alive] false stops it.
 */
export async function judge(game: string, columns: Column[], samples: Sample[], device: string | null, seen: (t: JudgeTable) => void,
  alive: () => boolean, phoneOnly = false): Promise<JudgeTable> {
  const began = Date.now();
  const rows = new Map(samples.map((x) => [x.id, { sample: x.id, name: x.name, cells: {} as Record<string, Cell> | string }]));
  const table = (by: JudgeTable["by"]): JudgeTable => ({ by, ms: Date.now() - began, total: samples.length, rows: [...rows.values()] });
  let rest = columns;
  if (!phoneOnly) {
    const onServer = columns.filter((c) => c.serverId);
    const result = onServer.length ? await judgeOnServer(game, Array.from(new Set(onServer.map((c) => c.serverId!))), samples.map((x) => x.id)) : null;
    if (result) {
      for (const r of result.rows) {
        const row = rows.get(r.sample); if (!row || typeof row.cells === "string") continue;
        for (const c of onServer) {
          const cell = r.results.find((x) => x.page === c.serverId);
          if (cell) row.cells[c.id] = { holds: cell.holds, score: cell.score ?? null, unknown: cell.unknown ?? undefined, why: cell.why ?? undefined };
        }
      }
      rest = columns.filter((c) => !c.serverId);
      if (!rest.length || !device) { const t = table("server"); seen(t); return t; }
    }
  }
  if (!device) throw new Error("当前手机不在线，服务器也判不了");
  const filled = samples.filter((x) => rows.has(x.id));
  let done = 0;
  for (const sample of filled) {
    if (!alive()) break;
    const row = rows.get(sample.id)!;
    try {
      const run = await dev.startRun({ kind: "judge", target: game, device, sample: sample.id, states: rest.map((c) => c.probe) });
      const finished = await follow(run.id, () => {});
      const got = cellsOf(finished.traces.find((t) => t.capability === "screen.awaitScreen")?.trace);
      if (typeof row.cells !== "string") for (const c of rest) row.cells[c.id] = got[c.id] ?? { holds: false, score: null };
    } catch (error) { row.cells = error instanceof Error ? error.message : "没判成"; }
    done++;
    if (alive()) seen({ ...table(rest.length === columns.length ? "phone" : "server"), total: samples.length, rows: [...rows.values()].map((r, i) => i < done || rest.length < columns.length ? r : { ...r }) });
  }
  const t = table(rest.length === columns.length ? "phone" : "server");
  if (alive()) seen(t);
  return t;
}

/** 通用关闭兜底: what navigation tries on a screen it does not know. */
export function Fallbacks() {
  const { draft, game } = useDev();
  const save = useLibrarySave();
  const [edit, setEdit] = useState<string | "new" | null>(null);
  const [text, setText] = useState<string | null>(null);
  if (!draft) return null;
  const app = target(draft.body, game);
  const list = objs(isObj(app?.library) ? app!.library.fallbacks : undefined);
  const lib = objs(draft.body.snippets);
  const done = async (id: string | null, next: Obj | null) => { const problem = await save("fallbacks", id, next); if (problem) setText(problem); else { setText(null); setEdit(null); } };
  return (
    <div className={g.card}>
      <div className={g.headRow}><b className={g.grow}>通用关闭 · {list.length}</b>
        <button type="button" className={w.btn} style={{ minHeight: 32 }} onClick={() => setEdit("new")}>＋ 关闭</button></div>
      {list.map((fb) => edit === fb.id
        ? <FallbackForm key={String(fb.id)} fb={fb} lib={lib} onSave={(n) => done(String(fb.id), n)} onDelete={() => done(String(fb.id), null)} onCancel={() => setEdit(null)} />
        : <button key={String(fb.id)} type="button" className={`${g.row} ${g.rowButton}`} onClick={() => setEdit(String(fb.id))}>
            <b className={g.nowrap}>{str(fb.name) ?? String(fb.id)}</b>
            <span className={`${w.muted} ${g.grow} ${g.clip}`}>片段 {str(lib.find((sn) => sn.id === fb.use)?.name) ?? String(fb.use)}</span>
            <span className={`${w.chip} ${w.same}`}>≤ {typeof fb.maximum === "number" ? fb.maximum : 3} 次</span>
          </button>)}
      {!list.length && edit !== "new" && <div className={w.muted}>没有</div>}
      {edit === "new" && <FallbackForm lib={lib} taken={list.map((x) => String(x.id))} onSave={(n) => done(null, n)} onCancel={() => setEdit(null)} />}
      {text && <div className={w.message}>{text}</div>}
    </div>
  );
}

/** A page of the graph being written: name, how it is recognised, priority. */
export function PageDefForm({ page, known, taken = [], onSave, onDelete, onCancel }: {
  page?: Obj; known: Obj[]; taken?: string[]; onSave: (next: Obj) => void; onDelete?: () => void; onCancel: () => void;
}) {
  const written = page?.state;
  const isComplexInline = isObj(written) && ("state" in written || ["present", "absent", "colors", "absentColors", "absentText"].some((k) => arr(written[k]).length > 0));
  const [name, setName] = useState(str(page?.name) ?? "");
  const [wanted, setWanted] = useState("");
  const [priority, setPriority] = useState(String(typeof page?.priority === "number" ? page.priority : 0));
  const [mode, setMode] = useState<"keep" | "state" | "text">(
    isComplexInline ? "keep" : (typeof written === "string" || (!page && known.length > 0)) ? "state" : "text",
  );
  const [stateId, setStateId] = useState(typeof written === "string" ? written : str(known[0]?.id) ?? "");
  const [words, setWords] = useState(isObj(written) ? arr(written.text).map((c) => (isObj(c) ? str(c.text) : str(c)) ?? "").join("、") : "");
  const firstWithin = isObj(written) ? arr(written.text).map((c) => isObj(c) ? arr(c.within) : []).find((r) => r.length === 4) : undefined;
  const [within, setWithin] = useState((firstWithin ?? [0, 0, 2400, 1080]).join(","));
  const chosen = idOf(wanted) || idOf(name);
  const list = words.split(/[、,，\s]+/).map((x) => x.trim()).filter(Boolean);
  const region = within.split(/[,，\s]+/).map(Number).filter((n) => Number.isFinite(n));
  const prioNum = Number(priority);
  const condOk = mode === "keep" ? isComplexInline : mode === "state" ? !!stateId : list.length > 0 && region.length === 4 && region[2] > 0 && region[3] > 0;
  const ready = name.trim() && (page || chosen) && condOk && Number.isInteger(prioNum) && prioNum >= -100 && prioNum <= 100;
  return (
    <div className={g.form}>
      <div className={g.pair}>
        <div className={g.f} style={{ flex: "1 1 130px" }}><label>名称</label><input value={name} onChange={(e) => setName(e.target.value)} placeholder="庭院" /></div>
        {!page && <div className={g.f} style={{ flex: "1 1 130px" }}><label>编号</label>
          <input value={wanted} onChange={(e) => setWanted(e.target.value)} placeholder={idOf(name) || "courtyard"} /></div>}
        <div className={g.f} style={{ flex: "none" }}><span className={g.lb}>优先级</span><Stepper label="优先级" min={-100} max={100} value={priority === "" || !Number.isFinite(Number(priority)) ? undefined : Number(priority)} onChange={(v) => setPriority(v === undefined ? "" : String(v))} /></div>
      </div>
      <div className={g.f}><span className={g.lb}>认法</span>
        <div className={g.pair}>
          {isComplexInline && <label className={g.radio}><input type="radio" checked={mode === "keep"} onChange={() => setMode("keep")} />保持原样</label>}
          <label className={g.radio}><input type="radio" checked={mode === "state"} disabled={!known.length} onChange={() => setMode("state")} />状态</label>
          <label className={g.radio}><input type="radio" checked={mode === "text"} onChange={() => setMode("text")} />文字</label>
        </div>
        {mode === "keep" ? <div className={w.muted}>含图或取色，原样保留</div>
          : mode === "state" ? <select aria-label="状态" value={stateId} onChange={(e) => setStateId(e.target.value)}>
            {known.map((s) => <option key={String(s.id)} value={String(s.id)}>{str(s.name) ?? String(s.id)}</option>)}</select>
          : <div className={g.pair}>
            <input aria-label="文字" style={{ flex: "2 1 150px" }} value={words} onChange={(e) => setWords(e.target.value)} placeholder="结界突破" />
            <input aria-label="区域 x,y,宽,高" style={{ flex: "1 1 140px" }} value={within} onChange={(e) => setWithin(e.target.value)} />
            <PickOnScreen value={region.length === 4 ? region : null} onPick={(v) => setWithin(v.join(","))} />
          </div>}
      </div>
      <div className={g.pair}>
        <button type="button" className={`${w.btn} ${w.primary}`} disabled={!ready} onClick={() => {
          const id = str(page?.id) ?? uniqueId(chosen, taken, "page");
          const state: Json = mode === "keep" && written !== undefined ? written : mode === "state" ? stateId
            : { id, text: list.map((t) => ({ text: t, minimumConfidence: 0.8, within: region, contains: true })) };
          const { priority: _p, ...kept } = page ?? {};
          onSave({ ...kept, id, name: name.trim(), state, ...(prioNum !== 0 ? { priority: prioNum } : {}) });
        }}>保存</button>
        <button type="button" className={w.btn} onClick={onCancel}>取消</button>
        {onDelete && <button type="button" className={w.btn} style={{ color: "var(--color-danger)" }} onClick={() => { if (confirm("删除这个页面？")) onDelete(); }}>删除</button>}
      </div>
    </div>
  );
}

export function RouteForm({ route, pages, lib, taken = [], from: fixedFrom, onSave, onDelete, onCancel }: {
  route?: Obj; pages: Obj[]; lib: Obj[]; taken?: string[]; from?: string; onSave: (next: Obj) => void; onDelete?: () => void; onCancel: () => void;
}) {
  const [from, setFrom] = useState(str(route?.from) ?? fixedFrom ?? str(pages[0]?.id) ?? "");
  const [to, setTo] = useState(str(route?.to) ?? str(pages.find((p) => p.id !== (fixedFrom ?? pages[0]?.id))?.id) ?? "");
  const [use, setUse] = useState(str(route?.use) ?? str(lib[0]?.id) ?? "");
  const [cost, setCost] = useState(String(typeof route?.cost === "number" ? route.cost : 1));
  const costNum = Number(cost);
  const ready = from && to && from !== to && use && Number.isInteger(costNum) && costNum >= 1 && costNum <= 100;
  const options = pages.map((p) => <option key={String(p.id)} value={String(p.id)}>{str(p.name) ?? String(p.id)}</option>);
  return (
    <div className={g.form}>
      <div className={g.pair}>
        <div className={g.f} style={{ flex: "1 1 120px" }}><label>从</label><select value={from} onChange={(e) => setFrom(e.target.value)}>{options}</select></div>
        <div className={g.f} style={{ flex: "1 1 120px" }}><label>到</label><select value={to} onChange={(e) => setTo(e.target.value)}>{options}</select></div>
        <div className={g.f} style={{ flex: "none" }}><span className={g.lb}>代价</span><Stepper label="代价" min={1} max={100} value={cost === "" || !Number.isFinite(Number(cost)) ? undefined : Number(cost)} onChange={(v) => setCost(v === undefined ? "" : String(v))} /></div>
      </div>
      <div className={g.f}><label>片段</label>
        <select value={use} onChange={(e) => setUse(e.target.value)}>
          {!lib.length && <option value="">先建片段</option>}
          {lib.map((sn) => <option key={String(sn.id)} value={String(sn.id)}>{str(sn.name) ?? String(sn.id)}</option>)}
        </select>
      </div>
      <div className={g.pair}>
        <button type="button" className={`${w.btn} ${w.primary}`} disabled={!ready} onClick={() => {
          const id = str(route?.id) ?? uniqueId(`rt-${from}-${to}`, taken, "rt");
          const { cost: _, ...kept } = route ?? {};
          onSave({ ...kept, id, from, to, use, ...(costNum !== 1 ? { cost: costNum } : {}) });
        }}>保存</button>
        <button type="button" className={w.btn} onClick={onCancel}>取消</button>
        {onDelete && <button type="button" className={w.btn} style={{ color: "var(--color-danger)" }} onClick={() => { if (confirm("删除这条路线？")) onDelete(); }}>删除</button>}
      </div>
    </div>
  );
}

function FallbackForm({ fb, lib, taken = [], onSave, onDelete, onCancel }: {
  fb?: Obj; lib: Obj[]; taken?: string[]; onSave: (next: Obj) => void; onDelete?: () => void; onCancel: () => void;
}) {
  const [name, setName] = useState(str(fb?.name) ?? "");
  const [use, setUse] = useState(str(fb?.use) ?? str(lib[0]?.id) ?? "");
  const [maximum, setMaximum] = useState(String(typeof fb?.maximum === "number" ? fb.maximum : 3));
  const maxNum = Number(maximum);
  const ready = name.trim() && use && Number.isInteger(maxNum) && maxNum >= 1 && maxNum <= 10;
  return (
    <div className={g.form}>
      <div className={g.pair}>
        <div className={g.f} style={{ flex: "1 1 150px" }}><label>名称</label><input value={name} onChange={(e) => setName(e.target.value)} placeholder="右上角红叉" /></div>
        <div className={g.f} style={{ flex: "2 1 150px" }}><label>片段</label>
          <select value={use} onChange={(e) => setUse(e.target.value)}>
            {!lib.length && <option value="">先建片段</option>}
            {lib.map((sn) => <option key={String(sn.id)} value={String(sn.id)}>{str(sn.name) ?? String(sn.id)}</option>)}
          </select></div>
        <div className={g.f} style={{ flex: "none" }}><span className={g.lb}>最多试</span><Stepper label="最多试" unit="次" min={1} max={10} value={maximum === "" || !Number.isFinite(Number(maximum)) ? undefined : Number(maximum)} onChange={(v) => setMaximum(v === undefined ? "" : String(v))} /></div>
      </div>
      <div className={g.pair}>
        <button type="button" className={`${w.btn} ${w.primary}`} disabled={!ready} onClick={() => {
          const id = str(fb?.id) ?? uniqueId(`fb-${idOf(name) || "close"}`, taken, "fb");
          const { maximum: _, ...kept } = fb ?? {};
          onSave({ ...kept, id, name: name.trim(), use, ...(maxNum !== 3 ? { maximum: maxNum } : {}) });
        }}>保存</button>
        <button type="button" className={w.btn} onClick={onCancel}>取消</button>
        {onDelete && <button type="button" className={w.btn} style={{ color: "var(--color-danger)" }} onClick={() => { if (confirm("删除这个关闭候选？")) onDelete(); }}>删除</button>}
      </div>
    </div>
  );
}
