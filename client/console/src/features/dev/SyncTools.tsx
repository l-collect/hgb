import { useEffect, useState } from "react";
import { ask } from "../../components/Confirm";
import { Popover } from "../../components/ui";
import { useConsole } from "../../state/context";
import { dev, draftBase, latestRelease, type DraftSnapshot, type Json, type LatestRelease, type Obj, type SyncResult } from "./api";
import { failure, useDev } from "./context";
import { snippets, str, tasks } from "./model";
import { Sides } from "./PatchConflicts";
import w from "./Wb.module.css";

const REASON: Record<string, string> = { sync: "同步前", restore: "恢复前", manual: "手动", delete: "删除前" };

/** 从仓库同步, asked first (what is kept, what goes), keeping what was changed here; [onDone] gets what to say and what it did. */
function useSync(onDone: (said: [string, boolean] | null, result?: SyncResult) => void, changed: number) {
  const { syncRepo, edits } = useDev();
  const [busy, setBusy] = useState(false);
  const unsaved = Object.keys(edits).length;
  const sync = async () => {
    const lines = [changed ? `改过的 ${changed} 个任务保留你的` : "", unsaved ? `${unsaved} 处没保存的脚本会丢掉` : "", "同步前自动存快照"].filter(Boolean);
    if (!await ask({ title: "从仓库同步？", body: lines.join("；"), ok: "同步", cancel: "取消", danger: unsaved > 0 })) return;
    setBusy(true); onDone(null);
    const { problem, result } = await syncRepo();
    setBusy(false);
    // Kept or both-changed nodes are what a sync is for: only a real failure is said in red.
    onDone(problem ? [problem, false] : [synced(result), true], result ?? undefined);
  };
  return { sync, busy, setBusy };
}

/**
 * The tasks published for this game (what players get, /api/games) that the draft does not have and never had: the
 * repository moved on since the draft was imported. Deleted here (in the draft's bases) is not counted.
 */
export function useRepoOnly(): { taskId: string; name: string }[] {
  const { draft, game } = useDev();
  const { data } = useConsole();
  if (!draft) return [];
  const mine = new Set(tasks(draft.body).map((t) => t.id));
  return (data.games.find((g) => g.id === game)?.tasks ?? [])
    .filter((t) => !mine.has(t.taskId) && draft.bases[`tasks/${t.taskId}`] === undefined).map((t) => ({ taskId: t.taskId, name: t.name }));
}
/** Whether version [a] (`v2.2.0`) is after [b]; a [b] that is not a version number counts as older when they differ. */
function newer(a: string, b: string): boolean {
  const parts = (v: string) => /^v?(\d+(?:\.\d+)*)/.exec(v.trim())?.[1].split(".").map(Number) ?? null;
  const x = parts(a), y = parts(b);
  if (!x) return false;
  if (!y) return a.trim() !== b.trim();
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  return false;
}
/**
 * The newest published version (the server's /latest, kept a few minutes) when it is after the one the draft is based
 * on, with the tasks it has that the draft does not and never had (deleted here, in the draft's bases, is not counted).
 * Null when there is none newer, or the server cannot tell.
 */
export function useRepoNewer(): { version: string; base: string; tasks: { taskId: string; name: string }[] } | null {
  const { draft, game } = useDev();
  const { data } = useConsole();
  const [latest, setLatest] = useState<LatestRelease | null>(null);
  useEffect(() => {
    let live = true;
    setLatest(null);
    void latestRelease(game).then((x) => { if (live) setLatest(x); });
    return () => { live = false; };
  }, [game, draft?.baseVersion]);
  if (!draft || !latest?.version) return null;
  // A base label may carry where it came from (`v2.1.0 · main@abc1234`): the version is its first part.
  const base = draft.baseVersion.split(" · ")[0].trim();
  if (!newer(latest.version, base)) return null;
  const mine = new Set(tasks(draft.body).map((t) => t.id));
  const names = new Map((data.games.find((g) => g.id === game)?.tasks ?? []).map((t) => [t.taskId, t.name]));
  const only = latest.tasks.filter((id) => !mine.has(id) && draft.bases[`tasks/${id}`] === undefined).map((id) => ({ taskId: id, name: names.get(id) ?? id }));
  return { version: latest.version, base, tasks: only };
}
/** 「仓库有新版本 v2.2.0（草稿基于 v2.1.0）· 多 1 个任务（游戏启动） ［同步］」, only when the repository has a newer version. */
export function RepoAhead({ onDone, changed }: { onDone: (said: [string, boolean] | null, result?: SyncResult) => void; changed: number }) {
  const ahead = useRepoNewer();
  const { sync, busy } = useSync(onDone, changed);
  if (!ahead) return null;
  const only = ahead.tasks;
  const names = only.slice(0, 2).map((t) => t.name).join("、") + (only.length > 2 ? " 等" : "");
  return <div className={w.repoAhead} role="status">
    <span>仓库有新版本 {ahead.version}<span className={w.muted}>（草稿基于 {ahead.base || "更早的版本"}）</span>
      {only.length > 0 && <> · 多 {only.length} 个任务<span className={w.muted}>（{names}）</span></>}</span>
    <button type="button" className={`${w.btn} ${w.sm}`} disabled={busy} onClick={() => void sync()}>{busy ? "同步中…" : "同步"}</button>
  </div>;
}

