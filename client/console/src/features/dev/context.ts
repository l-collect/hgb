import { createContext, useContext } from "react";
import { ApiFailure } from "../../api/client";
import type { Capability, DevMe, DraftPatch, DraftView, Obj, PatchConflict, SyncResult, TrialRecord } from "./api";

/** Patches, or a function making them from the latest draft (when an edit must build on the one before it). */
export type Edit = DraftPatch[] | ((body: Obj) => DraftPatch[] | Promise<DraftPatch[]>);

/** What every workbench page shares: the game, its draft, the action catalog and who is writing. */
export interface DevContextValue {
  game: string; gameName: string; draft: DraftView | null; catalog: Capability[]; me: DevMe | null;
  /** Each task's newest trial, and the current node digest of every task and snippet (`tasks/<id>`, `snippets/<id>`). */
  trials: TrialRecord[]; digests: Record<string, string>; reloadTrials: () => Promise<void>;
  reload: () => Promise<void>; apply: (edit: Edit) => Promise<string | null>;
  /** 从仓库同步, keeping what was changed here; unsaved text is dropped. The problem in words, or what it kept. */
  syncRepo: () => Promise<{ problem: string | null; result: SyncResult | null }>;
  /** Puts a snapshot back as the draft (unsaved text is dropped); a problem in words, or null. */
  restoreSnapshot: (id: string) => Promise<string | null>;
  /** Scripts typed but not saved, by script ("step:<task>/<id>" or "snippet:<id>"): kept while moving around the workbench. */
  edits: Record<string, string>; setEdits: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  /** Puts (or, undefined, drops) the unsaved text of a script; the first edit remembers the saved text it started from. */
  setEdit: (key: string, text: string | undefined, saved: string | undefined) => void;
  /** The saved text each unsaved script started from: when the draft's differs, someone changed it meanwhile. */
  editBases: Record<string, string>;
  /** Scripts changed elsewhere while being edited here ([editBases] against the draft). */
  conflicts: string[];
  /** Saves one script's unsaved text; [force] saves it over a change made elsewhere. A problem in words, or null. */
  saveScript: (key: string, force?: boolean) => Promise<string | null>;
  /** The phone every page uses (trials, samples, judging, the live screen), chosen once in the top bar; null when there is none. */
  device: string | null; setDevice: (id: string) => void;
  /** A batch the server refused with both sides of each node, waiting for 用我的 / 用别处的 ([resolveRefused]). */
  refused: PatchConflict[] | null; resolveRefused: (mine: boolean) => Promise<string | null>;
  /** The whole draft's last check (发布's): false when it did not pass, null before one; the top bar marks it. */
  checkFailed: boolean | null; setCheckFailed: (failed: boolean | null) => void;
}
export const DevContext = createContext<DevContextValue | null>(null);
export const useDev = () => { const value = useContext(DevContext); if (!value) throw new Error("useDev outside the workbench"); return value; };
/** The same, by the name the other pages use. */
export const useWb = useDev;
export const devPaths = {
  home: "/dev", task: (id: string) => `/dev/tasks/${encodeURIComponent(id)}`,
  step: (task: string, step: string) => `/dev/tasks/${encodeURIComponent(task)}/steps/${encodeURIComponent(step)}`,
  snippet: (id: string) => `/dev/snippets/${encodeURIComponent(id)}`,
  taskSnippet: (task: string, id: string) => `/dev/tasks/${encodeURIComponent(task)}/snippets/${encodeURIComponent(id)}`,
  blocks: (task: string, step: string) => `/dev/tasks/${encodeURIComponent(task)}/steps/${encodeURIComponent(step)}/blocks`,
  snippetBlocks: (id: string) => `/dev/snippets/${encodeURIComponent(id)}/blocks`,
  config: (task: string) => `/dev/tasks/${encodeURIComponent(task)}/config`,
  assets: "/dev/assets", asset: (id: string) => `/dev/assets/${encodeURIComponent(id)}`, pages: "/dev/pages", publish: "/dev/publish",
  /** Old names of the same places (样本库, 游戏设置, 状态库), kept so every link still lands. */
  samples: "/dev/assets", sample: (id: string) => `/dev/assets/${encodeURIComponent(id)}`, states: "/dev/pages", game: "/dev/pages",
};
/** What a refused patch batch says: 409 is the server's "a node changed since you read it". */
export const CONFLICT = "别处改过了，已重新读取";
/** The same, when the server sent both sides: the workbench shows them to choose from. */
export const PATCH_CONFLICT = "别处改过了，先选用哪边";
/** A script save held back: it changed elsewhere since editing began here. */
export const EDIT_CONFLICT = "别处改过这段脚本，先选用哪边";
/** The address of an unsaved script's key ("step:<task>/<step>" or "snippet:<id>"). */
export function scriptPath(key: string): string {
  if (key.startsWith("snippet:")) return devPaths.snippet(key.slice(8));
  const [task, step] = key.slice(5).split("/");
  return devPaths.step(task, step ?? "");
}
export const failure = (error: unknown) => error instanceof ApiFailure ? error.message : "操作失败，请稍后再试";
