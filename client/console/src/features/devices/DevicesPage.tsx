import { useEffect, useState } from "react";
import { api } from "../../api/client";
import type { Channel, ChannelKind, Device, EventRule, GameAccount, Job } from "../../api/types";
import { Card, Empty, Muted, PageHeader, Pill, RowLink, SegmentTabs, ui } from "../../components/ui";
import { ACTIVE, JOB_STATES, platformName, shortTime, type Tone } from "../../format";
import { Link, paths } from "../../router";
import { useConsole } from "../../state/context";
import { lastFinished, RunRows } from "../jobs/runs";
import s from "./Devices.module.css";

type RunFilter = "all" | "active" | "done" | "bad";
const FILTERS: Record<RunFilter, (job: Job) => boolean> = {
  all: () => true,
  active: (job) => ACTIVE.has(job.state),
  done: (job) => job.state === "COMPLETED",
  bad: (job) => job.state === "FAILED" || job.state === "UNKNOWN",
};
const isToday = (at: number) => new Date(at).toDateString() === new Date().toDateString();
const CHANNEL_NAMES: Record<ChannelKind, string> = { DINGTALK: "钉钉", WECOM: "企业微信", BARK: "Bark", EMAIL: "邮件", WEBHOOK: "Webhook", LOCAL: "本机" };

/** 设备与战报: three numbers, the 通知 entry, the devices, and the runs filtered by state. */
export function DevicesPage() {
  const { data } = useConsole();
  const [filter, setFilter] = useState<RunFilter>("all");
  const today = data.jobs.filter((job) => isToday(job.updatedAt));
  const runs = data.jobs.filter(FILTERS[filter]);
  return (
    <>
      <PageHeader title="设备与战报" />
      <div className={s.stats}>
        <div className={s.stat}><b>{data.devices.filter((device) => device.online).length}</b><span>在线设备</span></div>
        <div className={s.stat}><b className={s.statOk}>{today.filter(FILTERS.done).length}</b><span>今日完成</span></div>
        <div className={s.stat}><b className={s.statBad}>{today.filter(FILTERS.bad).length}</b><span>异常待查</span></div>
      </div>
      <NoticeEntry />
      <section aria-labelledby="devices" className={s.section}>
        <h2 id="devices" className={s.h2}>我的设备</h2>
        {data.devices.length === 0
          ? <Card><Empty>在 App 登录同一账号即可添加</Empty></Card>
          : <div className={s.grid}>{data.devices.map((device) => <DeviceCard key={device.id} device={device} accounts={data.accounts} jobs={data.jobs} />)}</div>}
      </section>
      <section aria-labelledby="recent" className={s.section}>
        <h2 id="recent" className={s.h2}>战报</h2>
        <SegmentTabs label="按状态筛选" value={filter} onChange={setFilter} items={[["all", "全部"], ["active", "运行中"], ["done", "完成"], ["bad", "异常"]]} />
        <Card flush>
          {runs.length ? <RunRows jobs={runs} devices={data.devices} columns={["place", "source"]} limit={15} /> : <Empty>没有战报</Empty>}
        </Card>
      </section>
    </>
  );
}

/** 通知 · 邮件 · 本机 · N 条规则 · 设置 ›: the channels in use and how many rules are on. */
function NoticeEntry() {
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
  return (
    <Card flush>
      <RowLink to={paths.notices}>
        <span style={{ flex: 1, minWidth: 0 }}><b className={s.semi}>通知</b><span className={ui.tiny} style={{ display: "block" }}>{summary ?? "事件、规则、渠道"}</span></span>
        <span className={ui.tiny}>设置 ›</span>
      </RowLink>
    </Card>
  );
}

export function deviceStatus(device: Device, jobs: Job[]): [string, Tone, number] {
  const running = device.apps.filter((app) => app.phase === "RUNNING" || jobs.some((job) => job.deviceId === device.id && job.appKey === app.key && job.state === "RUNNING")).length;
  if (!device.online) return ["离线", "", 0];
  if (running > 1) return [`${running} 个应用运行中`, "info", running];
  if (running === 1 || device.phase === "RUNNING") return ["运行中", "info", Math.max(running, 1)];
  return ["在线", "ok", 0];
}
const accountName = (accounts: GameAccount[], id: string | null) => accounts.find((item) => item.id === id)?.name;

function DeviceCard({ device, accounts, jobs }: { device: Device; accounts: GameAccount[]; jobs: Job[] }) {
  const [status, tone, running] = deviceStatus(device, jobs);
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
    <Link to={paths.device(device.id)} className={s.deviceCard}>
      <div className={s.cardHead}>
        <span className={s.cardName}><b>{device.name}</b><span>{platformName(device.platform)}</span></span>
        <Pill tone={tone} dot>{status}</Pill>
      </div>
      <div className={running && device.online ? `${s.now} ${s.nowBusy}` : s.now}><div className={s.nowText}>{now}</div></div>
      {after && <Muted>{after}</Muted>}
    </Link>
  );
}
