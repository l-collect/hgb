import type { Json, Obj } from "./api";
import { arr, childrenOf, isObj, objs, programOf, snippets, str, tasks } from "./model";

/** The states of the 页面 section: page waits with their candidates, and a state's conditions in words. */

export interface Wait { key: string; label: string; states: Obj[] }

/** Every page wait in the draft with its candidate states, labelled by where it is (when the server's list is not to hand). */
export function pageWaits(body: Obj): Wait[] {
  const found: Wait[] = [];
  const walk = (program: Obj[], where: string) => program.forEach((node) => {
    const a = isObj(node.action) ? node.action : null;
    if (a?.capability === "screen.awaitScreen" && isObj(a.inputs)) {
      const list = objs(a.inputs.states);
      if (list.length) found.push({ key: `${where}/${str(a.id)}`, label: `${where} · ${str(a.id)}`, states: list });
    }
    childrenOf(node).forEach(([, child]) => walk(child, where));
  });
  for (const t of tasks(body)) for (const s of t.steps) walk(programOf(s), `${t.name}·${str(s.name) ?? str(s.id)}`);
  for (const sn of snippets(body)) walk(programOf(sn), `片段 ${str(sn.id)}`);
  return found;
}

/** The id a wait's candidate reports: its `as`, else its own id, else the library state it names (ServerJudge.entryId). */
export function entryId(entry: Json): string | null {
  if (typeof entry === "string") return entry;
  if (isObj(entry)) return str(entry.as) ?? str(entry.id) ?? str(entry.state) ?? null;
  return null;
}

/** A state's conditions as [kind, tone, label]. */
export function conditionsOf(s: Obj): [string, string, string][] {
  const label = (c: Json) => typeof c === "string" ? `「${c}」` : isObj(c) ? (str(c.text) ? `「${str(c.text)}」` : str(c.template) ?? str(c.set) ?? JSON.stringify(c).slice(0, 40)) : String(c);
  return [
    ...arr(s.text).map((c): [string, string, string] => ["有", "has", `字${label(c)}`]),
    ...arr(s.present).map((c): [string, string, string] => ["有", "has", `图 ${label(c)}`]),
    ...arr(s.colors).map((c): [string, string, string] => ["有", "has", `色 ${label(c)}`]),
    ...arr(s.absentText).map((c): [string, string, string] => ["没有", "not", `字${label(c)}`]),
    ...arr(s.absent).map((c): [string, string, string] => ["没有", "not", `图 ${label(c)}`]),
    ...arr(s.absentColors).map((c): [string, string, string] => ["没有", "not", `色 ${label(c)}`]),
  ];
}

/** A state or page's recognition in one line. */
export function recognitionLine(state: Json | undefined, known: Obj[]): string {
  if (typeof state === "string") {
    const s = known.find((x) => x.id === state);
    return s ? `状态 ${str(s.name) ?? state}：${conditionsOf(s).map(([k, , l]) => k === "有" ? l : `没有${l}`).join("  且  ") || "—"}` : `状态 ${state}`;
  }
  if (!isObj(state)) return "—";
  const base = str(state.state) ? `基于 ${str(state.state)}  且  ` : "";
  return base + (conditionsOf(state).map(([k, , l]) => k === "有" ? l : `没有${l}`).join("  且  ") || "—");
}

export const ratio = (a: number, b: number) => { const g = (x: number, y: number): number => y ? g(y, x % y) : x; const d = g(a, b); return `${a / d}:${b / d}`; };
