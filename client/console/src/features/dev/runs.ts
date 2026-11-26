import type { DevRun, DevTrace, Json, Obj } from "./api";
import { objs, str, type TaskDef } from "./model";

/** A trial's run, read against the script it ran: which lines ran, where it stopped and why. */

export const ok = (result: string) => ["PRODUCED", "VERIFIED", "COMPLETED"].includes(result);
/** The task reported itself completed; a run that merely ended did not pass. */
export const completed = (run: DevRun) => run.state === "FINISHED" && run.facts.some((f) => f.type === "task-completed");
export const running = (run: DevRun | null) => run?.state === "SENT" || run?.state === "RUNNING";

/** The script a step or snippet is edited as: "step:<id>" (its own script) or "snippet:<id>". */
export type OwnerKey = string;
export const stepKey = (id: string) => `step:${id}`;
export const snippetKey = (id: string) => `snippet:${id}`;
/** Where one step's script lives: its own, or the snippet it uses whole. */
export const ownerOfStep = (step: Obj): OwnerKey => str(step.use) ? snippetKey(str(step.use)!) : stepKey(String(step.id));

/**
 * Where an action came from, outermost first: L83.L4 is line 4 of the snippet that line 83 calls (用 …); L3w~lost.L1p
 * ran in an interruption page met on line 3, said as line 3. Unrolled lines (L24_1_1f) are their line.
 */
