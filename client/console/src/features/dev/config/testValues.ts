import { useCallback, useContext, useMemo, useSyncExternalStore } from "react";
import type { Json, Obj } from "../api";
import { DevContext } from "../context";
import { tasks } from "../model";
import { fallbackValue, shown } from "./fields";

/**
 * 测试值: what a trial runs a task's settings with, apart from the defaults players get. Kept in this browser
 * (localStorage), per draft (the game) and task, and shared by every view: the script's tags, the 配置项 panel, 试跑.
 */

const KEY = (game: string, task: string) => `hgb.dev.testValues.${game}.${task}`;
const listeners = new Set<() => void>();
const cache = new Map<string, { raw: string | null; value: Record<string, Json> }>();
const emit = () => listeners.forEach((l) => l());
if (typeof window !== "undefined") window.addEventListener("storage", (e) => { if (e.key?.startsWith("hgb.dev.testValues.")) emit(); });

function readRaw(key: string): string | null { try { return localStorage.getItem(key); } catch { return null; } }
/** The values set for [task] of [game] (only those set by hand); the same object while they do not change. */
export function storedTestValues(game: string, task: string): Record<string, Json> {
  const key = KEY(game, task);
  const raw = readRaw(key);
  const hit = cache.get(key);
  if (hit && hit.raw === raw) return hit.value;
  let value: Record<string, Json> = {};
  try { const v = raw ? JSON.parse(raw) as unknown : null; if (v && typeof v === "object" && !Array.isArray(v)) value = v as Record<string, Json>; } catch { /* unreadable: none */ }
  cache.set(key, { raw, value });
  return value;
}
/** Replaces the values set for [task] of [game]. */
export function writeTestValues(game: string, task: string, next: Record<string, Json>) {
  const key = KEY(game, task);
  try { if (Object.keys(next).length) localStorage.setItem(key, JSON.stringify(next)); else localStorage.removeItem(key); } catch { /* storage off: kept nowhere */ }
  cache.delete(key); emit();
}
/** A setting's test value follows its new id. */
export function renameTestValue(game: string, task: string, from: string, to: string) {
  const now = storedTestValues(game, task);
  if (!(from in now)) return;
  const next = { ...now, [to]: now[from] }; delete next[from];
  writeTestValues(game, task, next);
}
export function dropTestValue(game: string, task: string, id: string) {
  const now = storedTestValues(game, task);
  if (!(id in now)) return;
  const next = { ...now }; delete next[id];
  writeTestValues(game, task, next);
}

/**
 * The test values of [taskId]: [values] every setting's (set by hand, else its default), [set] puts one (undefined:
 * back to the default). [trial]: what a trial sends as its configuration (the shown settings that have a value);
 * [own]: which were set by hand.
 */
export function useTestValues(taskId: string): { values: Record<string, unknown>; set: (id: string, value: unknown) => void;
  trial: Record<string, Json>; own: Record<string, Json>; reset: () => void } {
  const ctx = useContext(DevContext);
  const game = ctx?.game ?? "";
  const subscribe = useCallback((l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; }, []);
  const own = useSyncExternalStore(subscribe, () => storedTestValues(game, taskId));
  const fields: Obj[] = useMemo(() => ctx?.draft ? tasks(ctx.draft.body).find((t) => t.id === taskId)?.fields ?? [] : [], [ctx?.draft, taskId]);
  const values = useMemo(() => {
    const out: Record<string, Json> = {};
    for (const f of fields) { const id = String(f.id); const v = id in own ? own[id] : fallbackValue(f); if (v !== undefined) out[id] = v; }
    return out;
  }, [fields, own]);
  const trial = useMemo(() => Object.fromEntries(fields.filter((f) => shown(f, values)).map((f) => [String(f.id), values[String(f.id)]])
    .filter(([, v]) => v !== null && v !== undefined)) as Record<string, Json>, [fields, values]);
  const set = useCallback((id: string, value: unknown) => {
    const now = storedTestValues(game, taskId);
    const next = { ...now };
    if (value === undefined) delete next[id]; else next[id] = value as Json;
    writeTestValues(game, taskId, next);
  }, [game, taskId]);
  const reset = useCallback(() => writeTestValues(game, taskId, {}), [game, taskId]);
  return { values, set, trial, own, reset };
}
