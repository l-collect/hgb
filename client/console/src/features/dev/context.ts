import { createContext, useContext } from "react";
import { ApiFailure } from "../../api/client";
import type { Capability, DevMe, DraftPatch, DraftView, Obj, TrialRecord } from "./api";

/** Patches, or a function making them from the latest draft (when an edit must build on the one before it). */
export type Edit = DraftPatch[] | ((body: Obj) => DraftPatch[] | Promise<DraftPatch[]>);

/** What every workbench page shares: the game, its draft, the action catalog and who is writing. */
export interface DevContextValue {
  game: string; gameName: string; draft: DraftView | null; catalog: Capability[]; me: DevMe | null;
  /** Each task's newest trial, and the current node digest of every task and snippet (`tasks/<id>`, `snippets/<id>`). */
  trials: TrialRecord[]; digests: Record<string, string>; reloadTrials: () => Promise<void>;
  reload: () => Promise<void>; apply: (edit: Edit) => Promise<string | null>;
  syncRepo: () => Promise<string | null>;
  /** Scripts typed but not saved, by script ("step:<task>/<id>" or "snippet:<id>"): kept while moving around the workbench. */
  edits: Record<string, string>; setEdits: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  /** The phone every page uses (trials, samples, judging, the live screen), chosen once in the top bar; null when there is none. */
  device: string | null; setDevice: (id: string) => void;
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
export const failure = (error: unknown) => error instanceof ApiFailure ? error.message : "操作失败，请稍后再试";
