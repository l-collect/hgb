import { Fragment } from "react";
import { Link } from "../../router";
import type { CheckIssue, IssueWhere, Obj } from "./api";
import { devPaths } from "./context";
import { str, tasks } from "./model";

/**
 * The server names a place in the draft by its path: `target/<game>/task/<task>/step/<step>/script/line/12`,
 * `snippet/<id>/script/line/3`. Said to a person it is 「任务名 · 步骤名 L12」, a link to that line.
 */
const SEG = "[^\\s/：:，,；;。）)」]+";
const PATH = new RegExp(`(?:target/${SEG}/task/${SEG}|snippet/${SEG})(?:/${SEG})*`, "g");

export interface Place { label: string; to: string }

/** The place a path names, in words and as an address; null when it is not one. */
export function locate(location: string, body: Obj | null | undefined): Place | null {
  const parts = location.split("/");
  const after = (word: string) => { const i = parts.indexOf(word); return i >= 0 ? parts[i + 1] : undefined; };
  const lineText = /\/line\/(\d+)/.exec(location)?.[1];
  const line = lineText ? Number(lineText) : null;
  const at = line ? ` L${line}` : "";
  const q = line ? `?line=${line}` : "";
  if (parts[0] === "snippet" && parts[1]) {
    const id = parts[1];
    return { label: `片段 ${id}${at}`, to: devPaths.snippet(id) + q };
  }
  if (parts[0] !== "target") return null;
  const taskId = after("task");
  if (!taskId) return null;
  const task = body ? tasks(body).find((t) => t.id === taskId) : undefined;
  const taskName = task?.name || taskId;
  const stepId = after("step");
  if (!stepId) return { label: taskName, to: devPaths.task(taskId) };
  const step = task?.steps.find((s) => String(s.id) === stepId);
  const stepName = (step && str(step.name)) || stepId;
  if (step && str(step.use)) return { label: `${taskName} · ${stepName} · 片段 ${str(step.use)}${at}`, to: devPaths.step(taskId, stepId) + q };
  return { label: `${taskName} · ${stepName}${at}`, to: devPaths.step(taskId, stepId) + q };
}

/** The place the server's [where] names (task · step L12, or a snippet's line); null when it names none. */
export function placeOf(where: IssueWhere | null | undefined, body: Obj | null | undefined): Place | null {
  if (!where) return null;
  const at = where.line ? ` L${where.line}` : "";
  const q = where.line ? `?line=${where.line}` : "";
  if (where.task) {
    const task = body ? tasks(body).find((t) => t.id === where.task) : undefined;
    const taskName = task?.name || where.task;
    if (!where.step) return { label: taskName, to: devPaths.task(where.task) };
    const step = task?.steps.find((s) => String(s.id) === where.step);
    const stepName = (step && str(step.name)) || where.step;
    const no = task && step ? `${task.steps.indexOf(step) + 1} ` : "";
    if (where.snippet) return { label: `${taskName} · ${no}${stepName} · 片段 ${where.snippet}${at}`, to: devPaths.taskSnippet(where.task, where.snippet) + q };
    return { label: `${taskName} · ${no}${stepName}${at}`, to: devPaths.step(where.task, where.step) + q };
  }
  if (where.snippet) return { label: `片段 ${where.snippet}${at}`, to: devPaths.snippet(where.snippet) + q };
  return null;
}

/** One issue said with its place first: a link to 「任务 · 步骤 L12」, then the reason. */
export function IssueText({ issue, body }: { issue: CheckIssue; body: Obj | null | undefined }) {
  const place = placeOf(issue.where, body);
  if (place) return <><Link to={place.to}>{place.label}</Link>：{issue.reason}</>;
  return <><Located text={issue.location} body={body} />{issue.location ? "：" : ""}{issue.reason}</>;
}

/** [text] with every draft path in it turned into a link saying where it is. */
export function Located({ text, body }: { text: string; body: Obj | null | undefined }) {
  const out: React.ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(PATH)) {
    const place = locate(m[0], body);
    if (!place) continue;
    out.push(text.slice(last, m.index));
    out.push(<Link key={m.index} to={place.to}>{place.label}</Link>);
    last = m.index! + m[0].length;
  }
  out.push(text.slice(last));
  return <>{out.map((x, i) => <Fragment key={i}>{x}</Fragment>)}</>;
}