export function placeOf(trace: DevTrace, task: TaskDef, scriptOf: (key: OwnerKey) => string | undefined): { key: OwnerKey; line: number }[] {
  const step = task.steps.find((st) => st.id === trace.step);
  if (!step) return [];
  let key = ownerOfStep(step);
  const out: { key: OwnerKey; line: number }[] = [];
  for (const part of trace.action.split(".")) {
    const m = /^L(\d+)/.exec(part);
    if (!m) break;
    const line = Number(m[1]);
    out.push({ key, line });
    if (part.includes("~")) break;
    const called = /^\s*用\s+([^\s#]+)/.exec((scriptOf(key) ?? "").split("\n")[line - 1] ?? "");
    if (!called) break;
    key = snippetKey(called[1]);
  }
  return out;
}

/** The action a failed run stopped on: its last one that did not succeed. */
export function failedAt(run: DevRun | null): number {
  if (!run || running(run) || completed(run)) return -1;
  for (let i = run.traces.length - 1; i >= 0; i--) if (!ok(run.traces[i].result)) return i;
  return -1;
}

/**
 * A reason in plain words: "等待 8000ms 后仍未确认任何声明的页面状态（ok：缺「当前存储」（读到0处文字）；interruption:…）"
 * becomes "8 秒没等到：缺「当前存储」"; interruption pages and the default state's name are left out.
 */
export function plain(reason: string | undefined): string {
  if (!reason) return "没成";
  const m = /^等待 (\d+)ms 后仍未确认任何声明的页面状态（(.*)）$/s.exec(reason);
  if (!m) return reason;
  const seconds = Math.round(Number(m[1]) / 1000);
  if (m[2].startsWith("多个状态同时成立")) return `${seconds} 秒内${m[2]}`;
  const parts = m[2].split("；").filter((x) => !x.startsWith("interruption:")).map((x) => x.replace(/^ok：/, "").replace(/（读到\d+处文字）/g, ""));
  return `${seconds} 秒没等到：${parts.join("；") || m[2]}`;
}

/** The regions a failed wait looked in and missed, to draw on the screen it stopped on. */
export function missed(trace: Obj | undefined): number[][] {
  if (!trace || !Array.isArray(trace.conditions)) return [];
  return objs(trace.conditions).filter((c) => c.pass === false && !String(c.state ?? "").startsWith("interruption:") && Array.isArray(c.within))
    .map((c) => (c.within as Json[]).map(Number));
}

/** Test values to run with: the recommended ones, then each choice of a single-choice setting changed from them (named by that one change). */
export function testValues(fields: Obj[]): [string, Obj][] {
  if (!fields.length) return [["无配置项", {}]];
  const value = (f: Obj): Json => f.recommended ?? f.default ?? (f.widget === "SWITCH" ? false : objs(f.options)[0]?.value ?? null);
  const base: Obj = Object.fromEntries(fields.map((f) => [String(f.id), value(f)]));
  const list: [string, Obj][] = [["推荐值", base]];
  for (const f of fields) for (const opt of objs(f.options)) {
    if (opt.value === base[String(f.id)]) continue;
    list.push([`${str(f.label) ?? f.id}=${str(opt.label) ?? JSON.stringify(opt.value)}`, { ...base, [String(f.id)]: opt.value ?? null }]);
  }
  return list;
}

/** A failed condition of a wait, to draw on the screen it stopped on: where (screen or reference pixels) and what it scored. */
export interface MissBox { box: number[]; screen: boolean; label: string }
export function missBoxes(trace: Obj | undefined): MissBox[] {
  if (!trace || !Array.isArray(trace.conditions)) return [];
  return objs(trace.conditions).filter((c) => c.pass === false && !String(c.state ?? "").startsWith("interruption:")).flatMap((c) => {
    const screen = Array.isArray(c.screenBox) && c.screenBox.length === 4;
    const box = (screen ? c.screenBox as Json[] : Array.isArray(c.within) ? c.within as Json[] : []).map(Number);
    if (box.length !== 4) return [];
    const what = str(c.expect) ?? "";
    return [{ box, screen, label: typeof c.score === "number" ? `${what} · ${c.score.toFixed(2)}` : what }];
  });
}

/**
 * Why a line failed, in one line, from what the phone traced: "8 秒没等到「准备」· 最高分 0.61（要 0.80）· 色差 30（容差 24）· why".
 * Falls back to the reason in plain words.
 */
export function failReason(trace: Obj | undefined, reason: string | undefined): string {
  if (!trace) return plain(reason);
  const conds = objs(trace.conditions).filter((c) => !String(c.state ?? "").startsWith("interruption:"));
  const missedOnes = conds.filter((c) => c.pass === false || c.pass === undefined);
  const parts: string[] = [];
  const waited = typeof trace.waitedMs === "number" ? Math.round(trace.waitedMs / 1000) : null;
  const named = [...new Set(missedOnes.map((c) => str(c.expect)).filter((x): x is string => !!x))].slice(0, 2);
  if (waited !== null) parts.push(named.length ? `${waited} 秒没等到「${named.join("」「")}」` : `${waited} 秒没等到`);
  const images = missedOnes.filter((c) => typeof c.score === "number" && typeof c.minimum === "number");
  if (images.length) {
    const best = images.reduce((a, b) => (Number(a.score) >= Number(b.score) ? a : b));
    parts.push(`最高分 ${Number(best.score).toFixed(2)}（要 ${Number(best.minimum).toFixed(2)}）`);
  }
  const colors = missedOnes.filter((c) => typeof c.worst === "number" && c.kind === "color");
  if (colors.length) {
    const best = colors.reduce((a, b) => (Number(a.worst) <= Number(b.worst) ? a : b));
    parts.push(`色差 ${best.worst}（容差 ${best.tolerance ?? 24}）`);
  }
  const why = str(trace.why)?.split(/[；\n]/)[0]?.trim();
  if (why) parts.push(why.length > 40 ? `${why.slice(0, 40)}…` : why);
  return parts.length ? parts.join(" · ") : plain(reason);
}

/** [text] with [insert] as new lines after line [after] (0 = at the top), indented as that line is. */
export function insertAfter(text: string, after: number, insert: string): string {
  const lines = text.split("\n");
  const at = Math.max(0, Math.min(after, lines.length));
  const indent = /^\s*/.exec(lines[at - 1] ?? "")?.[0] ?? "";
  lines.splice(at, 0, ...insert.split("\n").map((l) => indent + l));
  return lines.join("\n");
}