/**
 * 从仓库同步 (keeping what was changed here) and 快照 (the copies kept before each sync or restore, to put one back), on
 * the task list and the publish page alike. [onDone] gets what to say: [text, ok].
 */
export function SyncTools({ onDone, changed }: { onDone: (said: [string, boolean] | null, result?: SyncResult) => void; changed: number }) {
  const { restoreSnapshot, deleteDraft, edits, game } = useDev();
  const { sync, busy, setBusy } = useSync(onDone, changed);
  const unsaved = Object.keys(edits).length;
  const restore = async (snap: DraftSnapshot) => {
    if (!await ask({ title: "恢复这份快照？", body: `${when(snap.at)} · 修订 ${snap.revision}${unsaved ? `；${unsaved} 处没保存的脚本会丢掉` : ""}；现在的草稿先存快照`, ok: "恢复", cancel: "取消", danger: true })) return;
    setBusy(true); onDone(null);
    const problem = await restoreSnapshot(snap.id);
    setBusy(false);
    onDone(problem ? [problem, false] : [`已恢复到 ${when(snap.at)} 的快照`, true]);
  };
  // 删除草稿: a snapshot is kept first, then a fresh copy of the repository's latest is imported.
  const remove = async () => {
    const lost = [changed ? `${changed} 处改动还没发布` : "", unsaved ? `${unsaved} 处脚本没保存` : ""].filter(Boolean).join("、");
    if (!await ask({ title: "删除这份草稿？", body: `${lost ? `${lost}，会一起丢掉；` : ""}删除前会存一份快照，30 天内可在「快照」里找回。删除后从仓库最新版本重新导入。`, ok: "删除", cancel: "取消", danger: true })) return;
    setBusy(true); onDone(null);
    // Through the workbench's queue: patches waiting go first, unsaved text and its bases are dropped with the draft.
    const problem = await deleteDraft();
    setBusy(false);
    onDone(problem ? [problem, false] : ["已删除草稿，换成了仓库最新版本 · 旧的在「快照」里", true]);
  };
  return <>
    <button type="button" className={w.btn} disabled={busy} onClick={() => void sync()}>{busy ? "同步中…" : "从仓库同步"}</button>
    <Popover label="快照" plain trigger={<span className={w.btn}>快照 ▾</span>}>
      {(close) => <Snapshots game={game} onRestore={(snap) => { close(); void restore(snap); }} />}
    </Popover>
    <button type="button" className={w.btn} disabled={busy} style={{ color: "var(--color-danger)" }} onClick={() => void remove()}>删除草稿</button>
  </>;
}

