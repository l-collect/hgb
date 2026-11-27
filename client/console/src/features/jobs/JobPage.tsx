import { useEffect, useState, type ReactNode } from "react";
import { api, apiUrl, enc } from "../../api/client";
import type { Job, JobEvent } from "../../api/types";
import { Breadcrumb, Button, ButtonLink, Card, Empty, ErrorCard, join, Loading, Muted, Pill, ui } from "../../components/ui";
import { useAction } from "../../components/useAction";
import { ACTIVE, clock, eventDetail, eventKind, jobSource, jobStatus, jobWaiting, ranFor, seconds, shortDuration, shortTime, waitReason, type Tone } from "../../format";
import { Link, paths } from "../../router";
import { useConsole } from "../../state/context";
import { useDeveloper, withGame, workbenchPaths } from "../../state/developer";
import { NotFound } from "../ConsolePage";
import { PRO_REDEEM } from "../../components/Pro";
import { canRerun, jobPlace, JobControls, rerun, useJob } from "./runs";
import { lineOf } from "./stepLine";
import { WaitBanner } from "../devices/AppPage";
import s from "./Jobs.module.css";

type StepState = "done" | "stop" | "running" | "plain";
interface Step { stepId: string; key: string; name: string; events: JobEvent[]; state: StepState; summary: string; tookMs: number }

/**
 * Groups the log by the step it belongs to, in the order the steps ran, and reads each step's outcome from its events.
 * Each start of a step opens its own group; a step's later lines (its result, the check that its input stopped) can
 * arrive after the next step has started, so they join the latest group of the same step rather than the last group.
 */
function stepsOf(events: JobEvent[], job: Job): Step[] {
  const steps: Step[] = [];
  for (const event of events) {
    const key = event.step || "-";
    // A start joins only a group of the same step that has not started yet (the run's queued line); anything else
    // joins the step's latest group.
    let step = [...steps].reverse().find((item) => item.stepId === key &&
      (event.kind !== "step-started" || !item.events.some((seen) => seen.kind === "step-started")));
    if (event.kind === "step-started" && step && step !== steps[steps.length - 1]) step = undefined;
    if (!step) { step = { stepId: key, key: `${key}#${steps.length}`, name: event.stepName || "作业", events: [], state: "plain", summary: "", tookMs: 0 }; steps.push(step); }
    step.events.push(event);
  }
  steps.forEach((step, i) => {
    const kinds = new Set(step.events.map((event) => event.kind));
    const last = i === steps.length - 1;
    // The step's own result says more than the later check that its input stopped.
    const facts = [...step.events].reverse().filter((event) => event.kind !== "action" && event.kind !== "drift-warning" && event.detail);
    const fact = facts.find((event) => event.kind !== "revocation-observed") ?? facts[0] ?? step.events[step.events.length - 1];
    step.tookMs = step.events[step.events.length - 1].at - step.events[0].at;
    step.summary = fact ? [eventKind(fact.kind), eventDetail(fact)].filter(Boolean).join("：") : "";
    if (kinds.has("task-failed") || kinds.has("cancelled") || kinds.has("input-unconfirmed")) step.state = "stop";
    else if (kinds.has("step-completed")) step.state = "done";
    else if (last && ACTIVE.has(job.state)) step.state = "running";
    else if (last && !ACTIVE.has(job.state) && job.state !== "COMPLETED") step.state = "stop";
  });
  return steps;
}
const MARK: Record<StepState, string> = { done: "✓", stop: "!", running: "…", plain: "" };

