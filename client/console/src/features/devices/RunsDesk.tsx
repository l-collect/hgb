import { useState } from "react";
import { api } from "../../api/client";
import type { Job } from "../../api/types";
import { Button, Card, Empty, Pill, SegmentTabs, TextSelect, join, ui } from "../../components/ui";
import { useAction } from "../../components/useAction";
import { ACTIVE, jobStatus, shortTime } from "../../format";
import { Link, navigate, paths, useQuery } from "../../router";
import { useConsole } from "../../state/context";
import { useDesk } from "../../shell/useWidth";
import { StoppedOn } from "../jobs/JobPage";
import { jobPlace, JobControls } from "../jobs/runs";
import d from "../../shell/Desk.module.css";
import s from "./RunsDesk.module.css";

export type RunFilter = "all" | "active" | "done" | "bad";
export const RUN_FILTERS: Record<RunFilter, (job: Job) => boolean> = {
  all: () => true,
  active: (job) => ACTIVE.has(job.state),
  done: (job) => job.state === "COMPLETED",
  bad: (job) => job.state === "FAILED" || job.state === "UNKNOWN",
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
  const chosen = useQuery().get("job");
  const [filter, setFilter] = useState<RunFilter>("all");
  const [span, setSpan] = useState<Span>("all");
  const [accountId, setAccountId] = useState("");
  const [sort, setSort] = useState<[Column, 1 | -1] | null>(null);
  const [limit, setLimit] = useState(50);
  const since = span === "today" ? startOfToday() : span === "week" ? startOfToday() - 6 * DAY : 0;
  const key = (job: Job, column: Column): string | number => {
    switch (column) {
      case "task": return job.taskName;
      case "account": return job.accountName ?? "";
      case "plan": return job.planName ?? "";
      case "device": return job.deviceName ?? "";
      case "start": return job.createdAt;
      case "took": return tookMs(job) ?? -1;
      case "state": return jobStatus(job)[0];
    }
  };
  let runs = data.jobs.filter((job) => RUN_FILTERS[filter](job) && job.updatedAt >= since && (!accountId || job.accountId === accountId));
  if (sort) {
    const [column, way] = sort;
    runs = [...runs].sort((a, b) => {
      const x = key(a, column), y = key(b, column);
      return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "zh-CN")) * way;
    });
  }
  const selected = desk && chosen ? data.jobs.find((job) => job.id === chosen) : undefined;
  const open = (job: Job) => desk ? navigate(`${paths.devices}?job=${encodeURIComponent(job.id)}`, { replace: true }) : navigate(paths.job(job.id));
  const sortBy = (column: Column) => setSort(sort?.[0] === column ? (sort[1] === -1 ? [column, 1] : null) : [column, -1]);
  const accounts = data.accounts.filter((a) => data.jobs.some((job) => job.accountId === a.id));

  const table = (
    <section className={d.stack} aria-labelledby="runs">
      <div className={d.toolbar}>
        <h2 id="runs">战报</h2>
        <SegmentTabs label="按状态筛选" value={filter} onChange={setFilter} items={[["all", "全部"], ["active", "运行中"], ["done", "完成"], ["bad", "异常"]]} />
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
        {runs.length === 0 ? <Empty>没有战报</Empty> : runs.slice(0, limit).map((job) => {
          const [label, tone] = jobStatus(job);
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
              <span role="cell"><Pill tone={tone}>{label}</Pill></span>
            </div>
          );
        })}
        {runs.length > limit && <div className={s.more}><Button variant="link" onClick={() => setLimit(limit + 100)}>再显示 {Math.min(100, runs.length - limit)} 条 · 共 {runs.length}</Button></div>}
      </Card>
    </section>
  );
  if (!desk) return table;
  return (
    <div className={join(d.colsMain, d.colsMainWide)}>
      {table}
      <aside className={d.side} aria-label="战报详情">
        {selected ? <JobSide key={selected.id} job={selected} /> : <Card><Empty>点一行看详情</Empty></Card>}
      </aside>
    </div>
  );
}

/** A run beside the table: how it ended and why, the screen it stopped on, and what can be done with it now. */
function JobSide({ job }: { job: Job }) {
  const { data } = useConsole();
  const again = useAction();
  const [label, tone] = jobStatus(job);
  const version = `${data.epoch}.${data.logVersion[job.id] ?? 0}`;
  const failed = job.state === "FAILED" || job.state === "UNKNOWN";
  const accountExists = data.accounts.some((item) => item.id === job.accountId);
  return (
    <Card flush as="article" aria-label="战报详情">
      <div className={s.sideHead}><b>{job.taskName}{job.accountName ? ` · ${job.accountName}` : ""}</b><Pill tone={tone}>{label}</Pill></div>
      <div className={s.sideBody}>
        <span className={ui.tiny}>{[shortTime(job.createdAt), jobPlace(job, data.devices), job.planName].filter(Boolean).join(" · ")}</span>
        {job.detail && (failed || job.state === "SKIPPED" || job.state === "CANCELLED") && <p className={s.why}>{job.detail}</p>}
        {failed && <StoppedOn id={job.id} version={version} />}
        <div className={s.sideActions}>
          {!ACTIVE.has(job.state) && job.accountId && accountExists && (
            <Button small variant="primary" disabled={again.busy} onClick={() => again.run(async () => {
              await api("/api/jobs", { method: "POST", body: { targetId: job.targetId, taskId: job.taskId, accountId: job.accountId, deviceId: null, appKey: null } });
              return "已提交";
            })}>重跑</Button>
          )}
          <JobControls job={job} small />
          <Link to={paths.job(job.id)} className={s.full}>步骤明细 ›</Link>
        </div>
        {again.message && <p role="status" className={again.message.ok ? s.ok : s.bad}>{again.message.text}</p>}
      </div>
    </Card>
  );
}
