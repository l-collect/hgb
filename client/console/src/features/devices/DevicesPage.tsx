import { RunningHero } from "../../components/Hero";
import { useEffect, useState } from "react";
import { api } from "../../api/client";
import type { Channel, ChannelKind, Device, EventRule, GameAccount, Job } from "../../api/types";
import { ButtonLink, Card, Muted, PageHeader, Pill, RowLink, SegmentTabs, ui } from "../../components/ui";
import { deviceWaiting, JOB_STATES, jobStatus, platformName, shortTime, STATE_TONES, waitNext, type Tone } from "../../format";
import { Link, navigate, paths, useQuery } from "../../router";
import { useConsole } from "../../state/context";
import { InstallAppCard } from "../onboarding/Onboarding";
import { ProCount, ProLimitButton, usePro } from "../../components/Pro";
import { FILTER_STATES, lastFinished, PagedRuns } from "../jobs/runs";
import { useWide } from "../../shell/useWidth";
import { RunsDesk } from "./RunsDesk";
import { RootLine } from "./root";
import s from "./Devices.module.css";

type RunFilter = "all" | "active" | "done" | "bad" | "waiting";
const FILTERS: Record<RunFilter, (job: Job) => boolean> = {
  all: () => true,
  active: (job) => job.state === "LEASED" || job.state === "RUNNING",
  done: (job) => job.state === "COMPLETED",
  bad: (job) => job.state === "FAILED" || job.state === "UNKNOWN",
  waiting: (job) => job.state === "QUEUED" || job.state === "WAITING",
};
const isToday = (at: number) => new Date(at).toDateString() === new Date().toDateString();
const CHANNEL_NAMES: Record<ChannelKind, string> = { DINGTALK: "钉钉", WECOM: "企业微信", BARK: "Bark", EMAIL: "邮件", WEBHOOK: "Webhook", LOCAL: "本机" };

/**
 * 设备与战报: three numbers, the 通知 entry, the devices, and the runs filtered by state. On a wide window a fourth number
 * (排队中), 通知 as a button at the top, and the runs as a table (RunsDesk).
 */
export function DevicesPage() {
  const { data } = useConsole();
  const pro = usePro();
  const wide = useWide();
  // A number opens the runs it counts: ?runs=done&span=today (the table reads the same address).
  const query = useQuery();
  const asked = query.get("runs") as RunFilter | null;
  const filter: RunFilter = asked && asked in FILTERS ? asked : "all";
  const todayOnly = query.get("span") === "today";
  const setFilter = (next: RunFilter) => navigate(next === "all" ? paths.devices : `${paths.devices}?runs=${next}`, { replace: true });
  // Counted by when they started, as the list they open is filtered.
  const today = data.jobs.filter((job) => isToday(job.createdAt));
  const stat = (to: string, value: number, label: string, tone?: string) => (
    <Link to={to} className={`${s.stat} ${s.statLink}`} onClick={() => setTimeout(() => (document.getElementById("recent") ?? document.getElementById("runs"))?.scrollIntoView({ block: "start" }))}>
      <b className={tone}>{value}</b><span>{label} ›</span>
    </Link>
  );
  return (
    <>
      <PageHeader title="设备与战报" aside={wide ? <NoticeButton /> : undefined} />
      <RunningHero />
      <div className={wide ? `${s.stats} ${s.stats4}` : s.stats}>
        <div className={s.stat}><b>{data.devices.filter((device) => device.online).length}</b><span>在线设备</span></div>
        {stat(`${paths.devices}?runs=done&span=today`, today.filter(FILTERS.done).length, "今日完成", s.statOk)}
        {stat(`${paths.devices}?runs=bad&span=today`, today.filter(FILTERS.bad).length, "今日异常", s.statBad)}
        {wide && stat(`${paths.devices}?runs=waiting`, data.jobs.filter(FILTERS.waiting).length, "排队", s.statRun)}
      </div>
      {!wide && <NoticeEntry />}
      <section aria-labelledby="devices" className={s.section}>
        <div className={s.h2Line}>
          <h2 id="devices" className={s.h2}>我的设备 <ProCount text={pro.count("maxDevices", data.devices.length)} /></h2>
          {pro.full("maxDevices", data.devices.length) && <ProLimitButton small text="添加" what="设备" />}
        </div>
        {data.devices.length === 0
          ? <InstallAppCard />
          : <div className={s.grid}>{data.devices.map((device) => <DeviceCard key={device.id} device={device} accounts={data.accounts} jobs={data.jobs} />)}</div>}
      </section>
      {wide ? <RunsDesk /> : (
        <section aria-labelledby="recent" className={s.section}>
          <h2 id="recent" className={s.h2}>战报</h2>
          <SegmentTabs label="按状态筛选" value={filter} onChange={setFilter} items={[["all", "全部"], ["active", "运行中"], ["waiting", "排队"], ["done", "完成"], ["bad", "异常"]]} />
          {todayOnly && <Muted>只看今天 · <Link to={filter === "all" ? paths.devices : `${paths.devices}?runs=${filter}`}>看全部时间</Link></Muted>}
          <Card flush>
            <PagedRuns query={{ states: FILTER_STATES[filter], from: todayOnly ? new Date(new Date().toDateString()).getTime() : undefined, limit: 20 }}
              devices={data.devices} columns={["place", "source"]} empty="没有战报" />
          </Card>
        </section>
      )}
    </>
  );
}

