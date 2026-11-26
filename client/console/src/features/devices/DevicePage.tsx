import { useState } from "react";
import type { App, Device, GameAccount, Job } from "../../api/types";
import { Breadcrumb, Card, CardTitle, Empty, Field, Grow, Muted, Pill, Row, Segments, TextSelect } from "../../components/ui";
import { appStatus, clock, jobSource, platformName, waitNext, waitReason } from "../../format";
import { Link, paths } from "../../router";
import { useConsole } from "../../state/context";
import { ProLockRow } from "../../components/Pro";
import { NotFound } from "../ConsolePage";
import { appJobs, JobControls, switchNote, useRunNow, useSwitchLocked } from "../jobs/runs";
import { RunTaskRows } from "../library/LibraryPage";
import { AccountMenu, useAppAccounts } from "./appAccounts";
import { AppDetail } from "./AppPage";
import { deviceStatus } from "./DevicesPage";
import s from "./Devices.module.css";

/** A phone goes straight to its first app; a device with several app instances (Windows) lists them first. */
export function DevicePage({ id }: { id: string }) {
  const { data } = useConsole();
  const device = data.devices.find((item) => item.id === id);
  if (!device) return <NotFound text="找不到这台设备，它可能已经解绑" />;
  if (device.platform.toLowerCase() === "android" && device.apps.length > 0) return <AppDetail device={device} app={device.apps[0]} base={paths.device(device.id)} />;
  return <DeviceDetail device={device} />;
}

function DeviceDetail({ device }: { device: Device }) {
  const { data } = useConsole();
  const [status, tone] = deviceStatus(device, data.jobs);
  const gameIds = [...new Set(device.apps.map((app) => app.gameId))];
  const [chosen, setChosen] = useState(gameIds[0] ?? "");
  const gameId = gameIds.includes(chosen) ? chosen : gameIds[0] ?? "";
  const gameName = (id: string) => data.games.find((game) => game.id === id)?.name ?? id;
  const apps = device.apps.filter((app) => app.gameId === gameId);
  return (
    <>
      <Breadcrumb items={[["设备", paths.devices], [device.name, null]]} />
      <header className={s.appHeader}>
        <h1 className={s.title}>{device.name}</h1>
        <Pill tone={tone} dot>{status}</Pill>
        <Muted as="span">{platformName(device.platform)} · {device.apps.length} 个应用</Muted>
      </header>
      {device.apps.length === 0 ? <Card><Empty>{device.online ? "这台设备上还没有护肝宝支持的游戏。" : "设备离线，上线后会显示它的应用。"}</Empty></Card> : (
        <>
          {gameIds.length > 1 && <Segments role="radiogroup" label="游戏" value={gameId} onChange={setChosen}
            items={gameIds.map((id) => [id, `${gameName(id)} · ${device.apps.filter((app) => app.gameId === id).length} 个应用`])} />}
          <h2 className={s.h2}>{gameName(gameId)}</h2>
          <section aria-label="应用" className={s.appGrid}>
            {apps.map((app) => <AppCard key={app.key} device={device} app={app} accounts={data.accounts.filter((item) => item.gameId === app.gameId)} jobs={data.jobs} />)}
          </section>
          <div className={s.split}>
            <Waiting device={device} gameId={gameId} apps={apps} jobs={data.jobs} />
            <RunNow key={gameId} device={device} apps={apps} accounts={data.accounts.filter((item) => item.gameId === gameId)} />
          </div>
        </>
      )}
    </>
  );
}

function AppCard({ device, app, accounts, jobs }: { device: Device; app: App; accounts: GameAccount[]; jobs: Job[] }) {
  const { current, fallback, setCurrent, setDefault } = useAppAccounts(device, app);
  const { current: job } = appJobs(jobs, device.id, app.key);
  const [status, tone] = appStatus(app.phase, device.online, app.waiting);
  const waiting = device.online ? app.waiting : null;
  return (
    <Card as="article" className={job ? `${s.appCard} ${s.appCardBusy}` : s.appCard}>
      <div className={s.cardHead}>
        <Link to={paths.app(device.id, app.key)} className={s.appName}>{app.name}</Link>
        <AccountMenu app={app} accounts={accounts} current={current} fallback={fallback} setCurrent={setCurrent} setDefault={setDefault} />
        <span className={s.end}><Pill tone={tone} live>{status}</Pill></span>
      </div>
      <div className={job ? `${s.now} ${s.nowBusy}` : s.now}>
        <div className={s.nowText}>{job?.taskName ?? app.currentTask ?? "空闲"}</div>
        <Muted>{job ? [job.accountName, jobSource(job)].filter(Boolean).join(" · ") : app.observed ? `游戏里登录着 ${app.observed.nickname}` : "没有正在运行的任务"}</Muted>
        {waiting && waitNext(waiting) && <p className={s.waitNext}>{waiting.text} · {waitNext(waiting)}</p>}
      </div>
      <div className={s.actions}>{job && <JobControls job={job} small />}<Link to={paths.app(device.id, app.key)} className={`${s.end} ${s.semi}`}>进入应用</Link></div>
    </Card>
  );
}

