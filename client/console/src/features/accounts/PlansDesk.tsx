import { useEffect, useState } from "react";
import { api } from "../../api/client";
import type { Game, GameAccount, Job, Plan, PlanDayRuns, PlanLastRun, PlanRunState } from "../../api/types";
import { Button, Card, Empty, LiveSwitch, Pill, SegmentTabs, join, ui, Tag } from "../../components/ui";
import { clockText, nextTime, shortTime, WEEK } from "../../format";
import { useConsole } from "../../state/context";
import { Link, navigate, paths } from "../../router";
import { ProLockButton, usePro } from "../../components/Pro";
import { PlanCounts, planEntries, planHref, planLast, switchPlan, type PlanEntry } from "./Plans";
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
  const pro = usePro();
  // Plans count over all accounts, as the server counts them; a preset switched on becomes one too.
  const full = pro.full("maxPlans", plans.length);
  return (
    <section className={d.stack} aria-label="定时计划">
      <div className={d.toolbar}>
        <h2>定时计划</h2>
        <SegmentTabs label="视图" value={view} onChange={setView} items={[["list", "列表"], ["week", "周视图"]]} />
        <PlanCounts enabled={enabled} full={full} used={plans.length} newPlan={() => navigate(paths.planNew(account.id))} />
      </div>
      {entries.length === 0 ? <Card><Empty>还没有计划，点「＋ 新建」</Empty></Card>
        : view === "list" ? <PlanRows account={account} entries={entries} jobs={jobs} full={full} />
        : <WeekGrid account={account} entries={entries} jobs={jobs} />}
    </section>
  );
}

function PlanRows({ account, entries, jobs, full }: { account: GameAccount; entries: PlanEntry[]; jobs: Job[]; full: boolean }) {
  return (
    <Card flush className={d.table} role="table" aria-label="计划">
      <div className={join(d.trow, d.thead, s.cols)} role="row">
        <span role="columnheader">时间</span><span role="columnheader">计划</span><span role="columnheader">周期</span>
        <span role="columnheader" className={s.taskCol}>任务</span><span role="columnheader">下次</span><span role="columnheader">上次</span><span role="columnheader">启用</span>
      </div>
      {entries.map((entry) => {
        const source = (entry.plan ?? entry.preset)!;
        const days = new Set(daysOf(entry));
        const last = entry.plan ? planLast(entry.plan, jobs) : null;
        const next = entry.plan?.enabled && entry.plan.nextAt ? nextTime(entry.plan.nextAt) : "";
        const href = planHref(account, entry);
        return (
          <div key={entry.key} role="row" className={join(d.trow, d.clickable, s.cols)} onClick={() => navigate(href)}>
            <b className={join(ui.num, s.time)} role="cell">{clockText(source.minuteOfDay)}</b>
            <span role="cell" className={s.name}>
              <span className={s.nameLine}><Link to={href} className={d.cellLink} onClick={(e) => e.stopPropagation()}>{source.name}</Link>{!entry.preset && <Tag>自建</Tag>}</span>
              <span className={join(ui.tiny, s.taskInName)}>{taskLine(entry) || "未选任务"}</span>
            </span>
            <span role="cell" className={s.days} aria-label={`周${WEEK.filter((_, i) => days.has(i + 1)).join("")}`}>
              {WEEK.map((label, i) => <span key={label} className={days.has(i + 1) ? `${s.day} ${s.dayOn}` : s.day} aria-hidden="true">{label}</span>)}
            </span>
            <span role="cell" className={join(ui.tiny, s.taskCol)}>{taskLine(entry) || "未选任务"}</span>
            <span role="cell" className={join(ui.tiny, ui.num)}>{next || "—"}</span>
            <span role="cell" className={ui.tiny}>{last ? <span className={s.last} title={last.detail || undefined}>{shortTime(last.at)} <Pill tone={last.tone}>{last.label}</Pill></span> : "—"}</span>
            <span role="cell" onClick={(e) => e.stopPropagation()}>
              {full && !entry.plan ? <ProLockButton name={`启用${source.name}`} />
                : <LiveSwitch label={`启用${source.name}`} checked={entry.plan?.enabled ?? false} save={(on) => switchPlan(account, entry, on)} />}
            </span>
          </div>
        );
      })}
    </Card>
  );
}

/** A day of a plan in 周视图: how its runs ended, or 待跑 / 没跑 when it has none. Each has a fill or an outline and a mark, so none is told by colour alone. */
type Cell = "ok" | "bad" | "partial" | "check" | "run" | "skip" | "plan" | "miss" | "unknown" | "";
const CELL_TEXT: Record<Cell, string> = { ok: "完成", bad: "失败", partial: "部分失败", check: "待核对", run: "运行中", skip: "取消或跳过", plan: "待跑", miss: "没跑", unknown: "不知道", "": "" };
const CELL_MARK: Record<Cell, string> = { ok: "✓", bad: "✕", partial: "!", check: "?", run: "…", skip: "–", plan: "", miss: "", unknown: "?", "": "" };
const RUN_CELL: Record<PlanRunState, Cell> = { UNKNOWN: "check", COMPLETED: "ok", FAILED: "bad", PARTIAL_FAILED: "partial", ACTIVE: "run", CANCELLED: "skip", SKIPPED: "skip" };
const DAY = 86400000;
/** A day as yyyy-MM-dd in [timeZone]. */
const dayIn = (at: number, timeZone: string) => {
  try { return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at); }
  catch { return new Date(at).toLocaleDateString("en-CA"); }
};
const dayKey = (utc: number) => new Date(utc).toISOString().slice(0, 10);

