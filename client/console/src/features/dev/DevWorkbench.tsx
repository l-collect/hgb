import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ApiFailure } from "../../api/client";
import { ask } from "../../components/Confirm";
import { Popover } from "../../components/ui";
import { href, leave, Link, match, navigate, usePath } from "../../router";
import { useConsole } from "../../state/context";
import { knownTasks, publishWorkbench, useDeveloper } from "../../state/developer";
import { useNarrow } from "../../shell/useWidth";
import frame from "../../shell/Shell.module.css";
import { dev, type Capability, type DevMe, type DraftPatch, type DraftSummary, type DraftView, type Obj, type PatchConflict, type SyncResult, type TrialRecord } from "./api";
import { CONFLICT, DevContext, devPaths, EDIT_CONFLICT, failure, PATCH_CONFLICT, scriptPath, useDev, type Edit } from "./context";
import { PatchConflicts } from "./PatchConflicts";
import { onDevRun, useDevRunStream } from "./events";
import { ConfigPage } from "./ConfigPage";
import { HomePage, standing } from "./HomePage";
import { nodeDigest, readDigest, snippets, str, target, tasks, trialDigester } from "./model";
import { PagesPage } from "./PagesPage";
import { PublishPage } from "./PublishPage";
import { SamplesPage } from "./SamplesPage";
import { Workspace } from "./Workspace";
import w from "./Wb.module.css";

const GAME_KEY = "wb.game";
const DEVICE_KEY = "wb.device";
const remembered = (key: string): string | null => { try { return localStorage.getItem(key); } catch { return null; } };
const remember = (key: string, value: string) => { try { localStorage.setItem(key, value); } catch { /* private window: chosen for this visit only */ } };

/**
 * The developer workbench (developer-workbench.md), in the console's frame (section dev): one top bar (game, the draft's
 * revision and sync state, the phone every page uses, publish), then the part chosen. The parts (任务脚本, 素材, 页面,
 * 发布) are the sidebar's 开发 group; where the sidebar has none (a narrow window, or someone who is not a developer
 * opening /dev by its address) the top bar keeps them as tabs.
 */
