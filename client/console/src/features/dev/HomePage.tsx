import { useEffect, useRef, useState } from "react";
import { useConsole } from "../../state/context";
import { MoreMenu, Pill, Stepper } from "../../components/ui";
import { Link, navigate } from "../../router";
import { dev, type DriftWarning, type SyncResult, type TrialRecord } from "./api";
import { devPaths, failure, useDev } from "./context";
import { NameButton } from "./NameButton";
import { DRIFT, driftLink, driftReason } from "./DriftGuide";
import { bothChanged, RepoAhead, SyncReport, SyncTools, useRepoOnly } from "./SyncTools";
import { arr, childIds, isObj, nodeDigest, objs, requiredMinApp, shallowDigest, snippets, str, target, tasks, usedSnippets, type TaskDef } from "./model";
import type { Obj } from "./api";
import w from "./Wb.module.css";

const CATEGORY: Record<string, string> = { daily: "日常", weekly: "每周", event: "活动", account: "账号" };
const TONE = { pass: "ok", fail: "bad", none: "warn", same: "" } as const;
type Filter = "all" | "changed" | "fail";
type Editing = { id: string; kind: "name" | "category" | "priority" | "delete" };

/** 任务: which tasks need attention (changed, failed, untried), and beside them the snippets, drift warnings and the phone. */
export function HomePage() {
  const { draft, game, trials, digests, apply, me, device } = useDev();
  const { data } = useConsole();
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [drifts, setDrifts] = useState<DriftWarning[]>([]);
  const [notice, setNotice] = useState<[string, boolean] | null>(null);
  const [synced, setSynced] = useState<SyncResult | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const search = useRef<HTMLInputElement>(null);
  useEffect(() => { dev.driftWarnings(game).then(setDrifts, () => setDrifts([])); }, [game, trials]);
  // "/" jumps to the search, as the design's hint says.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key === "/" && !(t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable))) { e.preventDefault(); search.current?.focus(); }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  const repoOnly = useRepoOnly();
  if (!draft) return null;
  const list = tasks(draft.body);
  const lib = snippets(draft.body);
  const rows = list.map((t) => standing(t, draft.body, draft.bases, digests, trials.find((x) => x.task === t.id), data.devices));
  const changed = rows.filter((r) => r.changed);
  const failed = rows.filter((r) => r.tone === "fail");
  const q = query.trim().toLowerCase();
  const shown = rows.filter((r) => (filter === "all" || (filter === "changed" ? r.changed : r.tone === "fail"))
    && (!q || r.task.name.toLowerCase().includes(q) || r.task.id.toLowerCase().includes(q)));
  const phone = data.devices.find((d) => d.id === device);
  const minApp = requiredMinApp(draft.body);
  const gameNow = target(draft.body, game);
  const libObj = isObj(gameNow?.library) ? gameNow.library : undefined;
  const guarded = usedSnippets(draft.body, arr(libObj?.interruptions));
  const graphed = usedSnippets(draft.body, [arr(libObj?.routes), arr(libObj?.fallbacks)]);
  const categories: [string, string][] = [...new Map<string, string>([
    ...objs(gameNow?.categories).map((c) => [String(c.id), str(c.name) ?? String(c.id)] as [string, string]),
    ...list.map((t) => str(t.raw.category)).filter((c): c is string => !!c).map((c) => [c, CATEGORY[c] ?? c] as [string, string]),
  ]).entries()];
  const say = (problem: string | null, ok?: string) => setNotice(problem ? [problem, false] : ok ? [ok, true] : null);

  const create = async (name: string, wanted: string) => {
    const id = uniqueId(wanted || name, childIds(draft.body), "task");
    const problem = await apply([{ op: "insert", path: "", field: "tasks", after: list.at(-1)?.id ?? null,
      value: { id, targetId: game, name, category: "daily", priority: 50, steps: [] } }]);
    if (problem) say(problem); else navigate(devPaths.task(id));
  };
  /** Changes a task's own fields (name, category, priority), against the task as last read. */
  const setTask = async (id: string, value: Obj) => {
    setEditing(null);
    say(await apply(async (b) => {
      const now = tasks(b).find((t) => t.id === id); if (!now) return [];
      return [{ op: "set", path: `tasks:${id}`, expect: await shallowDigest(now.raw), value }];
    }));
  };
  const removeTask = async (id: string) => {
    setEditing(null);
    say(await apply(async (b) => {
      const now = tasks(b).find((t) => t.id === id); if (!now) return [];
      return [{ op: "delete", path: `tasks:${id}`, expect: await nodeDigest(now.raw) }];
    }), "已删除");
  };
  const snippetUse = (id: string) => {
    const n = list.filter((t) => uses(draft.body, t, id)).length;
    return n ? `${n} 处` : guarded.includes(id) ? "干扰页" : graphed.includes(id) ? "页面图" : "没人用";
  };
  return (
    <div className={w.home}>
      <div className={w.homeMain}>
        <div className={w.homeHead}>
          <h1 className={w.h1Small}>任务</h1>
          <SyncTools changed={changed.length} onDone={(said, result) => { setNotice(said); setSynced(result ?? null); }} />
          <NameButton label="＋ 任务" placeholder="任务名" askId onName={create} />
        </div>
        <RepoAhead changed={changed.length} onDone={(said, result) => { setNotice(said); setSynced(result ?? null); }} />
        {synced ? <SyncReport result={synced} body={draft.body} onUndone={(said) => { if (said[1]) { setSynced(null); setNotice(said); } }} />
          : notice && <div role="status" className={notice[1] ? `${w.muted} ${w.okText}` : w.message}>{notice[0]}</div>}
        <div className={w.stats}>
          <button type="button" className={`${w.card} ${w.stat}`} onClick={() => setFilter("changed")}><span className={w.figure} data-tone={changed.length ? "warn" : undefined}>{changed.length}</span><span className={w.muted}>改过未发布</span></button>
          <button type="button" className={`${w.card} ${w.stat}`} onClick={() => setFilter("fail")}><span className={w.figure} data-tone={failed.length ? "bad" : undefined}>{failed.length}</span><span className={w.muted}>试跑失败</span></button>
          <Link className={`${w.card} ${w.stat}`} to={devPaths.assets}><span className={w.figure}>{me?.samples ?? 0}</span><span className={w.muted}>样本</span></Link>
          <div className={`${w.card} ${w.stat}`}><span className={w.figure} data-tone={drifts.length ? "warn" : undefined}>{drifts.length}</span><span className={w.muted}>漂移预警</span></div>
        </div>
        <div className={w.filterRow}>
          {([["all", `全部 ${rows.length}`], ["changed", `改过 ${changed.length}`], ["fail", `失败 ${failed.length}`]] as [Filter, string][]).map(([id, label]) => (
            <button key={id} type="button" aria-pressed={filter === id} className={w.filterChip} onClick={() => setFilter(id)}>{label}</button>))}
          <span className={w.topGrow} />
          <input ref={search} type="search" className={w.search} aria-label="搜索任务" placeholder="搜索 /" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <div className={`${w.card} ${w.clip}`}>
          <div className={`${w.tasksGrid} ${w.thead}`}><span>任务</span><span>状态</span><span>最近试跑</span><span>配置</span><span /></div>
          {shown.length ? shown.map((r) => <div key={r.task.id}>
            <div className={`${w.tasksGrid} ${w.trow}`}>
              <Link to={devPaths.task(r.task.id)} className={w.taskName}><span className={w.bold}>{r.task.name}</span>{r.changed && <span className={w.changed}>● {r.isNew ? "新" : "改过"}</span>}
                {bothChanged(synced).has(`tasks/${r.task.id}`) && <span className={w.both} title="仓库也改了它，留的是你的">两边都改</span>}</Link>
              <span><Pill tone={TONE[r.tone]}>{r.label}</Pill></span>
              <span className={w.muted}>{r.run}</span>
              <span className={w.muted}>{r.fields}</span>
              <MoreMenu label={`${r.task.name} 的更多操作`} actions={[
                ["改名", () => setEditing({ id: r.task.id, kind: "name" })],
                ["分类", () => setEditing({ id: r.task.id, kind: "category" })],
                ["优先级", () => setEditing({ id: r.task.id, kind: "priority" })],
                ["删除", () => setEditing({ id: r.task.id, kind: "delete" }), true],
              ]} />
            </div>
            {editing?.id === r.task.id && <TaskEdit task={r.task} kind={editing.kind} categories={categories} onCancel={() => setEditing(null)}
              onSet={(value) => void setTask(r.task.id, value)} onDelete={() => void removeTask(r.task.id)} />}
          </div>) : <div className={w.empty}>{list.length ? "没有符合的任务" : "还没有任务"}</div>}
          {/* Published but not in the draft (it was imported before they came): listed, so they are not taken for missing. */}
          {filter === "all" && repoOnly.filter((t) => !q || t.name.toLowerCase().includes(q) || t.taskId.toLowerCase().includes(q)).map((t) =>
            <div key={t.taskId} className={`${w.tasksGrid} ${w.trow} ${w.repoOnly}`} title="草稿里没有：从仓库同步后才能改">
              <span className={w.taskName}><span className={w.bold}>{t.name}</span></span>
              <span><Pill>只在仓库</Pill></span><span className={w.muted}>同步后可改</span><span className={w.muted}>—</span><span />
            </div>)}
        </div>
      </div>

      <aside className={w.homeSide} aria-label="片段、预警、手机">
        <span className={w.label}>片段 · {lib.length}</span>
        <div className={`${w.card} ${w.clip} ${w.sideList}`}>
          {lib.length ? lib.map((sn) => {
            const id = String(sn.id ?? "");
            return <Link key={id} to={devPaths.snippet(id)} className={w.sideRow}><span className={w.mono}>{id}</span><span className={w.muted}>{snippetUse(id)}</span></Link>;
          }) : <div className={w.empty}>还没有片段</div>}
        </div>
        <NameButton label="＋ 片段" placeholder="片段编号（字母、数字、-）" onName={async (name) => {
          const id = uniqueId(name, childIds(draft.body), "snippet");
          const problem = await apply([{ op: "insert", path: "", field: "snippets", after: str(lib.at(-1)?.id) ?? null, value: { id, script: "" } }]);
          if (problem) say(problem); else navigate(devPaths.snippet(id));
        }} />
        {drifts.length > 0 && <>
          <span className={w.label}>漂移预警</span>
          <div className={`${w.card} ${w.clip}`}>
            {drifts.map((d) => (
              <div key={`${d.state}:${d.kind}:${d.subject}`} className={w.sideRow}>
                <span className={w.sideText}><b className={w.medium}>{d.state} · {DRIFT[d.kind] ?? "临界"}</b>
                  <span className={w.muted} title={d.subject}>{d.subject}</span><span className={w.muted}>{driftReason(d)}</span></span>
                <Link className={`${w.btn} ${w.sm}`} to={driftLink(d)}>补采</Link>
                <button type="button" className={`${w.btn} ${w.sm}`} aria-label="忽略" onClick={async () => {
                  try { await dev.clearDriftWarnings(game, { state: d.state, kind: d.kind, subject: d.subject });
                    setDrifts((prev) => prev.filter((x) => !(x.state === d.state && x.kind === d.kind && x.subject === d.subject))); }
                  catch (e) { say(failure(e)); }
                }}>✕</button>
              </div>
            ))}
          </div>
        </>}
        <span className={w.label}>手机</span>
        <div className={w.card}>
          <div className={w.sideRow}>
            <span className={w.dotOnline} data-on={phone?.online ? "true" : undefined} />
            <span className={w.sideText}><b className={w.medium}>{phone?.name ?? "没有手机"}</b>
              <span className={w.muted}>{phone ? `App ${phone.appVersion || "?"} · ${phone.online ? phone.phase === "IDLE" ? "空闲" : "忙" : "离线"}` : "在手机上登录 App"}</span></span>
            {phone?.online && <UpdateApp device={phone.id} />}
          </div>
          <div className={`${w.sideRow} ${w.muted}`}>发布要 App ≥ {minApp}{phone?.appVersion && older(phone.appVersion, minApp) ? " · 这台太旧" : ""}</div>
        </div>
      </aside>
    </div>
  );
}

