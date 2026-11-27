import type { Json, Obj } from "../api";
import { isObj, objs, str, tasks } from "../model";
import { caseValue, readsOf, stripComment, type SettingRead } from "../settingUse";

/**
 * Where a task's scripts read a setting, and the two rewrites a setting's id needs: renaming it everywhere ({x},
 * {x|n}, 按设置 x), and putting its default back where it was read (when it is deleted).
 */

/** A line reading a setting: in a step's own script, or (with [snippet]) in a snippet that step runs or calls. */
export interface FieldUse { stepId: string; line: number; snippet?: string }

/**
 * Every line of [taskId]'s steps that reads [fieldId] ({x}, {x|n} or 按设置 x), by step and line (1-based): the step's
 * own script, and the snippets it runs (用 on the step) or calls (`用 片段` lines), each snippet line once.
 */
export function fieldUses(body: Obj, taskId: string, fieldId: string): FieldUse[] {
  const task = tasks(body).find((t) => t.id === taskId);
  if (!task) return [];
  const lib = objs(body.snippets);
  const out: FieldUse[] = [];
  const seen = new Set<string>();
  const scan = (script: string, stepId: string, snippet: string | undefined, visited: Set<string>) => {
    const { reads, calls } = readsOf(script);
    for (const r of reads) {
      if (r.field !== fieldId) continue;
      const key = `${snippet ? `snippet:${snippet}` : `step:${stepId}`}#${r.line}`;
      if (seen.has(key)) continue;
      seen.add(key); out.push({ stepId, line: r.line, ...(snippet ? { snippet } : {}) });
    }
    for (const c of calls) {
      if (visited.has(c.snippet)) continue;
      visited.add(c.snippet);
      const sn = str(lib.find((x) => x.id === c.snippet)?.script);
      if (sn !== undefined) scan(sn, stepId, c.snippet, visited);
    }
  };
  for (const st of task.steps) {
    const use = str(st.use);
    const script = use ? str(lib.find((x) => x.id === use)?.script) : str(st.script);
    if (script !== undefined) scan(script, String(st.id), use, new Set(use ? [use] : []));
  }
  return out;
}
/** 「步骤 2 L6、片段 pick-team L3」 for [uses]. */
export function usesText(body: Obj, taskId: string, uses: FieldUse[], most = 4): string {
  const steps = tasks(body).find((t) => t.id === taskId)?.steps ?? [];
  const at = (u: FieldUse) => u.snippet ? `片段 ${u.snippet} L${u.line}` : `步骤 ${steps.findIndex((s) => s.id === u.stepId) + 1} L${u.line}`;
  return uses.slice(0, most).map(at).join("、") + (uses.length > most ? ` 等 ${uses.length} 处` : "");
}
/** 「共 3 处，其中片段 1 处」: the count with the snippets' share said apart. */
export function usesCount(uses: FieldUse[]): string {
  const inSnippets = uses.filter((u) => u.snippet).length;
  return `${uses.length} 处${inSnippets ? `（片段 ${inSnippets} 处）` : ""}`;
}
/**
 * Why [what] (改编号 / 删除 / 改选项值) cannot be done here: a snippet reads the setting, and snippets are shared by
 * several tasks, so it is changed there first. Null when no snippet reads it.
 */
export function snippetBlock(uses: FieldUse[], what: string): string | null {
  const list = uses.filter((u) => u.snippet);
  if (!list.length) return null;
  const by = new Map<string, number[]>();
  for (const u of list) by.set(u.snippet!, [...(by.get(u.snippet!) ?? []), u.line]);
  const where = [...by].map(([sn, lines]) => `片段 ${sn} 第 ${lines.join("、")} 行`).join("，");
  return `${where}也用到它。片段多个任务共用，没法在这里${what}，请先去片段里改`;
}

