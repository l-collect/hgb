import type { Job, Plan } from "../api/types";
import { ACTIVE, jobStatus, nextParts } from "../format";
import { Link, paths } from "../router";
import { useConsole } from "../state/context";
import { join, ui } from "./ui";
import s from "./Hero.module.css";

/**
 * UI v8 主卡：一级页面最多一张，只放这一页最重要的一件事。浅色渐变配 ink 字，不加阴影。
 * 数据都取自控制台已经有的状态；没有可说的就不显示。
 */

/** The job to show: one that runs, else the oldest still waiting. [accountId] narrows to one account. */
function currentJob(jobs: Job[], accounts: Set<string> | null): Job | undefined {
  const mine = jobs.filter((job) => ACTIVE.has(job.state) && (!accounts || (job.accountId !== null && accounts.has(job.accountId))));
  return mine.find((job) => job.state === "RUNNING" || job.state === "LEASED") ?? mine[mine.length - 1];
}

/** 运行中：任务名、状态、账号和设备；点开看这次运行。 */
export function RunningHero({ gameId }: { gameId?: string }) {
  const { data } = useConsole();
  const job = currentJob(data.jobs, gameId ? new Set(data.accounts.filter((a) => a.gameId === gameId).map((a) => a.id)) : null);
  if (!job) return null;
  const [label, tone] = jobStatus(job, data.devices);
  const where = [job.accountName, job.deviceName].filter(Boolean).join(" · ");
  return (
    <Link to={paths.job(job.id)} className={join(ui.hero, s.hero)}>
      <span className={s.head}><span className={join(ui.pill, ui[`pill_${tone || "neutral"}`])}>{label}</span>{where && <span className={s.muted}>{where}</span>}</span>
      <b className={s.title}>{job.taskName}</b>
      {job.planName && <span className={s.muted}>计划 · {job.planName}</span>}
      <span className={s.go} aria-hidden="true"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M7 17 17 7M8 7h9v9" /></svg></span>
    </Link>
  );
}

/** 下次开跑：最近一次要开跑的计划（只看开着的）。 */
/** The next enabled plan to start (in [gameId]'s accounts when given): what [NextPlanHero] shows. */
export function useNextPlan(gameId?: string): (Plan & { nextAt: number }) | undefined {
  const { data } = useConsole();
  const inGame = gameId ? new Set(data.accounts.filter((a) => a.gameId === gameId).map((a) => a.id)) : null;
  return data.plans
    .filter((plan): plan is Plan & { nextAt: number } => plan.enabled && typeof plan.nextAt === "number" && plan.nextAt >= Date.now() - 60000 && (!inGame || inGame.has(plan.accountId)))
    .sort((a, b) => a.nextAt - b.nextAt)[0];
}

export function NextPlanHero({ gameId }: { gameId?: string }) {
  const { data } = useConsole();
  const next = useNextPlan(gameId);
  if (!next) return null;
  const account = data.accounts.find((a) => a.id === next.accountId);
  const { day, hm } = nextParts(next.nextAt);
  return (
    <Link to={paths.planEdit(next.accountId, next.id)} className={join(ui.hero2, s.hero)}>
      <span className={s.muted}>下次开跑{day ? ` · ${day}` : ""}{account ? ` · ${account.name}` : ""}</span>
      <span className={s.bigLine}><b className={s.big}>{hm}</b><span className={s.title}>{next.name}</span></span>
      <span className={s.go} aria-hidden="true"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M7 17 17 7M8 7h9v9" /></svg></span>
    </Link>
  );
}