const older = (a: string, b: string) => {
  const x = a.split(".").map(Number), y = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) < (y[i] || 0);
  return false;
};

/** One of a task's ⋯ actions, opened under its row. */
function TaskEdit({ task, kind, categories, onCancel, onSet, onDelete }: { task: TaskDef; kind: Editing["kind"]; categories: [string, string][];
  onCancel: () => void; onSet: (value: Obj) => void; onDelete: () => void }) {
  const [name, setName] = useState(task.name);
  const [category, setCategory] = useState(str(task.raw.category) ?? categories[0]?.[0] ?? "daily");
  const [priority, setPriority] = useState<number | undefined>(typeof task.raw.priority === "number" ? task.raw.priority : 50);
  const cancel = <button type="button" className={`${w.btn} ${w.sm}`} onClick={onCancel}>取消</button>;
  return (
    <div className={w.editRow}>
      {kind === "name" && <><input autoFocus aria-label="任务名" className={w.input} value={name} onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing && name.trim()) onSet({ name: name.trim() }); if (e.key === "Escape") onCancel(); }} />
        <button type="button" className={`${w.btn} ${w.primary} ${w.sm}`} disabled={!name.trim() || name.trim() === task.name} onClick={() => onSet({ name: name.trim() })}>改名</button>{cancel}</>}
      {kind === "category" && <><select aria-label="分类" className={w.input} value={category} onChange={(e) => setCategory(e.target.value)}>
        {categories.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select>
        <button type="button" className={`${w.btn} ${w.primary} ${w.sm}`} disabled={category === task.raw.category} onClick={() => onSet({ category })}>改</button>{cancel}</>}
      {kind === "priority" && <><Stepper small label="优先级" value={priority} onChange={setPriority} min={0} max={100} />
        <button type="button" className={`${w.btn} ${w.primary} ${w.sm}`} disabled={priority === undefined || priority === task.raw.priority} onClick={() => onSet({ priority: priority ?? 50 })}>改</button>{cancel}</>}
      {kind === "delete" && <><span>删除「{task.name}」？不能撤销</span>
        <button type="button" className={`${w.btn} ${w.danger} ${w.sm}`} onClick={onDelete}>删除</button>{cancel}</>}
    </div>
  );
}

