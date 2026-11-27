import { useEffect, useState } from "react";
import type { Job } from "../../api/types";
import { Button, Card, Empty, ErrorCard, Loading, Pill, SegmentTabs, TextSelect, join, ui } from "../../components/ui";
import { useAction } from "../../components/useAction";
import { ACTIVE, jobStatus, jobWaiting, shortTime, waitNext, waitReason } from "../../format";
import { Link, navigate, paths, useQuery } from "../../router";
import { useConsole } from "../../state/context";
import { useDesk } from "../../shell/useWidth";
import { StoppedOn, whyTone } from "../jobs/JobPage";
import { canRerun, FILTER_STATES, jobPlace, JobControls, MoreRuns, rerun, runNote, useJob, useJobPages } from "../jobs/runs";
import { NextSteps } from "../jobs/JobPage";
import d from "../../shell/Desk.module.css";
import s from "./RunsDesk.module.css";

export type RunFilter = "all" | "active" | "done" | "bad" | "waiting";
export const RUN_FILTERS: Record<RunFilter, (job: Job) => boolean> = {
  all: () => true,
  active: (job) => job.state === "LEASED" || job.state === "RUNNING",
  done: (job) => job.state === "COMPLETED",
  bad: (job) => job.state === "FAILED" || job.state === "UNKNOWN",
  waiting: (job) => job.state === "QUEUED" || job.state === "WAITING",
};
type Span = "today" | "week" | "all";
const DAY = 86400000;
const startOfToday = () => { const now = new Date(); return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime(); };
/** From queued to its last change, for a run that has ended; the full log has the exact time. */
const tookMs = (job: Job) => ACTIVE.has(job.state) ? null : Math.max(0, job.updatedAt - job.createdAt);
const took = (ms: number | null) => ms === null ? "—" : ms < 60000 ? `${Math.max(1, Math.round(ms / 1000))} 秒`
  : ms < 3600000 ? `${Math.round(ms / 60000)} 分` : `${Math.floor(ms / 3600000)} 时 ${Math.round((ms % 3600000) / 60000)} 分`;

type Column = "task" | "account" | "plan" | "device" | "start" | "took" | "state";
const COLUMNS: [Column, string][] = [["task", "任务"], ["account", "账号"], ["plan", "计划"], ["device", "设备"], ["start", "开始"], ["took", "时长"], ["state", "结果"]];

/**
 * 战报 on a wide window (网页桌面 · 设备与战报): a table sorted by any column, filtered by state, time and account. From
 * 1280 a row opens beside the table (its address keeps ?job=); narrower it opens the run's own page.
 */