/** Jobs not running yet: those queued on this device's apps, and those still waiting for any app of this game. */
function Waiting({ device, gameId, apps, jobs }: { device: Device; gameId: string; apps: App[]; jobs: Job[] }) {
  const queued = apps.flatMap((app) => appJobs(jobs, device.id, app.key).queued.map((job) => ({ job, where: waitReason(job) || `排在${app.name}后面` })));
  const waiting = jobs.filter((job) => job.state === "WAITING" && job.targetId === gameId)
    .map((job) => ({ job, where: `${waitReason(job) || "等可用设备"}${job.latestStartAt ? `，最晚 ${clock(job.latestStartAt)} 前开始` : ""}` }));
  const rows = [...queued, ...waiting];
  if (!rows.length) return null;
  return (
    <Card as="section" flush aria-labelledby="waiting" className={s.half}>
      <CardTitle id="waiting">排队与等待</CardTitle>
      {rows.map(({ job, where }) => (
        <Row key={job.id}>
          <Grow><Link to={paths.job(job.id)} className={s.plain}><b className={s.semi}>{job.taskName}</b> · {job.accountName ?? "—"}</Link><br /><Muted as="span">{jobSource(job)}</Muted></Grow>
          <Muted as="span" className={s.where}>{where}</Muted>
        </Row>
      ))}
    </Card>
  );
}

function RunNow({ device, apps, accounts }: { device: Device; apps: App[]; accounts: GameAccount[] }) {
  const { data } = useConsole();
  const [where, setWhere] = useState("");
  const [chosen, setChosen] = useState<string | null>(null);
  const { notes, busy, run, clear } = useRunNow();
  const app = apps.find((item) => item.key === where);
  const pick = accounts.some((item) => item.id === chosen) ? chosen! : accounts[0]?.id ?? "";
  const tasks = device.tasks.filter((task) => task.targetId === apps[0]?.gameId);
  // Free: an app signed in to another account would switch to this one first, which is Pro.
  // Left to the server, the same unless some app of this game is signed in to it.
  const switchLocked = useSwitchLocked(apps[0]?.gameId, pick || undefined, app);
  return (
    <Card as="section" flush aria-labelledby="run-now" className={s.half}>
      <CardTitle id="run-now">立即运行</CardTitle>
      {accounts.length === 0 ? <Muted className={s.cardNote}>先添加账号</Muted> : (
        <>
          <Row>
            <Field inline label="应用">
              <TextSelect label="在哪个应用运行" value={where} options={[["", "自动分配"], ...apps.map((item): [string, string] => [item.key, item.name])]} onChange={(key) => {
                const next = apps.find((item) => item.key === key);
                setWhere(key); if (next?.accountId && accounts.some((item) => item.id === next.accountId)) setChosen(next.accountId); clear();
              }} />
            </Field>
            <Field inline label="账号">
              <AccountSelectRequired value={pick} accounts={accounts} onChange={(id) => { setChosen(id); clear(); }} />
            </Field>
            {app && !switchLocked && switchNote(app, pick, accounts) && <Muted as="span" className={s.full}>{switchNote(app, pick, accounts)}</Muted>}
          </Row>
          {switchLocked && <ProLockRow compact name="自动切号" label={`切到${accounts.find((item) => item.id === pick)?.name ?? "这个账号"}跑`} />}
          <RunTaskRows
            tasks={tasks}
            games={data.games}
            account={accounts.find((item) => item.id === pick)}
            jobs={data.jobs}
            deviceId={device.id}
            appKey={app?.key}
            busy={busy}
            notes={notes}
            locked={switchLocked}
            onRun={(task) => run(task, pick, app ? { deviceId: device.id, appKey: app.key } : null)}
          />
        </>
      )}
    </Card>
  );
}

function AccountSelectRequired({ value, accounts, onChange }: { value: string; accounts: GameAccount[]; onChange: (id: string) => void }) {
  return <TextSelect label="运行用的游戏账号" value={value} onChange={onChange} options={accounts.map((item): [string, string] => [item.id, item.name])} />;
}