/** [body] with the unsaved texts in [edits] ("step:<task>/<step>") put in place of their steps' scripts. */
export function withEdits(body: Obj, taskId: string, edits: Record<string, string>): Obj {
  const prefix = `step:${taskId}/`;
  const mine = Object.entries(edits).filter(([k]) => k.startsWith(prefix));
  if (!mine.length) return body;
  return { ...body, tasks: objs(body.tasks).map((t) => t.id !== taskId ? t : { ...t, steps: objs(t.steps).map((st) => {
    const text = edits[prefix + String(st.id)];
    return text === undefined || str(st.use) ? st : { ...st, script: text };
  }) }) };
}

/** [script] with every read of [from] written as [to]: {from} → {to}, {from|3} → {to|3}, 按设置 from → 按设置 to. */
export function renameInScript(script: string, from: string, to: string): string {
  const reads = readsOf(script).reads.filter((r) => r.field === from);
  if (!reads.length) return script;
  const lines = script.split("\n");
  // From the line's end, so the columns before stay right.
  const byLine = new Map<number, SettingRead[]>();
  for (const r of reads) byLine.set(r.line, [...(byLine.get(r.line) ?? []), r]);
  for (const [line, rs] of byLine) {
    let text = lines[line - 1];
    for (const r of [...rs].sort((a, b) => b.col - a.col)) text = text.slice(0, r.col) + to + text.slice(r.col + r.len);
    lines[line - 1] = text;
  }
  return lines.join("\n");
}

const indentOf = (s: string) => s.length - s.trimStart().length;
/** A line with nothing but a comment counts as blank, as the engine reads the tree. */
const blank = (s: string) => !stripComment(s).trim();

/**
 * [script] with [field]'s reads replaced by fixed values, as when the setting is deleted: each {x} by its `|n` or
 * [fallback], each `按设置 x` by the lines of the branch the default takes (its own value, else 其他), moved out one
 * level; a branch with no such line goes. [left]: the {x} with no number to put there (kept as they are).
 */
export function inlineInScript(script: string, field: Obj, fallback: Json | undefined): { script: string; left: number } {
  const fid = String(field.id);
  const reads = readsOf(script).reads.filter((r) => r.field === fid);
  if (!reads.length) return { script, left: 0 };
  let lines = script.split("\n");
  let left = 0;
  // Numbers first (they keep the line count), from the end of each line.
  const numbers = reads.filter((r): r is Extract<SettingRead, { kind: "number" }> => r.kind === "number").sort((a, b) => b.line - a.line || b.col - a.col);
  for (const r of numbers) {
    const text = lines[r.line - 1];
    const open = text.lastIndexOf("{", r.col), close = text.indexOf("}", r.col);
    const value = r.fallback ?? (typeof fallback === "number" || typeof fallback === "string" ? String(fallback) : null);
    if (open < 0 || close < 0 || value === null || !/^-?\d+(\.\d+)?$/.test(value)) { left++; continue; }
    lines[r.line - 1] = text.slice(0, open) + value + text.slice(close + 1);
  }
  // Branches from the last one up, so the line numbers above stay right.
  const branches = reads.filter((r): r is Extract<SettingRead, { kind: "branch" }> => r.kind === "branch").sort((a, b) => b.line - a.line);
  for (const b of branches) {
    const head = b.line - 1;
    const base = indentOf(lines[head]);
    let end = head + 1;
    while (end < lines.length && (blank(lines[end]) || indentOf(lines[end]) > base)) end++;
    while (end > head + 1 && blank(lines[end - 1])) end--;
    const want = b.cases.find((c) => { const v = caseValue(field, c); return v?.value !== undefined && JSON.stringify(v.value) === JSON.stringify(fallback); })
      ?? b.cases.find((c) => caseValue(field, c)?.otherwise);
    let body: string[] = [];
    if (want) {
      const from = want.line; // the line after the value line, 0-based
      let to = from;
      const own = indentOf(lines[want.line - 1]);
      while (to < end && (blank(lines[to]) || indentOf(lines[to]) > own)) to++;
      const kept = lines.slice(from, to);
      const deeper = kept.filter((l) => !blank(l)).reduce((m, l) => Math.min(m, indentOf(l)), Infinity);
      const cut = Number.isFinite(deeper) ? deeper - base : 0;
      body = kept.map((l) => !l.trim() ? "" : l.slice(Math.min(cut, indentOf(l))));
      while (body.length && !body[body.length - 1].trim()) body.pop();
    }
    lines = [...lines.slice(0, head), ...body, ...lines.slice(end)];
  }
  return { script: lines.join("\n"), left };
}