export function RunsDesk() {
  const { data } = useConsole();
  const desk = useDesk();
  const query = useQuery();
  const chosen = query.get("job");
  // The numbers above the table open it filtered: ?runs=bad&span=today.
  const askedFilter = query.get("runs") as RunFilter | null;
  const askedSpan = query.get("span") as Span | null;
  const [filter, setFilter] = useState<RunFilter>(askedFilter && askedFilter in RUN_FILTERS ? askedFilter : "all");
  const [span, setSpan] = useState<Span>(askedSpan === "today" || askedSpan === "week" ? askedSpan : "all");
  useEffect(() => {
    if (askedFilter && askedFilter in RUN_FILTERS) setFilter(askedFilter);
    if (askedSpan === "today" || askedSpan === "week") setSpan(askedSpan);
  }, [askedFilter, askedSpan]);
  const [accountId, setAccountId] = useState("");
  const [sort, setSort] = useState<[Column, 1 | -1] | null>(null);
  const since = span === "today" ? startOfToday() : span === "week" ? startOfToday() - 6 * DAY : 0;
  // Read from the server a page at a time, by state, account and since when; sorting is of what has been read.
  const pages = useJobPages({ states: FILTER_STATES[filter], accountId: accountId || undefined, from: since || undefined });
  const key = (job: Job, column: Column): string | number => {
    switch (column) {
      case "task": return job.taskName;
      case "account": return job.accountName ?? "";
      case "plan": return job.planName ?? "";
      case "device": return job.deviceName ?? "";
      case "start": return job.createdAt;
      case "took": return tookMs(job) ?? -1;
      case "state": return jobStatus(job, data.devices)[0];
    }
  };
  let runs = pages.items ?? [];
  if (sort) {
    const [column, way] = sort;
    runs = [...runs].sort((a, b) => {
      const x = key(a, column), y = key(b, column);
      return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "zh-CN")) * way;
    });
  }
  const picked = useJob(desk ? chosen : null);
  const selected = desk && chosen ? runs.find((job) => job.id === chosen) ?? picked.job ?? undefined : undefined;
  const open = (job: Job) => {
    if (!desk) { navigate(paths.job(job.id)); return; }
    const next = new URLSearchParams(query); next.set("job", job.id);
    navigate(`${paths.devices}?${next}`, { replace: true });
  };
  const sortBy = (column: Column) => setSort(sort?.[0] === column ? (sort[1] === -1 ? [column, 1] : null) : [column, -1]);
  const accounts = data.accounts;

  const table = (
    <section className={d.stack} aria-labelledby="runs">
      <div className={d.toolbar}>
        <h2 id="runs">战报</h2>
        <SegmentTabs label="按状态筛选" value={filter} onChange={setFilter}
          items={[["all", "全部"], ["active", "运行中"], ["waiting", "排队"], ["done", "完成"], ["bad", "异常"]]} />
        <TextSelect label="时间" value={span} onChange={setSpan} options={[["today", "今天"], ["week", "近 7 天"], ["all", "全部时间"]]} />
        {accounts.length > 1 && <TextSelect label="账号" value={accountId} onChange={setAccountId} options={[["", "全部账号"], ...accounts.map((a): [string, string] => [a.id, a.name])]} />}
      </div>
      <Card flush className={d.table} role="table" aria-label="战报">
        <div role="row" className={join(d.trow, d.thead, s.cols)}>
          {COLUMNS.map(([column, label]) => {
            const way = sort?.[0] === column ? sort[1] : 0;
            return (
              <span key={column} role="columnheader" aria-sort={way === 1 ? "ascending" : way === -1 ? "descending" : "none"}>
                <button type="button" className={d.sort} onClick={() => sortBy(column)}>
                  {label}<span aria-hidden="true">{way === 1 ? "↑" : way === -1 ? "↓" : ""}</span>
                </button>
              </span>
            );
          })}
        </div>
        {!pages.items ? (pages.error ? <ErrorCard text={pages.error} retry={pages.retry} /> : <Loading />)
          : runs.length === 0 ? <Empty>没有战报</Empty> : runs.map((job) => {
          const [label, tone] = jobStatus(job, data.devices);
          return (
            <div key={job.id} role="row" tabIndex={0} className={join(d.trow, d.clickable, s.cols, job.id === selected?.id && d.selected)}
              aria-selected={desk ? job.id === selected?.id : undefined}
              onClick={() => open(job)} onKeyDown={(e) => { if (e.key === "Enter") open(job); }}>
              <b role="cell" className={s.task}>{job.taskName}</b>
              <span role="cell">{job.accountName ?? "—"}</span>
              <span role="cell" className={ui.tiny}>{job.planName ?? "手动"}</span>
              <span role="cell" className={ui.tiny}>{jobPlace(job, data.devices)}</span>
              <span role="cell" className={join(ui.mono, s.nowrap)}>{shortTime(job.createdAt)}</span>
              <span role="cell" className={ui.tiny}>{took(tookMs(job))}</span>
              <span role="cell"><Pill tone={tone} live={ACTIVE.has(job.state)}>{label}</Pill>{runNote(job) && <span className={job.state === "FAILED" ? s.reasonBad : s.reason} title={runNote(job)}>{runNote(job)}</span>}</span>
            </div>
          );
        })}
        <MoreRuns pages={pages} />
      </Card>
    </section>
  );
  if (!desk) return table;
  return (
    <div className={join(d.colsMain, d.colsMainWide)}>
      {table}
      <aside className={d.side} aria-label="战报详情">
        {selected ? <JobSide key={selected.id} job={selected} />
          : <Card><Empty>{chosen && picked.state === "missing" ? "找不到这条战报" : chosen && picked.state === "loading" ? "读取中…" : "点一行看详情"}</Empty></Card>}
      </aside>
    </div>
  );
}

/** A run beside the table: how it ended and why, the screen it stopped on, and what can be done with it now. */
function JobSide({ job }: { job: Job }) {
  const { data } = useConsole();
  const again = useAction();
  const [label, tone] = jobStatus(job, data.devices);
  const version = `${data.epoch}.${data.logVersion[job.id] ?? 0}`;
  const failed = job.state === "FAILED" || job.state === "UNKNOWN";
  const why = whyTone(job);
  const waiting = jobWaiting(job, data.devices);
  const accountExists = data.accounts.some((item) => item.id === job.accountId);
  return (
    <Card flush as="article" aria-label="战报详情">
      <div className={s.sideHead}><b>{job.taskName}{job.accountName ? ` · ${job.accountName}` : ""}</b><Pill tone={tone}>{label}</Pill></div>
      <div className={s.sideBody}>
        <span className={ui.tiny}>{[shortTime(job.createdAt), jobPlace(job, data.devices), job.planName].filter(Boolean).join(" · ")}</span>
        {job.detail && (failed || job.state === "SKIPPED" || job.state === "CANCELLED") && <p className={`${s.why} ${s[`why_${why || "neutral"}`] ?? ""}`}>{job.detail}</p>}
        {waiting && <p className={s.wait} role="status"><b>{waiting.text}</b>{waitNext(waiting) && ` · ${waitNext(waiting)}`}</p>}
        {waitReason(job) && <p className={s.wait}>{label}：{waitReason(job)}</p>}
        {failed && <StoppedOn id={job.id} version={version} />}
        <div className={s.sideActions}>
          {canRerun(job, accountExists) && (
            <Button small variant="primary" disabled={again.busy} onClick={() => again.run(() => rerun(job, data.devices))}>重跑</Button>
          )}
          <JobControls job={job} small />
          <Link to={paths.job(job.id)} className={s.full}>步骤明细 ›</Link>
        </div>
        {again.message && !again.message.ok && <p role="alert" className={s.bad}>{again.message.text}</p>}
        <NextSteps job={job} />
      </div>
    </Card>
  );
}