/** The channels in use and how many rules are on, as 邮件 · 本机 · N 条规则; null until read. */
function useNoticeSummary(): string | null {
  const { data } = useConsole();
  const [summary, setSummary] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    Promise.all([api<Channel[]>("/api/notifications/channels"), api<EventRule[]>("/api/notifications/rules")]).then(([channels, rules]) => {
      if (!current) return;
      const kinds = [...new Set(channels.filter((c) => c.enabled).map((c) => CHANNEL_NAMES[c.kind] ?? c.kind))];
      const on = rules.filter((r) => r.enabled).length;
      setSummary([...kinds, `${on} 条规则`].join(" · "));
    }).catch(() => { if (current) setSummary(null); });
    return () => { current = false; };
  }, [data.noticeVersion]);
  return summary;
}
/** 通知 at the top right of a wide page. */
function NoticeButton() {
  const summary = useNoticeSummary();
  const rules = summary?.split(" · ").pop();
  return <ButtonLink small to={paths.notices}>{rules ? `通知 · ${rules}` : "通知"}</ButtonLink>;
}
/** 通知 · 邮件 · 本机 · N 条规则 · 设置 ›: the channels in use and how many rules are on. */
function NoticeEntry() {
  const summary = useNoticeSummary();
  return (
    <Card flush>
      <RowLink to={paths.notices}>
        <span style={{ flex: 1, minWidth: 0 }}><b className={s.semi}>通知</b><span className={ui.tiny} style={{ display: "block" }}>{summary ?? "事件、规则、渠道"}</span></span>
        <span className={ui.tiny}>设置 ›</span>
      </RowLink>
    </Card>
  );
}

/**
 * A device as a pill: with one run going, that run read as everywhere else (jobStatus: 卡住 · 等无障碍, 已暂停 …); held on
 * the phone with none going, what it waits for; then how many apps run, or 空闲.
 */
export function deviceStatus(device: Device, jobs: Job[]): [string, Tone, number] {
  const running = device.apps.filter((app) => app.phase === "RUNNING" || jobs.some((job) => job.deviceId === device.id && job.appKey === app.key && job.state === "RUNNING")).length;
  if (!device.online) return ["离线", STATE_TONES.offline, 0];
  const going = jobs.filter((job) => job.deviceId === device.id && (job.state === "RUNNING" || job.state === "LEASED"));
  if (going.length === 1) return [...jobStatus(going[0], [device]), Math.max(running, 1)];
  // Held on the phone (无障碍断开, 锁屏 …): say so instead of 运行中.
  const waiting = deviceWaiting(device);
  if (waiting) return [running ? `卡住 · ${waiting.text}` : waiting.text, STATE_TONES.stuck, running];
  if (running > 1) return [`${running} 个应用运行中`, STATE_TONES.running, running];
  if (running === 1 || device.phase === "RUNNING") return ["运行中", STATE_TONES.running, Math.max(running, 1)];
  return ["空闲", STATE_TONES.idle, 0];
}
const accountName = (accounts: GameAccount[], id: string | null) => accounts.find((item) => item.id === id)?.name;

function DeviceCard({ device, accounts, jobs }: { device: Device; accounts: GameAccount[]; jobs: Job[] }) {
  const [status, tone, running] = deviceStatus(device, jobs);
  const waiting = deviceWaiting(device);
  const active = jobs.filter((job) => job.deviceId === device.id && (job.state === "RUNNING" || job.state === "LEASED"));
  let now: string;
  if (!device.online) now = `离线 · 上次 ${shortTime(device.lastSeenAt)}`;
  else if (active.length > 1 || running > 1) now = `${active.length || running} 个应用运行中（${active.map((job) => job.accountName ?? job.taskName).join("、")}）`;
  else if (active.length === 1) {
    const job = active[0]; const app = device.apps.find((item) => item.key === job.appKey);
    now = [app?.name, job.accountName, job.taskName].filter(Boolean).join(" · ");
  } else if (device.apps.length === 0) now = "空闲 · 还没有护肝宝支持的游戏";
  else now = `空闲 · ${device.apps.map((app) => `${app.name} · ${accountName(accounts, app.accountId) ?? app.observed?.nickname ?? "未指定"}`).join("；")}`;
  const last = lastFinished(jobs, (job) => job.deviceId === device.id);
  const queued = jobs.filter((job) => job.deviceId === device.id && job.state === "QUEUED").length;
  const after = [queued ? `排队 ${queued}` : null, last ? `上次 ${shortTime(last.updatedAt)} ${last.taskName} ${JOB_STATES[last.state][0]}` : null].filter(Boolean).join(" · ");
  return (
    // A card, not a link, so 怎么开 Root › can sit in it: the name's link covers the card.
    <article className={s.deviceCard} aria-labelledby={`device-${device.id}`}>
      <div className={s.cardHead}>
        <span className={s.cardName}><Link to={paths.device(device.id)} className={s.cardLink}><b id={`device-${device.id}`}>{device.name}</b></Link><span>{platformName(device.platform)}</span></span>
        <Pill tone={tone} dot>{status}</Pill>
      </div>
      <div className={running && device.online ? `${s.now} ${s.nowBusy}` : s.now}>
        <div className={s.nowText}>{now}</div>
        {waiting && waitNext(waiting) && <p className={s.waitNext}>{waitNext(waiting)}</p>}
      </div>
      {after && <Muted>{after}</Muted>}
      <RootLine device={device} />
    </article>
  );
}