export function DevWorkbench() {
  const { data } = useConsole();
  const path = usePath();
  const [game, setGame] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<DraftSummary[]>([]);
  const [draft, setDraft] = useState<DraftView | null>(null);
  const [catalog, setCatalog] = useState<Capability[]>([]);
  const [me, setMe] = useState<DevMe | null>(null);
  const [trials, setTrials] = useState<TrialRecord[]>([]);
  const [digests, setDigests] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [editBases, setEditBases] = useState<Record<string, string>>({});
  const editsNow = useRef(edits); editsNow.current = edits;
  const basesNow = useRef(editBases); basesNow.current = editBases;
  const [pending, setPending] = useState(0);
  const [conflict, setConflict] = useState(false);
  // A batch the server refused with both sides of each node: shown to choose from, never sent again by itself.
  const [refused, setRefused] = useState<{ patches: DraftPatch[]; conflicts: PatchConflict[] } | null>(null);
  const [checkFailed, setCheckFailed] = useState<boolean | null>(null);
  // An edit makes the last whole check stale: the mark goes until 发布 checks again.
  useEffect(() => { setCheckFailed(null); }, [draft?.revision]);
  // The node each unsaved script was when editing began: its digest is the patch's base, so only a change made
  // elsewhere since then is a conflict.
  const starts = useRef<Record<string, Obj>>({});
  // Leaving the workbench with typed scripts unsaved asks first: closing the tab, a link out of /dev (the top bar's
  // 「← 控制台」 among them) and the back button; moving around inside keeps the text and asks nothing.
  const unsaved = Object.keys(edits).length > 0;
  const unsavedNow = useRef(unsaved); unsavedNow.current = unsaved;
  const here = useRef(location.pathname + location.search); here.current = location.pathname + location.search;
  useEffect(() => {
    if (!unsaved) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [unsaved]);
  useEffect(() => {
    const base = href("/dev");
    const inDev = (pathname: string) => pathname === base || pathname.startsWith(`${base}/`);
    const out = () => `有 ${Object.keys(editsNow.current).length} 处脚本没保存，离开会丢掉`;
    const click = (event: MouseEvent) => {
      if (!unsavedNow.current || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const a = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || a.origin !== location.origin || inDev(a.pathname)) return;
      event.preventDefault(); event.stopPropagation();
      const to = a.pathname.slice(import.meta.env.BASE_URL.replace(/\/$/, "").length) + a.search;
      void ask({ title: "离开开发工作台？", body: out(), ok: "离开", cancel: "留下", danger: true }).then((yes) => { if (yes) leave(() => navigate(to)); });
    };
    const back = (event: PopStateEvent) => {
      if (!unsavedNow.current || inDev(location.pathname)) return;
      event.stopImmediatePropagation();
      const to = location.pathname.slice(import.meta.env.BASE_URL.replace(/\/$/, "").length) + location.search;
      history.pushState(null, "", here.current);
      void ask({ title: "离开开发工作台？", body: out(), ok: "离开", cancel: "留下", danger: true }).then((yes) => { if (yes) leave(() => navigate(to)); });
    };
    document.addEventListener("click", click, true);
    window.addEventListener("popstate", back);
    return () => { document.removeEventListener("click", click, true); window.removeEventListener("popstate", back); };
  }, []);
  const setEdit = useCallback((key: string, text: string | undefined, saved: string | undefined) => {
    if (text === undefined) delete starts.current[key];
    else if (!(key in starts.current) && latest.current) { const node = scriptNode(latest.current.body, key); if (node) starts.current[key] = node; }
    setEdits((all) => { const next = { ...all }; if (text === undefined) delete next[key]; else next[key] = text; return next; });
    setEditBases((all) => {
      if (text === undefined) { if (!(key in all)) return all; const next = { ...all }; delete next[key]; return next; }
      return key in all ? all : { ...all, [key]: saved ?? "" };
    });
  }, []);

  // The phone: the one chosen (remembered), else the first online Android one.
  const phones = data.devices.filter((d) => d.platform === "android");
  const [chosen, setChosen] = useState<string | null>(() => remembered(DEVICE_KEY));
  const device = phones.some((d) => d.id === chosen) ? chosen : phones.find((d) => d.online)?.id ?? phones[0]?.id ?? null;
  const setDevice = useCallback((id: string) => { setChosen(id); remember(DEVICE_KEY, id); }, []);

  // The draft as last read, for edits computed from it; reads are numbered so a late answer cannot replace a newer one.
  const latest = useRef<DraftView | null>(null);
  const reads = useRef(0);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  // The game shown now: a read or edit begun for another game is dropped when it ends.
  const current = useRef<string | null>(null);
  const load = useCallback(async (id: string) => {
    const n = ++reads.current;
    const fresh = () => n === reads.current && current.current === id;
    try { const view = await dev.draft(id); if (fresh()) { latest.current = view; setDraft(view); setProblem(null); } }
    catch (error) { if (!fresh()) return; if (error instanceof ApiFailure && error.status === 404) { latest.current = null; setDraft(null); } else setProblem(failure(error)); }
  }, []);
  const loadTrials = useCallback(async (id: string) => {
    try { const list = await dev.trials(id); if (current.current === id) setTrials(list); } catch { /* the list stays as it was */ }
  }, []);
  const gameIds = data.games.map((g) => g.id).join(",");
  useEffect(() => {
    (async () => {
      try {
        const [list, cat, mine] = await Promise.all([dev.drafts(), dev.catalog(), dev.me()]);
        setDrafts(list); setCatalog(cat); setMe(mine);
        const known = [...list.map((d) => d.target), ...gameIds.split(",").filter(Boolean)];
        // ?game= (a link from the App or a run): that game, remembered; the parameter is dropped from the address.
        const asked = new URLSearchParams(location.search).get("game");
        if (asked) {
          remember(GAME_KEY, asked);
          const rest = new URLSearchParams(location.search); rest.delete("game");
          history.replaceState(history.state, "", location.pathname + (rest.size ? `?${rest}` : "") + location.hash);
        }
        const kept = remembered(GAME_KEY);
        const id = kept && (known.includes(kept) || kept === asked) ? kept : list[0]?.target ?? known[0] ?? "onmyoji";
        current.current = id; setGame(id); await Promise.all([load(id), loadTrials(id)]);
      } catch (error) { setProblem(failure(error)); }
      setLoaded(true);
    })();
  }, [load, loadTrials, gameIds]);
  const switchGame = async (id: string) => {
    if (id === game) return;
    if (unsaved && !await ask({ title: "切换游戏？", body: `有 ${Object.keys(edits).length} 处脚本没保存，切换会丢掉`, ok: "切换", cancel: "留下", danger: true })) return;
    // Edits already queued belong to this game: let them finish (and read back) before the game changes.
    await queue.current;
    setEdits({}); setEditBases({}); remember(GAME_KEY, id);
    current.current = id; reads.current++; latest.current = null; setDraft(null); setTrials([]); setDigests({}); setConflict(false);
    setGame(id); navigate(devPaths.home);
    await Promise.all([load(id), loadTrials(id)]);
  };
  // What every task and snippet is now, to tell what changed since the base and whether a trial ran on it.
  useEffect(() => {
    if (!draft) return;
    let live = true;
    const nodes = [
      ...tasks(draft.body).map((t) => [`tasks/${t.id}`, t.raw] as const),
      ...snippets(draft.body).map((sn) => [`snippets/${String(sn.id)}`, sn] as const),
      ...(game && target(draft.body, game) ? [[`targets/${game}`, target(draft.body, game)!] as const] : []),
    ];
    // By node of this read (kept with the node); the pages, graph and snippets a trial runs worked out once, not per task.
    const trial = trialDigester(draft.body);
    Promise.all([...nodes.map(async ([key, node]) => [key, await readDigest(node)] as const),
      ...tasks(draft.body).map(async (t) => [`trial/${t.id}`, await trial(t.raw)] as const)])
      .then((pairs) => { if (live) setDigests(Object.fromEntries(pairs)); });
    return () => { live = false; };
  }, [draft]); // eslint-disable-line react-hooks/exhaustive-deps
  const reload = useCallback(async () => { if (game) await load(game); }, [game, load]);
  const reloadTrials = useCallback(async () => { if (game) await loadTrials(game); }, [game, loadTrials]);
  /**
   * Sends patches one batch at a time, each after the draft has been read back from the one before; [edit] may be a
   * function of that latest draft, so quick successive edits build on each other. A conflict (409) reads the draft again
   * and says so.
   */
  const apply = useCallback((edit: Edit) => {
    setPending((n) => n + 1);
    const run = queue.current.then(async (): Promise<string | null> => {
      if (game && current.current !== game) return "已切换游戏，这次改动没保存";
      if (!game || !latest.current) return "还没有草稿";
      try {
        const patches = typeof edit === "function" ? await edit(latest.current.body) : edit;
        if (!patches.length) return null;
        if (current.current !== game) return "已切换游戏，这次改动没保存";
        const result = await dev.patch(game, patches);
        await load(game);
        if (result.conflicts.length) {
          setConflict(true);
          // Both sides came back: the author chooses; an older server sends only the paths.
          if (result.conflicts.some((c) => c.mine !== undefined || c.current !== undefined)) { setRefused({ patches, conflicts: result.conflicts }); return PATCH_CONFLICT; }
          return CONFLICT;
        }
        setConflict(false); return null;
      } catch (error) {
        await load(game);
        if (error instanceof ApiFailure && error.status === 409) { setConflict(true); return CONFLICT; }
        return failure(error);
      }
    }).finally(() => setPending((n) => n - 1));
    queue.current = run.catch(() => null);
    return run;
  }, [game, load]);
  /** Replaces the draft from the server's side (a sync or a restore): unsaved text goes, the draft is read again. */
  const replaceDraft = useCallback(<T,>(work: (id: string) => Promise<T>) => {
    setPending((n) => n + 1);
    const run = queue.current.then(async (): Promise<{ problem: string | null; result: T | null }> => {
      if (!game) return { problem: "没有选中游戏", result: null };
      if (current.current !== game) return { problem: "已切换游戏，没有做", result: null };
      try {
        const result = await work(game);
        setEdits({}); setEditBases({}); starts.current = {}; setConflict(false); setRefused(null);
        await load(game); return { problem: null, result };
      } catch (error) { return { problem: failure(error), result: null }; }
    }).finally(() => setPending((n) => n - 1));
    queue.current = run.catch(() => null);
    return run;
  }, [game, load]);
  const syncRepo = useCallback(() => replaceDraft<SyncResult>((id) => dev.importLatest(id, true)), [replaceDraft]);
  const restoreSnapshot = useCallback(async (snapshot: string) => (await replaceDraft((id) => dev.restoreSnapshot(id, snapshot))).problem, [replaceDraft]);
  /** 删除草稿: the server keeps a snapshot, then the repository's latest is imported; unsaved text goes as with a sync. */
  const deleteDraft = useCallback(async () => (await replaceDraft((id) => dev.deleteDraft(id).then(() => dev.importLatest(id, false)))).problem, [replaceDraft]);

  /**
   * Saves one script: held back when the draft's text is no longer the one editing began from (someone changed it
   * elsewhere), unless [force]; the workspace then shows both sides.
   */
  const saveScript = useCallback(async (key: string, force = false): Promise<string | null> => {
    const raw = editsNow.current[key];
    if (raw === undefined) return null;
    const normalized = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n+$/, "");
    let held = false;
    const problem = await apply(async (b): Promise<DraftPatch[]> => {
      const now = scriptNode(b, key); if (!now) return [];
      const base = basesNow.current[key];
      const theirs = str(now.script) ?? "";
      if (!force && base !== undefined && theirs !== base && theirs !== normalized) { held = true; return []; }
      // The node as editing began is the base: changed elsewhere since (its name, say), the server sends both sides.
      const start = force ? undefined : starts.current[key];
      return [{ op: "put", path: scriptPatchPath(key), expect: await nodeDigest(now), ...(start ? { base: await nodeDigest(start) } : {}), value: { ...now, script: normalized } }];
    });
    if (held) return EDIT_CONFLICT;
    if (problem) return problem;
    const gone = editsNow.current[key] === raw || editsNow.current[key] === normalized;
    if (gone) delete starts.current[key];
    else if (latest.current) { const node = scriptNode(latest.current.body, key); if (node) starts.current[key] = node; }
    setEdits((all) => { if (!gone) return all; const next = { ...all }; delete next[key]; return next; });
    setEditBases((all) => { const next = { ...all }; if (gone) delete next[key]; else next[key] = normalized; return next; });
    return null;
  }, [apply]);
  const conflicts = useMemo(() => !draft ? [] : Object.keys(edits).filter((k) => {
    const base = editBases[k]; if (base === undefined) return false;
    const theirs = str(scriptNode(draft.body, k)?.script);
    return theirs !== undefined && theirs !== base && theirs !== edits[k];
  }), [draft, edits, editBases]);

  // Trials end on the phone too (started there, or from another window): the task list follows.
  useDevRunStream();
  useEffect(() => onDevRun((run) => {
    if (run.kind === "trial" && run.target === current.current && run.state !== "SENT" && run.state !== "RUNNING") void loadTrials(run.target);
  }), [loadTrials]);

  const changed = useMemo(() => draft ? tasks(draft.body).filter((t) =>
    standing(t, draft.body, draft.bases, digests, trials.find((x) => x.task === t.id), data.devices).changed).length : 0,
  [draft, digests, trials, data.devices]);

  // The sidebar's 开发 group lists the draft's tasks, marks those with unsaved scripts and counts the changes.
  const unsavedTasks = Object.keys(edits).filter((k) => k.startsWith("step:")).map((k) => k.slice(5).split("/")[0]).sort().join(",");
  useEffect(() => {
    // Open but without a draft yet: still reading, or (read) this game has none; the sidebar waits rather than reading its own.
    if (!game || !draft) { publishWorkbench({ game: game ?? "", tasks: [], known: [], unsaved: [], changed: 0, loading: !loaded }); return; }
    publishWorkbench({ game, tasks: tasks(draft.body).map((t) => ({ id: t.id, name: t.name })), known: knownTasks(draft),
      unsaved: unsavedTasks ? unsavedTasks.split(",") : [], changed });
  }, [game, draft, unsavedTasks, changed, loaded]);
  useEffect(() => () => publishWorkbench(null), []);
  const developer = useDeveloper();
  const narrow = useNarrow();
  // The rail (600–1023) floats the same items from its 开发 icon; narrow has no group at all.
  const tabs = !developer || narrow;

  // Old addresses (样本库, 游戏设置, 状态库) land on the part that has them now.
  const moved = redirect(path);
  useEffect(() => { if (moved) navigate(moved + location.search + location.hash, { replace: true }); }, [moved]);

  const gameName = (draft && game && str(target(draft.body, game)?.name)) || data.games.find((g) => g.id === game)?.name || game || "";
  const games: [string, string][] = [...new Set([...drafts.map((d) => d.target), ...data.games.map((g) => g.id), ...(game ? [game] : [])])]
    .map((id) => [id, data.games.find((g) => g.id === id)?.name ?? (id === game ? gameName : id)]);
  const sync = conflicts.length || conflict ? ["冲突", "bad"] : pending > 0 ? ["保存中", "go"] : ["已保存", "ok"];
  const top = (
    <header className={w.top}>
      {game && <Popover label="切换游戏" plain trigger={<span className={w.topChip}>{gameName} ▾</span>}>
        {(close) => <div role="listbox" aria-label="游戏" className={w.menu}>
          {games.map(([id, name]) => <button key={id} type="button" role="option" aria-selected={id === game} className={w.menuItem}
            onClick={() => { close(); void switchGame(id); }}>{name}{drafts.some((d) => d.target === id) ? "" : <span className={w.muted}> · 没草稿</span>}</button>)}
        </div>}
      </Popover>}
      {tabs && <nav aria-label="开发工作台" className={w.topNav}>
        {([["任务", devPaths.home, path === devPaths.home || path.startsWith("/dev/tasks") || path.startsWith("/dev/snippets")],
          ["素材", devPaths.assets, path.startsWith(devPaths.assets)], ["页面", devPaths.pages, path.startsWith(devPaths.pages)],
          ["发布", devPaths.publish, path === devPaths.publish]] as [string, string, boolean][])
          .map(([label, to, on]) => <Link key={label} to={to} className={w.topTab} aria-current={on ? "page" : undefined}>{label}</Link>)}
      </nav>}
      <span className={w.topGrow} />
      {draft && <span className={w.topSync} title={`修订 ${draft.revision}`}>{conflicts.length
        ? <Link to={scriptPath(conflicts[0])} title="别处改过你正在编辑的脚本：去选用哪边" data-tone="bad">冲突{conflicts.length > 1 ? ` ${conflicts.length}` : ""} ›</Link>
        : <span data-tone={sync[1]}>{sync[0]}</span>}</span>}
      <Popover label="当前手机" plain align="end" trigger={<span className={w.topChip}>
        <span className={w.dotOnline} data-on={phones.find((d) => d.id === device)?.online ? "true" : undefined} />{phones.find((d) => d.id === device)?.name ?? "没有手机"} ▾</span>}>
        {(close) => <div role="listbox" aria-label="手机" className={w.menu}>
          {phones.length ? phones.map((d) => <button key={d.id} type="button" role="option" aria-selected={d.id === device} className={w.menuItem}
            onClick={() => { close(); setDevice(d.id); }}><span className={w.dotOnline} data-on={d.online ? "true" : undefined} />{d.name}
            <span className={w.muted}> · {d.online ? d.phase === "IDLE" ? "空闲" : "忙" : "离线"}</span></button>)
            : <span className={`${w.muted} ${w.menuItem}`}>在手机上登录 App</span>}
        </div>}
      </Popover>
      {changed > 0 && <Link to={devPaths.publish} className={`${w.btn} ${w.topPublish}`} title={checkFailed ? "检查没过 · 去发布页看" : "去发布页"}>
        {changed} 处改动{checkFailed && <span className={w.topBad} aria-label="检查没过" />}</Link>}
    </header>
  );
  let body: ReactNode;
  if (!loaded) body = <div className={w.empty}>正在加载…</div>;
  else if (!game) body = <div className={w.card}><div className={w.empty}>{problem}</div></div>;
  else body = <>{problem && <div className={w.message}>{problem}</div>}{draft ? route(path) : <NoDraft />}</>;
  /** 用我的: the refused batch again, each conflicting node expected as it is now; 用别处的: dropped (the draft is read already). */
  const resolve = async (mine: boolean) => {
    const was = refused; if (!was) return null;
    setRefused(null);
    if (!mine) {
      const paths = new Set(was.conflicts.map((c) => c.path));
      setEdits((all) => Object.fromEntries(Object.entries(all).filter(([k]) => !paths.has(scriptPatchPath(k)))));
      setEditBases((all) => Object.fromEntries(Object.entries(all).filter(([k]) => !paths.has(scriptPatchPath(k)))));
      setConflict(false); return null;
    }
    const byPath = new Map(was.conflicts.map((c) => [c.path, c]));
    const seen = new Set<string>();
    const again = was.patches.map((p): DraftPatch => {
      const c = byPath.get(p.path); const { base: _base, ...rest } = p; void _base;
      if (!c || seen.has(p.path)) return rest;
      seen.add(p.path);
      return { ...rest, expect: (p.op === "set" ? c.shallowDigest : c.digest) ?? rest.expect };
    });
    const problem = await apply(again);
    if (!problem) {
      // A script saved this way is no longer unsaved.
      const body = latest.current?.body;
      if (body) setEdits((all) => Object.fromEntries(Object.entries(all).filter(([k, v]) => str(scriptNode(body, k)?.script) !== v.replace(/\r\n?/g, "\n").replace(/\n+$/, ""))));
    }
    return problem;
  };
  const value = game ? { game, gameName, draft, catalog, me, trials, digests, reload, reloadTrials, apply, syncRepo, restoreSnapshot, deleteDraft, edits, setEdits, setEdit, editBases, conflicts, saveScript, device, setDevice,
    refused: refused?.conflicts ?? null, resolveRefused: resolve, checkFailed, setCheckFailed } : null;
  return (
    <div className={frame.devFrame}>
      {top}
      <main className={w.main} data-full={workspaceAt(path) ? "true" : undefined}>
        {/* In a workspace the card sits at the top of the editor; elsewhere at the top of the page. */}
        {refused && draft && !workspaceAt(path) && <PatchConflicts conflicts={refused.conflicts} body={draft.body} onChoose={resolve} />}
        {value ? <DevContext.Provider value={value}>{body}</DevContext.Provider> : body}
      </main>
    </div>
  );
}

