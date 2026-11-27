import { useContext, useEffect, useState, useSyncExternalStore } from "react";
import { api, ApiFailure } from "../api/client";
import { ConsoleContext } from "./context";
import { dev, type DraftView, type Obj } from "../features/dev/api";
import { nodeDigest, snippets, tasks } from "../features/dev/model";
import { standing } from "../features/dev/HomePage";

/**
 * Whether the signed-in user is a developer (write access to the task repository), as GET /api/dev/me says. Asked once
 * per account in this tab and kept; when GitHub cannot be reached just now ([unknown]) it is asked again a minute later,
 * and until then the answer is no. Only developers see the ways into the workbench (the 开发 group, 开发 ▾, 去改这一步).
 */
interface Asked { developer: boolean; settled: boolean }
const RETRY_MS = 60_000;
const answers = new Map<string, Asked>();
const asking = new Set<string>();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listen) => listen());

function ask(user: string) {
  if (asking.has(user) || answers.get(user)?.settled) return;
  asking.add(user);
  const later = () => window.setTimeout(() => { asking.delete(user); ask(user); }, RETRY_MS);
  api<{ developer?: boolean; unknown?: boolean }>("/api/dev/me").then((me) => {
    if (me?.unknown) { answers.set(user, { developer: false, settled: false }); later(); return; }
    answers.set(user, { developer: me?.developer === true, settled: true }); asking.delete(user);
  }).catch((error) => {
    // Signed out or refused: simply not a developer. Anything else (offline, a deploy): ask again later.
    if (error instanceof ApiFailure && error.status >= 400 && error.status < 500) { answers.set(user, { developer: false, settled: true }); asking.delete(user); }
    else later();
  }).finally(notify);
}

export function useDeveloper(): boolean {
  const user = useContext(ConsoleContext)?.account.userId ?? null;
  useEffect(() => { if (user) ask(user); }, [user]);
  return useSyncExternalStore(
    (listen) => { listeners.add(listen); return () => { listeners.delete(listen); }; },
    () => (user ? answers.get(user)?.developer ?? false : false),
  );
}

/** The game the workbench opens on (its own remembered choice, the same key DevWorkbench reads). */
const GAME_KEY = "wb.game";
export const rememberedGame = (): string | null => { try { return localStorage.getItem(GAME_KEY); } catch { return null; } };

/**
 * [to] (a /dev address) on [game]: the workbench's own addresses do not carry the game, so a link from elsewhere adds
 * ?game=, which the workbench takes (and drops from the address). A plain link, so a new tab or window works too.
 */
export const withGame = (to: string, game: string) => `${to}${to.includes("?") ? "&" : "?"}game=${encodeURIComponent(game)}`;

const seg = encodeURIComponent;
export const workbenchPaths = {
  task: (task: string) => `/dev/tasks/${seg(task)}`,
  config: (task: string) => `/dev/tasks/${seg(task)}/config`,
  step: (task: string, step: string) => `/dev/tasks/${seg(task)}/steps/${seg(step)}`,
  /** Where a run stopped, on the canvas, at the script line when the run said which. */
  fix: (task: string, step: string, line?: number | null) => `/dev/tasks/${seg(task)}/steps/${seg(step)}?view=canvas${line ? `&line=${line}` : ""}`,
};

/** What the sidebar's 开发 group lists: the draft's tasks, the ones with unsaved scripts, and how many tasks changed. */
export interface WorkbenchNow {
  game: string;
  tasks: { id: string; name: string }[];
  /** Every task the draft has or had (its bases): a published task outside these is new in the repository. */
  known: string[];
  /** Tasks with scripts typed but not saved. */
  unsaved: string[];
  changed: number;
  /** The workbench is open but still reading its draft: the group says 读取中 rather than reading one of its own. */
  loading?: boolean;
}
let bench: WorkbenchNow | null = null;
const benchListeners = new Set<() => void>();
/** The workbench, while open, says what it has (loading while it reads its draft); null only when it closes. */
export function publishWorkbench(now: WorkbenchNow | null) {
  if (now === null && bench && !bench.loading) remembered = { ...bench, unsaved: [] };
  bench = now; benchListeners.forEach((listen) => listen());
}
const useBench = () => useSyncExternalStore((listen) => { benchListeners.add(listen); return () => { benchListeners.delete(listen); }; }, () => bench);

/** The last list read (or the workbench's last), shown while a fresh one is read. */
let remembered: WorkbenchNow | null = null;

/** Tasks changed since the draft's base, as the workbench's 发布 counts them (a trial does not matter here). */
export async function changedTasks(view: DraftView): Promise<number> {
  const body: Obj = view.body;
  const pairs = await Promise.all([
    ...tasks(body).map(async (t) => [`tasks/${t.id}`, await nodeDigest(t.raw)] as const),
    ...snippets(body).map(async (sn) => [`snippets/${String(sn.id)}`, await nodeDigest(sn)] as const),
  ]);
  const digests = Object.fromEntries(pairs);
  return tasks(body).filter((t) => standing(t, body, view.bases, digests, undefined, []).changed).length;
}

/** Every task id [view] has, or had when imported. */
export const knownTasks = (view: DraftView): string[] =>
  [...tasks(view.body).map((t) => t.id), ...Object.keys(view.bases).filter((k) => k.startsWith("tasks/")).map((k) => k.slice(6))];

/**
 * The 开发 group's list: the open workbench's when there is one, else read from the server — only when [wanted] (a
 * developer with the group open), and again each time the workbench closes.
 */
export function useWorkbenchMenu(wanted: boolean): (WorkbenchNow & { repoOnly: { id: string; name: string }[] }) | null {
  const live = useBench();
  const games = useContext(ConsoleContext)?.data.games;
  const [read, setRead] = useState<WorkbenchNow | null>(remembered);
  useEffect(() => {
    if (!wanted || live) return;
    let current = true;
    (async () => {
      try {
        const list = await dev.drafts();
        const kept = rememberedGame();
        const game = kept && list.some((d) => d.target === kept) ? kept : list[0]?.target;
        if (!game) { if (current) setRead(null); return; }
        const view = await dev.draft(game);
        const changed = await changedTasks(view);
        const now: WorkbenchNow = { game, tasks: tasks(view.body).map((t) => ({ id: t.id, name: t.name })), known: knownTasks(view), unsaved: [], changed };
        remembered = now;
        if (current) setRead(now);
      } catch { /* the group shows its plain links */ }
    })();
    return () => { current = false; };
  }, [wanted, live]);
  const now = live ?? (wanted ? read : null);
  if (!now) return null;
  const known = new Set(now.known);
  const published = games?.find((g) => g.id === now.game)?.tasks ?? [];
  return { ...now, repoOnly: published.filter((t) => !known.has(t.taskId)).map((t) => ({ id: t.taskId, name: t.name })) };
}