/** How a value is written on a value line: as it is when it is one word, else in quotes. */
const caseWord = (x: string) => /^\S+$/.test(x) && !["其他", "没有值"].includes(x) && !/^["“]/.test(x) ? x : `"${x.replace(/"/g, "")}"`;

/**
 * [script] with a value line for [value] (and a `# [label] 时做什么` under it) added to every `按设置 x` on [field]
 * that handles it neither itself nor by 其他: at the end of the block, before its 其他 / 没有值. [added]: how many blocks.
 */
export function addCaseInScript(script: string, field: Obj, value: Json, label: string): { script: string; added: number } {
  const fid = String(field.id);
  const branches = readsOf(script).reads.filter((r): r is Extract<SettingRead, { kind: "branch" }> => r.kind === "branch" && r.field === fid)
    .filter((b) => !b.cases.some((c) => { const v = caseValue(field, c); return v?.otherwise || (v?.value !== undefined && JSON.stringify(v.value) === JSON.stringify(value)); }))
    .sort((a, b) => b.line - a.line);
  if (!branches.length) return { script, added: 0 };
  let lines = script.split("\n");
  for (const b of branches) {
    const head = b.line - 1;
    const base = indentOf(lines[head]);
    let end = head + 1;
    while (end < lines.length && (blank(lines[end]) || indentOf(lines[end]) > base)) end++;
    while (end > head + 1 && blank(lines[end - 1])) end--;
    const tail = b.cases.find((c) => { const v = caseValue(field, c); return v?.otherwise || v?.missing; });
    const at = tail ? tail.line - 1 : end;
    const own = b.cases.length ? b.cases[0].col : base + 2;
    const under = (() => {
      const first = b.cases[0];
      const next = first ? lines.slice(first.line, end).find((l) => !blank(l) && indentOf(l) > own) : undefined;
      return next ? indentOf(next) : own + 2;
    })();
    const add = [`${" ".repeat(own)}${caseWord(String(value))}`, `${" ".repeat(under)}# ${label} 时做什么`];
    lines = [...lines.slice(0, at), ...add, ...lines.slice(at)];
  }
  return { script: lines.join("\n"), added: branches.length };
}

/** A condition (visibleWhen, a step's when) that tests [fid]. */
export const tests = (cond: Json | undefined, fid: string) => isObj(cond) && cond.field === fid;

/**
 * [script] with the value lines under each `按设置 [fid]` that say [from] made to say [to] (quoted when it must be,
 * or when it was): what a renamed option value needs.
 */
export function renameValueInScript(script: string, fid: string, from: string, to: string): string {
  const lines = script.split("\n");
  let changed = false;
  for (const r of readsOf(script).reads) {
    if (r.kind !== "branch" || r.field !== fid) continue;
    for (const c of r.cases) {
      if (c.text !== from) continue;
      const plain = /^\S+$/.test(to) && !["其他", "没有值"].includes(to) && !/^["“]/.test(to);
      const word = c.quoted || !plain ? `"${to.replace(/"/g, "")}"` : to;
      const text = lines[c.line - 1];
      lines[c.line - 1] = text.slice(0, c.col) + word + text.slice(c.col + c.len);
      changed = true;
    }
  }
  return changed ? lines.join("\n") : script;
}