/** Has the phone update its App now, while it is out of reach. */
function UpdateApp({ device }: { device: string }) {
  const [said, setSaid] = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);
  return <>
    <button type="button" className={`${w.btn} ${w.sm}`} title={said ?? undefined} disabled={updating} onClick={async () => {
      setUpdating(true);
      try { await dev.updateApp(device); setSaid("已通知"); } catch (error) { setSaid(failure(error)); }
      setUpdating(false);
    }}>{updating ? "通知中…" : said ?? "更新"}</button>
  </>;
}

type Tone = "pass" | "fail" | "none" | "same";
export interface Standing { task: TaskDef; changed: boolean; isNew: boolean; fresh: TrialRecord | null; tone: Tone; label: string; sub: string; run: string; fields: string }

/** How a task stands: changed since the draft's base, and whether its newest trial ran on what it is now. */
export function standing(task: TaskDef, body: Obj, bases: Record<string, string>, digests: Record<string, string>, trial: TrialRecord | undefined,
  devices: { id: string; name: string }[]): Standing {
  const now = digests[`tasks/${task.id}`];
  const base = bases[`tasks/${task.id}`];
  const isNew = base === undefined;
  const parts = usedSnippets(body, task.raw).filter((id) => digests[`snippets/${id}`] !== undefined && digests[`snippets/${id}`] !== bases[`snippets/${id}`]);
  const changed = now !== undefined && (base !== now || parts.length > 0);
  const fresh = trial && trial.step === null && trial.digest === digests[`trial/${task.id}`] ? trial : null;
  const [tone, label]: [Tone, string] = fresh ? (fresh.state === "FINISHED" ? ["pass", "通过"] : ["fail", "失败"])
    : changed ? ["none", "未试跑"] : ["same", "同发布版"];
  const whole = task.steps.filter((st) => typeof st.use === "string").length;
  const steps = `${task.steps.length} 个步骤${whole ? `（${whole} 个片段）` : ""}`;
  const sub = isNew ? `新任务 · ${steps}` : base !== now ? `改过 · ${steps}` : changed ? `片段改过 · ${steps}` : steps;
  void devices;
  const detail = fresh?.detail ? ` · ${fresh.detail.length > 14 ? `${fresh.detail.slice(0, 14)}…` : fresh.detail}` : "";
  const run = fresh ? `${clock(fresh.startedAt)}${detail}` : trial?.step ? "只跑过单步" : trial ? "改后未试跑" : "—";
  const fields = task.fields.length ? `${task.fields.length} 项` : "—";
  return { task, changed, isNew, fresh, tone, label, sub, run, fields };
}

/** Whether [task] calls snippet [id] anywhere: as a whole step, inside a script, or inside a program. */
export function uses(body: Obj, task: TaskDef, id: string): boolean {
  return usedSnippets(body, task.raw).includes(id);
}

/** An id from [name] (letters and digits kept, [fallback] for a name without any) that none of [taken] has. */
export function uniqueId(name: string, taken: string[], fallback = "node"): string {
  const base = (/^[A-Za-z][A-Za-z0-9-]*$/.test(name) ? name : name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")) || fallback;
  let id = base; let n = 2;
  while (taken.includes(id)) id = `${base}-${n++}`;
  return id;
}

export const clock = (at: number) => {
  const d = new Date(at); const today = new Date();
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return d.toDateString() === today.toDateString() ? hm : `${d.getMonth() + 1}-${d.getDate()} ${hm}`;
};
export const duration = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return s >= 60 ? `${Math.floor(s / 60)} 分 ${String(s % 60).padStart(2, "0")} 秒` : `${s} 秒`;
};
export { failure };