/** Where a failed or unconfirmed run stopped, to open in the workbench: the step, and the line when the events say. */
export function stopOf(events: JobEvent[], job: Job): { step: string; line: number | null } | null {
  if (job.state !== "FAILED" && job.state !== "UNKNOWN") return null;
  const steps = stepsOf(events, job);
  const stopped = steps.find((step) => step.state === "stop") ?? steps[steps.length - 1];
  if (!stopped || stopped.stepId === "-") return null;
  return { step: stopped.stepId, line: lineOf(stopped.events) };
}
/** 去改这一步 (developers): the step a run stopped on, on the workbench's canvas. */
export function FixStep({ job, stop }: { job: Job; stop: { step: string; line: number | null } | null }) {
  if (!stop) return null;
  return <Link className={join(ui.button, ui.small, ui.ghost)} to={withGame(workbenchPaths.fix(job.taskId, stop.step, stop.line), job.targetId)}>去改这一步</Link>;
}
/** For a run beside a list: where it stopped, read from its events only for a developer and only when it failed or waits on a check. */
export function useStop(job: Job, wanted: boolean): { step: string; line: number | null } | null {
  const { data } = useConsole();
  const [stop, setStop] = useState<{ step: string; line: number | null } | null>(null);
  const bad = job.state === "FAILED" || job.state === "UNKNOWN";
  const version = `${data.epoch}.${data.logVersion[job.id] ?? 0}`;
  useEffect(() => {
    if (!wanted || !bad) { setStop(null); return; }
    let current = true;
    api<JobEvent[]>(`/api/jobs/${enc(job.id)}/events`).then((list) => { if (current) setStop(stopOf(list, job)); }).catch(() => {});
    return () => { current = false; };
  }, [job.id, job.state, wanted, bad, version]); // eslint-disable-line react-hooks/exhaustive-deps
  return stop;
}
/** The colour of why a run stopped, by how it ended: a failure red, an unconfirmed result orange, the rest grey. */
export const whyTone = (job: Job): Tone => jobStatus(job)[1];
/** The minute ticking, for 「已跑 N 分」. */
function useMinute(on: boolean) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!on) return;
    const timer = window.setInterval(() => setNow(Date.now()), 20000);
    return () => window.clearInterval(timer);
  }, [on]);
  return now;
}

/**
 * 战报详情: what the job was, how it ended, why (one line) and what to do next. A developer also gets 详情 (every step
 * and action the device reported) and, when it failed or waits on a check, 去改这一步.
 */