function Snapshots({ game, onRestore }: { game: string; onRestore: (snap: DraftSnapshot) => void }) {
  const [list, setList] = useState<DraftSnapshot[] | string | null>(null);
  const [saving, setSaving] = useState(false);
  const load = () => dev.snapshots(game).then(setList, (e) => setList(failure(e)));
  useEffect(() => { void load(); }, [game]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = async () => {
    setSaving(true);
    try { await dev.saveSnapshot(game); await load(); } catch (error) { setList(failure(error)); }
    setSaving(false);
  };
  return <div className={w.snapList} aria-label="快照">
    <div className={w.snapItem}><span className={w.muted}>最近 5 份</span>
      <button type="button" className={`${w.btn} ${w.sm}`} disabled={saving} onClick={() => void save()}>{saving ? "存中…" : "存一份"}</button></div>
    {list === null ? <span className={`${w.muted} ${w.snapItem}`}>读取中…</span>
      : typeof list === "string" ? <span className={`${w.message} ${w.snapItem}`}>{list}</span>
      : !list.length ? <span className={`${w.muted} ${w.snapItem}`}>还没有快照</span>
      : list.map((x) => <div key={x.id} className={w.snapItem}>
          <span>{when(x.at)} · {REASON[x.reason] ?? x.reason}<span className={w.muted}> · 修订 {x.revision} · {x.tasks} 任务</span></span>
          <button type="button" className={`${w.btn} ${w.sm}`} onClick={() => onRestore(x)}>恢复</button>
        </div>)}
  </div>;
}

const when = (at: number) => { const d = new Date(at); return `${d.getMonth() + 1}/${d.getDate()} ${d.toTimeString().slice(0, 5)}`; };

/** What a sync did, in one line: 「已同步 · 保留你改的 2 项 · 1 项两边都改了」. */
export function synced(result: SyncResult | null): string {
  const kept = result?.kept?.length ?? 0, conflicts = result?.conflicts?.length ?? 0;
  return ["已同步", kept ? `保留你改的 ${kept} 项` : "", conflicts ? `${conflicts} 项两边都改了` : ""].filter(Boolean).join(" · ");
}
/** The nodes a sync found changed on both sides (kept as the author had them), by path (`tasks/daily`). */
export const bothChanged = (result: SyncResult | null | undefined) => new Set((result?.conflicts ?? []).map((c) => c.path));

/** A synced node's path (`tasks/daily`, `snippets/open`, `targets/onmyoji`) in words. */
export function syncedName(path: string, body: Obj | null | undefined): string {
  const [kind, ...rest] = path.split("/"); const id = rest.join("/");
  if (kind === "tasks") return `任务 ${(body && tasks(body).find((t) => t.id === id)?.name) || id}`;
  if (kind === "snippets") return `片段 ${(body && str(snippets(body).find((x) => String(x.id) === id)?.name)) || id}`;
  if (kind === "targets") return "游戏与页面";
  if (kind === "resources") return `模板 ${id}`;
  return path;
}

/**
 * What a sync did, said once: 「已同步 · 保留你改的 2 项 · 1 项两边都改了 ［看差异］［撤销这次同步］」. 看差异 opens each
 * both-changed node line by line (− 别处的, the repository's · + 我的, kept); 撤销 puts back the snapshot the sync kept first.
 * [onUndone] gets what to say then; after a failed undo the report stays (its caller keeps it) and says why.
 */
export function SyncReport({ result, body, onUndone }: { result: SyncResult; body: Obj | null | undefined; onUndone: (said: [string, boolean]) => void }) {
  const { restoreSnapshot, game, edits } = useDev();
  const [open, setOpen] = useState(false);
  const [base, setBase] = useState<Obj | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const both = result.conflicts ?? [];
  const unsaved = Object.keys(edits).length;
  // Another sync's report starts closed, and its 看差异 reads the base again (the last one's is not this one's).
  useEffect(() => { setOpen(false); setBase(undefined); setProblem(null); }, [result]);
  useEffect(() => {
    if (!open || base !== undefined) return;
    let live = true;
    draftBase(game).then((b) => { if (live) setBase(b); }, () => { if (live) setBase(null); });
    return () => { live = false; };
  }, [open, base, game]);
  const undo = async () => {
    if (!result.snapshot) return;
    const body = ["草稿回到同步前的样子（同步前存的快照）", "同步后保存的改动也会回退（恢复前会先存快照）", unsaved ? `${unsaved} 处没保存的脚本会丢掉` : ""].filter(Boolean).join("；");
    if (!await ask({ title: "撤销这次同步？", body, ok: "撤销", cancel: "取消", danger: true })) return;
    setBusy(true); setProblem(null);
    const failed = await restoreSnapshot(result.snapshot);
    setBusy(false);
    // A failed undo keeps the report (and its 撤销) here, with why.
    if (failed) setProblem(failed);
    onUndone(failed ? [failed, false] : ["已撤销这次同步", true]);
  };
  const nodeOf = (b: Obj | null | undefined, path: string): Json | null => {
    if (!b) return null;
    const [kind, ...rest] = path.split("/"); const id = rest.join("/");
    if (kind === "tasks") return tasks(b).find((t) => t.id === id)?.raw ?? null;
    if (kind === "snippets") return snippets(b).find((x) => String(x.id) === id) ?? null;
    return null;
  };
  return <div className={w.syncReport}>
    <div className={w.syncLine} role="status">
      <span className={w.okText}>{synced(result)}</span>
      {both.length > 0 && <button type="button" className={w.linkBtn} aria-expanded={open} onClick={() => setOpen(!open)}>{open ? "收起差异" : "看差异"}</button>}
      {result.snapshot && <button type="button" className={w.linkBtn} disabled={busy} onClick={() => void undo()}>{busy ? "撤销中…" : "撤销这次同步"}</button>}
      {problem && <span className={w.message}>没撤销成：{problem}</span>}
    </div>
    {open && <div className={`${w.card} ${w.syncDiff}`}>
      <span className={w.muted}>两边都改了，留的是我的 · − 别处的 · + 我的</span>
      {both.map((c) => base === undefined ? <span key={c.path} className={w.muted}>{syncedName(c.path, body)} · 读取中…</span>
        : base === null || nodeOf(base, c.path) === null ? <span key={c.path} className={w.muted}>{syncedName(c.path, body)}：{c.reason}</span>
        : <Sides key={c.path} name={syncedName(c.path, body)} theirs={nodeOf(base, c.path)} mine={nodeOf(body, c.path)} />)}
    </div>}
  </div>;
}
