import { useState } from "react";
import type { Game, GameAccount, Job, Plan } from "../../api/types";
import { Button, Card, Empty, Pill, SegmentTabs, Switch, join, ui } from "../../components/ui";
import { clockText, jobStatus, shortTime, WEEK, type Tone } from "../../format";
import { Link, navigate, paths } from "../../router";
import { planEntries, planHref, switchPlan, type PlanEntry } from "./Plans";
import d from "../../shell/Desk.module.css";
import s from "./PlansDesk.module.css";

const taskLine = (entry: PlanEntry) => {
  const tasks = entry.plan?.tasks ?? entry.preset?.tasks ?? [];
  return tasks.length <= 2 ? tasks.map((t) => t.name).join(" · ") : `${tasks.slice(0, 2).map((t) => t.name).join(" · ")} 等 ${tasks.length} 项`;
};
const daysOf = (entry: PlanEntry) => (entry.plan ?? entry.preset)?.days ?? [];

/**
 * 定时计划 on a wide window (网页桌面 · 账号与计划): a table, one plan a row with its time, the seven days, its tasks,
 * the last run and the switch lined up; or 周视图, the week as a grid of the times each plan runs. A row opens the
 * plan in the drawer.
 */
export function PlanTable({ account, game, plans, jobs }: { account: GameAccount; game?: Game; plans: Plan[]; jobs: Job[] }) {
  const [view, setView] = useState<"list" | "week">("list");
  const entries = planEntries(account, game, plans);
  const enabled = entries.filter((e) => e.plan?.enabled).length;
  return (
    <section className={d.stack} aria-label="定时计划">
      <div className={d.toolbar}>
        <h2>定时计划 <span className={ui.tiny}>{enabled}/{entries.length} 启用</span></h2>
        <SegmentTabs label="视图" value={view} onChange={setView} items={[["list", "列表"], ["week", "周视图"]]} />
        <Button small onClick={() => navigate(paths.planNew(account.id))}>＋ 新建</Button>
      </div>
      {entries.length === 0 ? <Card><Empty>还没有计划，点「＋ 新建」</Empty></Card>
        : view === "list" ? <PlanRows account={account} entries={entries} jobs={jobs} />
        : <WeekGrid account={account} entries={entries} jobs={jobs} />}
    </section>
  );
}

function PlanRows({ account, entries, jobs }: { account: GameAccount; entries: PlanEntry[]; jobs: Job[] }) {
  return (
    <Card flush className={d.table} role="table" aria-label="计划">
      <div className={join(d.trow, d.thead, s.cols)} role="row">
        <span role="columnheader">时间</span><span role="columnheader">计划</span><span role="columnheader">周期</span>
        <span role="columnheader" className={s.taskCol}>任务</span><span role="columnheader">上次</span><span role="columnheader">启用</span>
      </div>
      {entries.map((entry) => {
        const source = (entry.plan ?? entry.preset)!;
        const days = new Set(daysOf(entry));
        const last = entry.plan ? jobs.find((job) => job.planId === entry.plan!.id) : undefined;
        const href = planHref(account, entry);
        return (
          <div key={entry.key} role="row" className={join(d.trow, d.clickable, s.cols)} onClick={() => navigate(href)}>
            <b className={join(ui.mono, s.time)} role="cell">{clockText(source.minuteOfDay)}</b>
            <span role="cell" className={s.name}>
              <span className={s.nameLine}><Link to={href} className={d.cellLink} onClick={(e) => e.stopPropagation()}>{source.name}</Link>{!entry.preset && <Pill>自建</Pill>}</span>
              <span className={join(ui.tiny, s.taskInName)}>{taskLine(entry) || "未选任务"}</span>
            </span>
            <span role="cell" className={s.days} aria-label={`周${WEEK.filter((_, i) => days.has(i + 1)).join("")}`}>
              {WEEK.map((label, i) => <span key={label} className={days.has(i + 1) ? `${s.day} ${s.dayOn}` : s.day} aria-hidden="true">{label}</span>)}
            </span>
            <span role="cell" className={join(ui.tiny, s.taskCol)}>{taskLine(entry) || "未选任务"}</span>
            <span role="cell" className={ui.tiny}>{last ? <span className={s.last}>{shortTime(last.updatedAt)} <Pill tone={jobStatus(last)[1]}>{jobStatus(last)[0]}</Pill></span> : "—"}</span>
            <span role="cell" onClick={(e) => e.stopPropagation()}>
              <Switch label={`启用${source.name}`} checked={entry.plan?.enabled ?? false} onChange={(on) => switchPlan(account, entry, on)} />
            </span>
          </div>
        );
      })}
    </Card>
  );
}

type Cell = "ok" | "bad" | "run" | "warn" | "plan" | "";
const CELL_TEXT: Record<Cell, string> = { ok: "完成", bad: "异常", run: "运行中", warn: "未完成", plan: "待跑", "": "" };
const toneCell = (tone: Tone): Cell => tone === "ok" ? "ok" : tone === "bad" ? "bad" : tone === "info" ? "run" : "warn";

/** 周视图: Monday to Sunday of this week by the plans' times; a cell is coloured by the run it made, or 待跑 when none is known. */
function WeekGrid({ account, entries, jobs }: { account: GameAccount; entries: PlanEntry[]; jobs: Job[] }) {
  const now = new Date();
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
  const dates = WEEK.map((_, i) => new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i).toDateString());
  const today = dates.indexOf(now.toDateString());
  const cell = (entry: PlanEntry, i: number): Cell => {
    if (!entry.plan?.enabled || !daysOf(entry).includes(i + 1)) return "";
    const runs = jobs.filter((job) => job.planId === entry.plan!.id && new Date(job.createdAt).toDateString() === dates[i]);
    if (!runs.length) return "plan";
    const tones = runs.map((job) => toneCell(jobStatus(job)[1]));
    return tones.includes("bad") ? "bad" : tones.includes("run") ? "run" : tones.every((t) => t === "ok") ? "ok" : "warn";
  };
  return (
    <Card flush>
      <div className={s.week} role="table" aria-label="本周">
        <span role="columnheader" />
        {WEEK.map((label, i) => <span key={label} role="columnheader" className={i === today ? `${s.weekHead} ${s.today}` : s.weekHead}>周{label}</span>)}
        {entries.map((entry) => (
          <div key={entry.key} role="row" className={s.weekRow}>
            <Link to={planHref(account, entry)} role="rowheader" className={s.weekName} title={entry.name}>
              <b className={ui.mono}>{clockText(entry.minuteOfDay)}</b><span>{entry.name}</span>
            </Link>
            {WEEK.map((label, i) => {
              const state = cell(entry, i);
              return <span key={label} role="cell" className={`${s.cell} ${state ? s[`cell_${state}`] : ""}`} title={state ? `周${label} ${clockText(entry.minuteOfDay)} ${CELL_TEXT[state]}` : undefined}
                aria-label={state ? CELL_TEXT[state] : "不跑"} />;
            })}
          </div>
        ))}
      </div>
      <div className={s.legend}>
        {(["ok", "bad", "run", "plan"] as Cell[]).map((state) => <span key={state}><i className={`${s.cell} ${s[`cell_${state}`]}`} />{CELL_TEXT[state]}</span>)}
      </div>
    </Card>
  );
}
