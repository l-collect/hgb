import { useEffect, useState } from "react";
import { ask } from "../../components/Confirm";
import { Popover } from "../../components/ui";
import { useConsole } from "../../state/context";
import { dev, draftBase, type DraftSnapshot, type Json, type Obj, type SyncResult } from "./api";
import { failure, useDev } from "./context";
import { snippets, str, tasks } from "./model";
import { Sides } from "./PatchConflicts";
import w from "./Wb.module.css";

const REASON: Record<string, string> = { sync: "同步前", restore: "恢复前", manual: "手动" };

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
/** 「仓库有新任务 · 多 1 个（游戏启动、更新与退出） ［同步］」 when the published tasks are ahead of the draft. */
export function RepoAhead({ onDone, changed }: { onDone: (said: [string, boolean] | null, result?: SyncResult) => void; changed: number }) {
  const { draft } = useDev();
  const only = useRepoOnly();
  const { sync, busy } = useSync(onDone, changed);
  if (!only.length || !draft) return null;
  const names = only.slice(0, 2).map((t) => t.name).join("、") + (only.length > 2 ? " 等" : "");
  return <div className={w.repoAhead} role="status">
    <span>仓库有新任务 · 多 {only.length} 个<span className={w.muted}>（{names}）</span></span>
    <span className={w.muted}>草稿基于 {draft.baseVersion || "更早的版本"}</span>
    <button type="button" className={`${w.btn} ${w.sm}`} disabled={busy} onClick={() => void sync()}>{busy ? "同步中…" : "同步"}</button>
  </div>;
}

/**
 * 从仓库同步 (keeping what was changed here) and 快照 (the copies kept before each sync or restore, to put one back), on
 * the task list and the publish page alike. [onDone] gets what to say: [text, ok].
 */
export function SyncTools({ onDone, changed }: { onDone: (said: [string, boolean] | null, result?: SyncResult) => void; changed: number }) {
  const { restoreSnapshot, edits, game } = useDev();
  const { sync, busy, setBusy } = useSync(onDone, changed);
  const unsaved = Object.keys(edits).length;
  const restore = async (snap: DraftSnapshot) => {
    if (!await ask({ title: "恢复这份快照？", body: `${when(snap.at)} · 修订 ${snap.revision}${unsaved ? `；${unsaved} 处没保存的脚本会丢掉` : ""}；现在的草稿先存快照`, ok: "恢复", cancel: "取消", danger: true })) return;
    setBusy(true); onDone(null);
    const problem = await restoreSnapshot(snap.id);
    setBusy(false);
    onDone(problem ? [problem, false] : [`已恢复到 ${when(snap.at)} 的快照`, true]);
  };
  return <>
    <button type="button" className={w.btn} disabled={busy} onClick={() => void sync()}>{busy ? "同步中…" : "从仓库同步"}</button>
    <Popover label="快照" plain trigger={<span className={w.btn}>快照 ▾</span>}>
      {(close) => <Snapshots game={game} onRestore={(snap) => { close(); void restore(snap); }} />}
    </Popover>
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
