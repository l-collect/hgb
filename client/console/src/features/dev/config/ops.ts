import { useCallback } from "react";
import { ask } from "../../../components/Confirm";
import type { DraftPatch, Json, Obj } from "../api";
import { useDev } from "../context";
import { isObj, nodeDigest, objs, str, tasks } from "../model";
import { fallbackValue, typeName, valueText } from "./fields";
import { dropTestValue, renameTestValue, storedTestValues, writeTestValues } from "./testValues";
import { addCaseInScript, fieldUses, inlineInScript, renameInScript, renameValueInScript, snippetBlock, tests, usesCount, usesText, withEdits } from "./uses";

/**
 * Writing 配置项 into the draft, the patch way the rest of the workbench writes (useDev().apply): a new one is
 * inserted, a change puts the field; a new id or a delete puts the whole task, so the field and every script that
 * reads it change in one batch. Unsaved script texts of the task are rewritten the same way and stay unsaved.
 */
export function useFieldOps(taskId: string) {
  const { draft, apply, edits, setEdit, game } = useDev();

  /** The task's unsaved scripts rewritten by [rewrite] ([body]: the draft before, whose scripts were rewritten the same way). */
  const rewriteEdits = useCallback((body: Obj, rewrite: (text: string) => string) => {
    const prefix = `step:${taskId}/`;
    const task = tasks(body).find((t) => t.id === taskId);
    for (const [key, text] of Object.entries(edits)) {
      if (!key.startsWith(prefix)) continue;
      const step = task?.steps.find((s) => String(s.id) === key.slice(prefix.length));
      const was = str(step?.script);
      const saved = was === undefined ? undefined : rewrite(was);
      const next = rewrite(text);
      // The base becomes the draft's new text, so this is not taken for a change made elsewhere.
      setEdit(key, undefined, undefined);
      if (next !== saved) setEdit(key, next, saved);
    }
  }, [edits, setEdit, taskId]);

  /** Inserts [field] after the task's last one (or [after]); a problem in words, or null. */
  const create = useCallback(async (field: Obj, after?: string | null): Promise<string | null> => apply(async (body) => {
    const task = tasks(body).find((t) => t.id === taskId);
    if (!task) return [];
    const last = after !== undefined ? after : task.fields.length ? String(task.fields.at(-1)!.id) : null;
    return [{ op: "insert", path: `tasks:${taskId}`, field: "fields", after: last, value: field }];
  }), [apply, taskId]);

  /** The task put whole after [change]; [] when nothing changed. */
  const putTask = async (body: Obj, change: (task: Obj) => Obj): Promise<DraftPatch[]> => {
    const raw = objs(body.tasks).find((t) => t.id === taskId);
    if (!raw) return [];
    const next = change(raw);
    return JSON.stringify(next) === JSON.stringify(raw) ? [] : [{ op: "put", path: `tasks:${taskId}`, expect: await nodeDigest(raw), value: next }];
  };
  /**
   * The task with the field [from] replaced by [next] (id [to]) and every place that names it following: field
   * conditions, run conditions, the trigger, the step scripts; [values] (old option value → new) renamed in the
   * conditions and in the value lines under `按设置`.
   */
  const renamed = (task: Obj, from: string, to: string, next: Obj, values: Record<string, string>): Obj => {
    const cond = (c: Json | undefined): Obj => {
      const o: Obj = { ...(c as Obj), field: to };
      for (const key of ["equals", "contains"]) if (typeof o[key] === "string" && values[o[key] as string] !== undefined) o[key] = values[o[key] as string];
      return o;
    };
    return {
      ...task,
      fields: objs(task.fields).map((f) => f.id === from ? next : tests(f.visibleWhen, from) ? { ...f, visibleWhen: cond(f.visibleWhen) } : f),
      steps: objs(task.steps).map((st) => {
        let out = st;
        if (typeof st.script === "string" && !str(st.use)) out = { ...out, script: rewrite(st.script, from, to, values) };
        if (tests(st.when, from)) out = { ...out, when: cond(st.when) };
        return out;
      }),
      ...(isObj(task.trigger) && task.trigger.enabledBy === from ? { trigger: { ...task.trigger, enabledBy: to } } : {}),
    };
  };
  const rewrite = (text: string, from: string, to: string, values: Record<string, string>) =>
    Object.entries(values).reduce((t, [a, b]) => renameValueInScript(t, to, a, b), renameInScript(text, from, to));

  /**
   * Saves [next] over the field [oldId]: put when nothing else changes, else the task with every reference renamed —
   * a new id, and [values] (old option value → new value) in the 按设置 value lines and conditions; test values follow.
   * Refused (a problem in words) when a snippet reads the field and its id or values change. Null when saved.
   */
  const save = useCallback(async (oldId: string, next: Obj, values: Record<string, string> = {}): Promise<string | null> => {
    const to = String(next.id);
    const moved = Object.fromEntries(Object.entries(values).filter(([a, b]) => a !== b));
    if (to === oldId && !Object.keys(moved).length) return apply(async (body) => {
      const now = tasks(body).find((t) => t.id === taskId)?.fields.find((f) => f.id === oldId);
      if (!now) return [];
      return JSON.stringify(now) === JSON.stringify(next) ? [] : [{ op: "put", path: `tasks:${taskId}/fields:${oldId}`, expect: await nodeDigest(now), value: next }];
    });
    const blocked = draft ? snippetBlock(fieldUses(withEdits(draft.body, taskId, edits), taskId, oldId), to !== oldId ? "改编号" : "改选项的值") : null;
    if (blocked) return blocked;
    const problem = await apply((body) => putTask(body, (task) => renamed(task, oldId, to, next, moved)));
    if (problem) return problem;
    if (to !== oldId) renameTestValue(game, taskId, oldId, to);
    const tv = storedTestValues(game, taskId)[to];
    if (tv !== undefined && Object.keys(moved).length) {
      const map = (x: Json) => typeof x === "string" && moved[x] !== undefined ? moved[x] : x;
      writeTestValues(game, taskId, { ...storedTestValues(game, taskId), [to]: Array.isArray(tv) ? tv.map(map) : map(tv) });
    }
    rewriteEdits(draft?.body ?? {}, (text) => rewrite(text, oldId, to, moved));
    return null;
  }, [apply, taskId, game, rewriteEdits, draft, edits]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Renames the field [from] to [to] everywhere, keeping the rest of it. */
  const rename = useCallback(async (from: string, to: string): Promise<string | null> => {
    const f = draft ? tasks(draft.body).find((t) => t.id === taskId)?.fields.find((x) => x.id === from) : undefined;
    if (!f) return "没有这个配置项";
    return save(from, { ...f, id: to });
  }, [draft, taskId, save]);

  /**
   * Deletes the field [fid] after asking, with the lines that read it: there its default is written in (a number), or
   * the branch its default takes stays (按设置). True when deleted; a problem in words when it could not be.
   */
  const remove = useCallback(async (fid: string): Promise<true | false | string> => {
    if (!draft) return false;
    const body = withEdits(draft.body, taskId, edits);
    const f = tasks(body).find((t) => t.id === taskId)?.fields.find((x) => x.id === fid);
    if (!f) return false;
    const uses = fieldUses(body, taskId, fid);
    const blocked = snippetBlock(uses, "删除");
    if (blocked) { await ask({ title: `「${str(f.label) ?? fid}」还不能删`, body: blocked, ok: "知道了", cancel: "关闭" }); return false; }
    const fallback = fallbackValue(f);
    const label = str(f.label) ?? fid;
    const yes = await ask({
      title: `删除配置项「${label}」？`,
      body: uses.length
        ? `用在 ${usesCount(uses)}：${usesText(body, taskId, uses)}。删除后这些地方写回默认 ${valueText(f, fallback)}${f.widget === "SWITCH" || f.widget === "SINGLE_CHOICE" ? "（按设置只留默认那一支）" : ""}。`
        : `没有脚本读它。${typeName(f.widget)}，默认 ${valueText(f, fallback)}。`,
      ok: "删除", danger: true,
    });
    if (!yes) return false;
    const inline = (text: string) => inlineInScript(text, f, fallback as Json | undefined).script;
    const problem = await apply((b) => putTask(b, (task) => ({
      ...task,
      fields: objs(task.fields).filter((x) => x.id !== fid).map((x) => { if (!tests(x.visibleWhen, fid)) return x; const y = { ...x }; delete y.visibleWhen; return y; }),
      steps: objs(task.steps).map((st) => {
        let out = st;
        if (typeof st.script === "string" && !str(st.use)) out = { ...out, script: inline(st.script) };
        if (tests(st.when, fid)) { out = { ...out }; delete out.when; }
        return out;
      }),
      ...(isObj(task.trigger) && task.trigger.enabledBy === fid ? { trigger: (() => { const t = { ...(task.trigger as Obj) }; delete t.enabledBy; return t; })() } : {}),
    })));
    if (problem) return problem;
    dropTestValue(game, taskId, fid);
    rewriteEdits(draft.body, inline);
    return true;
  }, [draft, edits, apply, taskId, game, rewriteEdits]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * 补一支: a value line for [value] (with a `# [label] 时做什么` placeholder) added to each `按设置` on [field] in the
   * task's own step scripts that does not handle it, saved scripts and unsaved texts alike. A problem in words, or null.
   */
  const addCase = useCallback(async (field: Obj, value: Json, label: string): Promise<string | null> => {
    if (!draft) return "草稿还没载入";
    const add = (text: string) => addCaseInScript(text, field, value, label).script;
    const unsaved = Object.entries(edits).some(([key, text]) => key.startsWith(`step:${taskId}/`) && add(text) !== text);
    const problem = await apply((b) => putTask(b, (task) => ({
      ...task,
      steps: objs(task.steps).map((st) => typeof st.script === "string" && !str(st.use) ? { ...st, script: add(st.script) } : st),
    })));
    if (problem) return problem;
    const saved = (tasks(draft.body).find((t) => t.id === taskId)?.steps ?? []).some((st) => typeof st.script === "string" && !str(st.use) && add(st.script) !== st.script);
    if (!saved && !unsaved) return "没写的那一支在片段里，去片段里补";
    rewriteEdits(draft.body, add);
    return null;
  }, [draft, edits, apply, taskId, rewriteEdits]); // eslint-disable-line react-hooks/exhaustive-deps

  return { create, save, rename, remove, addCase };
}
