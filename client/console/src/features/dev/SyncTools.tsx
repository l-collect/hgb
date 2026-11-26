import { useEffect, useState } from "react";
import { ask } from "../../components/Confirm";
import { Popover } from "../../components/ui";
import { dev, type DraftSnapshot, type Obj, type SyncResult } from "./api";
import { failure, useDev } from "./context";
import { snippets, str, tasks } from "./model";
import w from "./Wb.module.css";

const REASON: Record<string, string> = { sync: "同步前", restore: "恢复前", manual: "手动" };

/**
 * 从仓库同步 (keeping what was changed here) and 快照 (the copies kept before each sync or restore, to put one back), on
 * the task list and the publish page alike. [onDone] gets what to say: [text, ok].
 */
export function SyncTools({ onDone, changed }: { onDone: (said: [string, boolean] | null, result?: SyncResult) => void; changed: number }) {
  const { syncRepo, restoreSnapshot, edits, game } = useDev();
  const [busy, setBusy] = useState(false);
  const unsaved = Object.keys(edits).length;
  const sync = async () => {
    const lines = [changed ? `改过的 ${changed} 个任务保留你的` : "", unsaved ? `${unsaved} 处没保存的脚本会丢掉` : "", "同步前自动存快照"].filter(Boolean);
    if (!await ask({ title: "从仓库同步？", body: lines.join("；"), ok: "同步", cancel: "取消", danger: unsaved > 0 })) return;
    setBusy(true); onDone(null);
    const { problem, result } = await syncRepo();
    setBusy(false);
    onDone(problem ? [problem, false] : [synced(result), !result?.conflicts?.length], result ?? undefined);
  };
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

/** What a sync did, in one line: 「已同步 · 保留 2 项 · 冲突 1 项」. */
function synced(result: SyncResult | null): string {
  const kept = result?.kept?.length ?? 0, conflicts = result?.conflicts?.length ?? 0;
  return ["已同步", kept ? `保留 ${kept} 项` : "", conflicts ? `冲突 ${conflicts} 项` : ""].filter(Boolean).join(" · ");
}

/** A synced node's path (`tasks/daily`, `snippets/open`, `targets/onmyoji`) in words. */
export function syncedName(path: string, body: Obj | null | undefined): string {
  const [kind, ...rest] = path.split("/"); const id = rest.join("/");
  if (kind === "tasks") return `任务 ${(body && tasks(body).find((t) => t.id === id)?.name) || id}`;
  if (kind === "snippets") return `片段 ${(body && str(snippets(body).find((x) => String(x.id) === id)?.name)) || id}`;
  if (kind === "targets") return "游戏与页面";
  if (kind === "resources") return `模板 ${id}`;
  return path;
}

/** The conflicts a sync left, one line each: where, and why it kept the author's. */
export function SyncConflicts({ result, body }: { result: SyncResult | null; body: Obj | null | undefined }) {
  if (!result?.conflicts?.length) return null;
  return <div className={w.muted}>{result.conflicts.map((c) => <div key={c.path}>{syncedName(c.path, body)}：{c.reason}</div>)}</div>;
}