export function JobPage({ id }: { id: string }) {
  const { data } = useConsole();
  // Older than the latest the stream holds: read by id.
  const found = useJob(id);
  const job = found.job;
  const version = `${data.epoch}.${data.logVersion[id] ?? 0}`;
  const [events, setEvents] = useState<JobEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [all, setAll] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const developer = useDeveloper();
  const [detailed, setDetailed] = useState(false);
  const again = useAction();
  const now = useMinute(!!found.job && ACTIVE.has(found.job.state));
  useEffect(() => {
    let current = true;
    api<JobEvent[]>(`/api/jobs/${enc(id)}/events`).then((list) => { if (current) { setEvents(list); setError(null); } })
      .catch((failure: Error) => { if (current) setError(failure.message); });
    return () => { current = false; };
  }, [id, version, attempt]);
  if (!job) {
    if (found.state === "loading") return <Loading />;
    if (found.state === "failed") return <ErrorCard text={found.error ?? "读取失败"} retry={found.retry} />;
    return <NotFound text="找不到这条战报" />;
  }
  const [label, tone] = jobStatus(job, data.devices);
  const device = data.devices.find((item) => item.id === job.deviceId);
  const app = device?.apps.find((item) => item.key === job.appKey);
  const steps = events ? stepsOf(events, job) : [];
  const stopped = steps.find((step) => step.state === "stop");
  const started = events?.find((event) => event.kind === "step-started")?.at;
  const ended = events?.length ? events[events.length - 1].at : null;
  const crumbs: [string, string | null][] = device
    ? [["设备", paths.devices], [device.name, paths.device(device.id)], ...(app ? [[app.name, paths.app(device.id, app.key)] as [string, string]] : []), ["战报", null]]
    : job.accountId ? [["账号与计划", paths.accounts], [job.accountName ?? "账号", paths.account(job.accountId, "runs")], ["战报", null]] : [["设备", paths.devices], ["战报", null]];
  const toggle = (key: string) => { setAll(false); setOpen((now) => { const next = new Set(now); if (next.has(key)) next.delete(key); else next.add(key); return next; }); };
  const accountExists = data.accounts.some((item) => item.id === job.accountId);
  const waiting = jobWaiting(job, data.devices);
  const why = whyTone(job);
  const stop = developer && events ? stopOf(events, job) : null;
  return (
    <>
      <Breadcrumb items={crumbs} />
      <header className={s.jobHeader}>
        <div className={s.jobTitle}>
          {/* The account is a link to its settings; the line under the title says only where, when and how long. */}
          <div className={s.titleLine}><h1>{job.taskName}</h1>
            {job.accountName && (job.accountId && accountExists ? <Link to={paths.account(job.accountId)} className={s.accountLink}>{job.accountName}</Link> : <Muted as="span">{job.accountName}</Muted>)}
            <Pill tone={tone} live={ACTIVE.has(job.state)}>{label}</Pill></div>
          <Muted>{[data.devices.length > 1 || !job.deviceName ? jobPlace(job, data.devices) : null,
            started ? `${shortTime(started)} 开始` : `${shortTime(job.createdAt)} 创建`, ranFor(job, started, now),
            started && ended && !ACTIVE.has(job.state) ? `用时 ${seconds(ended - started)}` : null, jobSource(job)].filter(Boolean).join(" · ")}</Muted>
        </div>
        <div className={s.jobActions}>
          <JobControls job={job} />
          {canRerun(job, accountExists) && (
            <Button variant="primary" className={s.big} disabled={again.busy} onClick={() => again.run(() => rerun(job, data.devices))}>重跑</Button>
          )}
        </div>
      </header>
      {again.message && !again.message.ok && <p role="alert" className={s.noteBad}>{again.message.text}</p>}
      {waiting && <WaitBanner waiting={waiting} />}
      {waitReason(job) && <p role="status" className={s.waitNote}>{label}：{waitReason(job)}</p>}
      {(job.state === "FAILED" || job.state === "UNKNOWN" || job.state === "SKIPPED" || (job.state === "CANCELLED" && stopped)) && (
        <section aria-labelledby="why" className={`${s.why} ${s[`why_${why || "neutral"}`] ?? ""}`}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v6M12 17h.01" /></svg>
          <div>
            <h2 id="why">{stopped ? `停在“${stopped.name}”：${label}` : label}</h2>
            <p>{job.detail || stopped?.summary || "设备没有说明原因。"}</p>
            <NextSteps job={job} fix={developer ? <FixStep job={job} stop={stop} /> : null} />
            {(job.state === "FAILED" || job.state === "UNKNOWN") && <StoppedOn id={job.id} version={version} />}
          </div>
        </section>
      )}
      {/* Without the events the reason may say less (where it stopped): a player is told, and can read them again. */}
      {!developer && error && (
        <p role="alert" className={s.readFailed}>读不到明细 · <Button variant="link" onClick={() => { setError(null); setEvents(null); setAttempt((n) => n + 1); }}>重试</Button></p>
      )}
      {developer && (
        <div className={s.detailBar}>
          <Button small aria-expanded={detailed} aria-controls="job-detail" onClick={() => setDetailed(!detailed)}>{detailed ? "收起详情" : "详情"}</Button>
        </div>
      )}
      {developer && detailed && <section id="job-detail" aria-labelledby="steps" className={s.stepsSection}>
        <div className={s.stepsHead}>
          <h2 id="steps">步骤明细</h2>
          {steps.length > 0 && <Button small onClick={() => { setAll(!all); setOpen(new Set()); }}>{all ? "收起全部" : "展开全部"}</Button>}
        </div>
        {error ? <ErrorCard text={error} retry={() => { setError(null); setEvents(null); setAttempt((n) => n + 1); }} /> : events === null ? <Loading card /> : steps.length === 0 ? (
          <Card><Empty>{ACTIVE.has(job.state) ? "设备还没有上报明细" : "这次运行没有明细"}</Empty></Card>
        ) : (
          <ol className={s.steps}>
            {steps.map((step, i) => {
              const shown = all || open.has(`${i}`);
              return (
                <li key={i} className={step.state === "stop" ? `${s.step} ${s[`stepStop_${why || "neutral"}`]}` : s.step}>
                  <button type="button" className={s.stepButton} aria-expanded={shown} onClick={() => toggle(`${i}`)}>
                    <span aria-hidden="true" className={`${s.stepMark} ${s[step.state === "stop" ? `mark_stop_${why || "neutral"}` : `mark_${step.state}`]}`}>{MARK[step.state]}</span>
                    <span className={s.stepText}><b>{step.name}</b><span>{step.summary}</span></span>
                    <span className={s.took}>{step.tookMs > 0 ? seconds(step.tookMs) : ""}</span>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" className={s.chevron}><path d={shown ? "M6 15l6-6 6 6" : "M6 9l6 6 6-6"} /></svg>
                  </button>
                  {shown && (
                    <ul className={s.actionsList}>
                      {step.events.map((event, j) => (
                        <li key={j} className={event.kind === "action" ? undefined : s.factLine}>
                          <span className={s.at}>{clock(event.at)}</span>
                          <span className={s.what}>{event.kind === "action" ? event.action : eventKind(event.kind)}</span>
                          <span className={event.kind === "action" && /^(UNAVAILABLE|INTERRUPTED)/.test(event.detail) ? s.resultWarn : s.resultText}>{eventDetail(event)}</span>
                          <span className={s.at}>{event.elapsedMs ? shortDuration(event.elapsedMs) : ""}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </section>}
    </>
  );
}

/**
 * Where to go after a run that did not finish, by how it ended: a failure to its settings, a held or skipped one to
 * the device or the plan; an unconfirmed one is settled by 做完了 / 重做这步 / 放弃本次 with the other controls.
 */
export function NextSteps({ job, fix }: { job: Job; fix?: ReactNode }) {
  const { data } = useConsole();
  const device = data.devices.find((item) => item.id === job.deviceId);
  const reason = `${job.detail} ${job.waitReason ?? ""}`;
  const links: [string, string][] = [];
  const settings = job.accountId && data.accounts.some((item) => item.id === job.accountId) ? paths.taskDetail(job.targetId, job.taskId, job.accountId) : null;
  const planOf = job.planId ? data.plans.find((item) => item.id === job.planId) : undefined;
  const plan = planOf && job.accountId ? paths.planEdit(job.accountId, planOf.id) : null;
  // The task set on its own in the plan it came from: its values are the plan's, so that is where to change them.
  const ownInPlan = planOf && job.accountId && planOf.taskConfigs && Object.prototype.hasOwnProperty.call(planOf.taskConfigs, job.taskId)
    ? paths.planTaskConfig(job.accountId, planOf.id, job.taskId) : null;
  if (job.state === "FAILED") {
    if (ownInPlan) links.push(["调整本计划参数", ownInPlan]);
    else if (settings) links.push(["调整参数", settings]);
    if (device) links.push(["看设备", paths.device(device.id)]);
  } else if (job.state === "UNKNOWN") {
    if (device) links.push(["看设备", paths.device(device.id)]);
  } else if (job.state === "SKIPPED" || (job.state === "CANCELLED" && !job.cancelRequested)) {
    if (/Pro|会员/.test(reason)) links.push(["开通会员", PRO_REDEEM]);
    else if (/编号|昵称|账号/.test(reason) && job.accountId) links.push(["补全账号", paths.account(job.accountId)]);
    if (/离线|设备/.test(reason) && device) links.push(["看设备", paths.device(device.id)]);
    if (plan) links.push(["看计划", plan]);
  }
  if (!links.length && !fix) return null;
  return <div className={s.next}>{links.map(([text, to]) => <ButtonLink key={to} small to={to}>{text}</ButtonLink>)}{fix}</div>;
}

/** The screen the job stopped on, as its device sent it; nothing when there is none. */
export function StoppedOn({ id, version }: { id: string; version: string }) {
  const [shown, setShown] = useState(true);
  useEffect(() => setShown(true), [version]);
  if (!shown) return null;
  return (
    <a href={apiUrl(`/api/jobs/${enc(id)}/screen`)} target="_blank" rel="noreferrer" className={s.stoppedOn}>
      <img key={version} src={`${apiUrl(`/api/jobs/${enc(id)}/screen`)}?v=${encodeURIComponent(version)}`} alt="停下时的画面" loading="lazy" onError={() => setShown(false)} />
    </a>
  );
}