/** A workspace fills the window below the top bar; the other parts scroll as pages. */
const workspaceAt = (path: string) => (path.startsWith("/dev/tasks/") || path.startsWith("/dev/snippets/")) && !path.endsWith("/config") && !path.endsWith("/blocks");

/** The step or snippet an unsaved script's key names ("step:<task>/<step>", "snippet:<id>"), in [body]. */
function scriptNode(body: Obj, key: string): Obj | undefined {
  if (key.startsWith("snippet:")) return snippets(body).find((sn) => String(sn.id) === key.slice(8));
  const [task, step] = key.slice(5).split("/");
  return tasks(body).find((t) => t.id === task)?.steps.find((st) => String(st.id) === step);
}
const scriptPatchPath = (key: string) => {
  if (key.startsWith("snippet:")) return `snippets:${key.slice(8)}`;
  const [task, step] = key.slice(5).split("/");
  return `tasks:${task}/steps:${step}`;
};

function redirect(path: string): string | null {
  let p: Record<string, string> | null;
  if (path === "/dev/samples") return devPaths.assets;
  if ((p = match("/dev/samples/:id", path))) return devPaths.asset(p.id);
  if (path === "/dev/game" || path === "/dev/states") return devPaths.pages;
  // 积木 pages are gone (scripts only): their old addresses open the script.
  if ((p = match("/dev/tasks/:task/steps/:step/blocks", path))) return devPaths.step(p.task, p.step);
  if ((p = match("/dev/snippets/:id/blocks", path))) return devPaths.snippet(p.id);
  return null;
}

