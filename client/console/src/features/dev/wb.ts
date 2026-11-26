import type { Device } from "../../api/types";
import { navigate, useQuery } from "../../router";
import { useConsole } from "../../state/context";
import { useDev } from "./context";
import { snippets, str, tasks } from "./model";
import { ownerOfStep } from "./runs";
import type { InsertTarget } from "./sentence";

/** Shared by the 素材 / 页面 / 配置项 / 发布 sections of the v7 workbench: addresses, the current phone, 「插到」, a line diff. */

const enc = encodeURIComponent;
export const wbPaths = {
  assets: "/dev/assets", asset: (id: string) => `/dev/assets/${enc(id)}`, pages: "/dev/pages", publish: "/dev/publish",
  task: (task: string) => `/dev/tasks/${enc(task)}`,
  step: (task: string, step: string) => `/dev/tasks/${enc(task)}/steps/${enc(step)}`,
  config: (task: string) => `/dev/tasks/${enc(task)}/config`,
};

/** The phone chosen in the top bar, shared by the whole workbench; undefined when none is chosen. */
export function useDevice(): Device | undefined {
  const { device } = useDev();
  const { data } = useConsole();
  return device ? data.devices.find((d) => d.id === device) : undefined;
}

/**
 * The line the workspace sent us from (`?task=&step=&line=`), with what it says now (unsaved text first), and how to go
 * back there with a line to put after it or in its place.
 */
export function useInsert(): { name: string; keep: string; target: InsertTarget } | null {
  const q = useQuery();
  const { draft, edits } = useDev();
  const task = q.get("task"), step = q.get("step"), line = q.get("line");
  if (!task || !step || !line || !(Number(line) > 0)) return null;
  const def = draft ? tasks(draft.body).find((t) => t.id === task) : undefined;
  const name = def?.name || task;
  const st = def?.steps.find((x) => String(x.id) === step);
  const owner = st ? ownerOfStep(st) : `step:${step}`;
  const scoped = owner.startsWith("step:") ? `step:${task}/${owner.slice(5)}` : owner;
  const script = edits[scoped] ?? (owner.startsWith("snippet:") ? str(snippets(draft?.body ?? {}).find((x) => String(x.id) === owner.slice(8))?.script) : str(st?.script)) ?? "";
  const n = Number(line);
  const keep = `?task=${enc(task)}&step=${enc(step)}&line=${enc(line)}`;
  const back = (text: string, at: number, replace: boolean) => navigate(`${wbPaths.step(task, step)}?insert=${enc(text)}&line=${at}${replace ? "&replace=1" : ""}`);
  return { name, keep, target: { line: n, lineText: script.split("\n")[n - 1] ?? null, insert: (text, after) => back(text, after, false), replace: (at, text) => back(text, at, true) } };
}

export type DiffLine = { kind: "same" | "add" | "del"; text: string; a?: number; b?: number };
/** Lines of [a] and [b] matched by their longest common subsequence (scripts are short; very long ones are compared whole). */
export function lineDiff(a: string, b: string): DiffLine[] {
  const x = a.split("\n"), y = b.split("\n");
  if (x.length * y.length > 4_000_000) return [...x.map((text, i) => ({ kind: "del" as const, text, a: i + 1 })), ...y.map((text, i) => ({ kind: "add" as const, text, b: i + 1 }))];
  const n = x.length, m = y.length;
  const len: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) len[i][j] = x[i] === y[j] ? len[i + 1][j + 1] + 1 : Math.max(len[i + 1][j], len[i][j + 1]);
  const out: DiffLine[] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (x[i] === y[j]) { out.push({ kind: "same", text: x[i], a: i + 1, b: j + 1 }); i++; j++; }
    else if (len[i + 1][j] >= len[i][j + 1]) { out.push({ kind: "del", text: x[i], a: i + 1 }); i++; }
    else { out.push({ kind: "add", text: y[j], b: j + 1 }); j++; }
  }
  while (i < n) { out.push({ kind: "del", text: x[i], a: i + 1 }); i++; }
  while (j < m) { out.push({ kind: "add", text: y[j], b: j + 1 }); j++; }
  return out;
}
/** Lines changed: an added and a removed line next to each other count once. */
export const changedLines = (diff: DiffLine[]) => {
  const add = diff.filter((d) => d.kind === "add").length, del = diff.filter((d) => d.kind === "del").length;
  return Math.max(add, del);
};