/**
 * 周视图: Monday to Sunday of a week in the user's time zone, a row per plan. A cell is coloured by the runs the server
 * lists for that plan and day (/api/plans/days); 待跑 ahead, 没跑 for a day gone by with none, 「—」 while not known.
 */
function WeekGrid({ account, entries }: { account: GameAccount; entries: PlanEntry[]; jobs: Job[] }) {
  const { data } = useConsole();
  const [weeks, setWeeks] = useState(0);
  const today = dayIn(Date.now(), data.timeZone);
  const todayUtc = Date.parse(`${today}T00:00:00Z`);
  const mondayUtc = todayUtc - ((new Date(todayUtc).getUTCDay() + 6) % 7) * DAY + weeks * 7 * DAY;
  const dates = WEEK.map((_, i) => dayKey(mondayUtc + i * DAY));
  // A day either side covers any time zone; the days are matched by name.
  const from = mondayUtc - DAY, to = mondayUtc + 8 * DAY;
  const [runs, setRuns] = useState<{ from: number; days: Map<string, PlanLastRun[]> } | null>(null);
  // Plans are pushed again when a run changes their last, so that is when to read the week again.
  const changed = data.plans.filter((plan) => plan.accountId === account.id).map((plan) => `${plan.id}:${plan.last?.at ?? 0}:${plan.last?.state ?? ""}`).join();
  useEffect(() => {
    let live = true;
    api<PlanDayRuns[]>(`/api/plans/days?from=${from}&to=${to}`).then((list) => {
      if (live) setRuns({ from, days: new Map(list.map((item) => [`${item.planId}/${item.day}`, item.runs])) });
    }).catch(() => { if (live) setRuns((now) => now?.from === from ? now : null); });
    return () => { live = false; };
  }, [from, to, changed, data.epoch]);
  const known = runs?.from === from ? runs.days : null;
  const cell = (entry: PlanEntry, i: number): Cell => {
    if (!entry.plan || !entry.plan.days.includes(i + 1)) return "";
    const date = dates[i];
    const ran = known?.get(`${entry.plan.id}/${date}`);
    if (ran?.length) {
      const cells = ran.map((run) => RUN_CELL[run.state] ?? "skip");
      // The worst of the day's runs; a failure beside a success is a partial one.
      if (cells.includes("bad")) return cells.includes("ok") ? "partial" : "bad";
      return cells.includes("partial") ? "partial" : cells.includes("check") ? "check" : cells.includes("run") ? "run" : cells.includes("ok") ? "ok" : "skip";
    }
    if (date > today) return entry.plan.enabled ? "plan" : "";
    if (!known) return "unknown";
    if (date === today) return entry.plan.enabled ? "plan" : "";
    return entry.plan.enabled ? "miss" : "";
  };
  const label = weeks === 0 ? "本周" : weeks === -1 ? "上周" : weeks === 1 ? "下周" : `${dates[0].slice(5).replace("-", "/")} 起`;
  return (
    <Card flush>
      <div className={s.weekNav}>
        <Button small aria-label="上一周" onClick={() => setWeeks(weeks - 1)}>‹</Button>
        <b>{label}</b>
        <Button small aria-label="下一周" onClick={() => setWeeks(weeks + 1)}>›</Button>
        {weeks !== 0 && <Button small variant="link" onClick={() => setWeeks(0)}>回到本周</Button>}
      </div>
      <div className={s.week} role="table" aria-label={label}>
        <span role="columnheader" />
        {WEEK.map((day, i) => <span key={day} role="columnheader" className={dates[i] === today ? `${s.weekHead} ${s.today}` : s.weekHead}>周{day}</span>)}
        {entries.map((entry) => (
          <div key={entry.key} role="row" className={s.weekRow}>
            <Link to={planHref(account, entry)} role="rowheader" className={s.weekName} title={entry.name}>
              <b className={ui.num}>{clockText(entry.minuteOfDay)}</b><span>{entry.name}</span>
            </Link>
            {WEEK.map((day, i) => {
              const state = cell(entry, i);
              return <span key={day} role="cell" className={`${s.cell} ${state ? s[`cell_${state}`] : ""}`} title={state ? `周${day} ${clockText(entry.minuteOfDay)} ${CELL_TEXT[state]}` : undefined}
                aria-label={state ? CELL_TEXT[state] : "不跑"}><span aria-hidden="true">{CELL_MARK[state]}</span></span>;
            })}
          </div>
        ))}
      </div>
      <div className={s.legend}>
        {(["ok", "partial", "bad", "check", "run", "plan", "miss"] as Cell[]).map((state) => <span key={state}><i className={`${s.cell} ${s[`cell_${state}`]}`} aria-hidden="true">{CELL_MARK[state]}</i>{CELL_TEXT[state]}</span>)}
      </div>
    </Card>
  );
}