function route(path: string): ReactNode {
  let p: Record<string, string> | null;
  // A task is one workspace: moving between its steps and snippets keeps it (and unsaved text) in place.
  if ((p = match("/dev/tasks/:task/steps/:step", path))) return <Workspace key={`task/${p.task}`} task={p.task} step={p.step} />;
  if ((p = match("/dev/tasks/:task/snippets/:id", path))) return <Workspace key={`task/${p.task}`} task={p.task} snippet={p.id} />;
  if ((p = match("/dev/tasks/:task/config", path))) return <ConfigPage key={p.task} id={p.task} />;
  if ((p = match("/dev/tasks/:task", path))) return <Workspace key={`task/${p.task}`} task={p.task} />;
  if ((p = match("/dev/snippets/:id", path))) return <Workspace key="snippets" snippet={p.id} />;
  if ((p = match("/dev/assets/:id", path))) return <SamplesPage id={p.id} />;
  if (path === devPaths.assets) return <SamplesPage />;
  if (path === devPaths.pages || path.startsWith(`${devPaths.pages}/`)) return <PagesPage />;
  if (path === devPaths.publish) return <PublishPage />;
  if (redirect(path)) return null;
  return <HomePage />;
}

function NoDraft() {
  const { game, reload } = useDev();
  const [busy, setBusy] = useState(false); const [text, setText] = useState<string | null>(null);
  return (
    <div className={w.card}>
      <div className={w.empty}>这个游戏还没有草稿</div>
      <div style={{ display: "flex", justifyContent: "center", paddingBottom: 24, flexDirection: "column", alignItems: "center", gap: 8 }}>
        <button type="button" className={`${w.btn} ${w.primary}`} disabled={busy} onClick={async () => {
          setBusy(true); setText(null);
          try { await dev.importLatest(game); await reload(); } catch (error) { setText(failure(error)); }
          setBusy(false);
        }}>{busy ? "导入中…" : "从仓库导入"}</button>
        {text && <div className={w.message}>{text}</div>}
      </div>
    </div>
  );
}
