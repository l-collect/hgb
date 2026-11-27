import { useState } from "react";
import type { App, AppWaiting, Device } from "../../api/types";
import { Breadcrumb, Card, Empty, Grow, Muted, PageTabs, Pill, Row, Segments, TextSelect } from "../../components/ui";
import { appStatus, jobSource, jobStatus, waitNext, waitReason } from "../../format";
import { Link, navigate, paths, useQuery } from "../../router";
import { useConsole } from "../../state/context";
import { ProLockRow, usePro } from "../../components/Pro";
import { NotFound } from "../ConsolePage";
import { appJobs, JobControls, RunRows, switchNote, useRunNow } from "../jobs/runs";
import { RunTaskRows } from "../library/LibraryPage";
import { AccountMenu, Observed, useAppAccounts } from "./appAccounts";
import s from "./Devices.module.css";

/** 应用详情 at its own address; a phone's device page shows this for its first app. */
export function AppPage({ deviceId, appKey }: { deviceId: string; appKey: string }) {
  const { data } = useConsole();
  const device = data.devices.find((item) => item.id === deviceId);
  const app = device?.apps.find((item) => item.key === appKey);
  if (!device) return <NotFound text="找不到这台设备，它可能已经解绑" />;
  if (!app) return <NotFound text="这台设备上没有这个应用" back={paths.device(device.id)} backText="回到设备" />;
  return <AppDetail device={device} app={app} base={paths.app(device.id, app.key)} />;
}

/** One game instance on a device: its accounts behind a gear, what it runs now and what is queued, and running a task on it. */
/** What the phone waits for and what to do about it, as a bar above the page (等无障碍 · 在手机上重新开启无障碍). */
export function WaitBanner({ waiting }: { waiting: AppWaiting }) {
  return <p className={s.waitBanner} role="status"><b>{waiting.text}</b>{waitNext(waiting) && <span>{waitNext(waiting)}</span>}</p>;
}

export function AppDetail({ device, app, base }: { device: Device; app: App; base: string }) {
  const { data } = useConsole();
  const tab = useQuery().get("tab") === "runs" ? "runs" : "run";
  const phone = device.platform.toLowerCase() === "android";
  const accounts = data.accounts.filter((account) => account.gameId === app.gameId);
  const { current, fallback, setCurrent, setDefault } = useAppAccounts(device, app);
  const { current: job } = appJobs(data.jobs, device.id, app.key);
  // The job it runs, read the one way every page reads it (卡住 · 等无障碍, 正在暂停, 已暂停 …), says more than the app's phase.
  const [status, tone] = job && device.online ? jobStatus(job, data.devices) : appStatus(app.phase, device.online, app.waiting);
  const waiting = device.online ? app.waiting : null;
  return (
    <>
      <Breadcrumb items={[["设备", paths.devices], [device.name, phone ? null : paths.device(device.id)], [app.name, null]]} />
      {phone && device.apps.length > 1 && (
        <Segments role="radiogroup" label="这台手机的应用" value={app.key} onChange={(key) => navigate(key === device.apps[0].key ? paths.device(device.id) : paths.app(device.id, key))}
          items={device.apps.map((item) => [item.key, item.name])} />
      )}
      <header className={s.appHeader}>
        <h1 className={s.title}>{app.name}</h1>
        <AccountMenu app={app} accounts={accounts} current={current} fallback={fallback} setCurrent={setCurrent} setDefault={setDefault} />
        <span className={s.end}><Pill tone={tone} dot>{status}</Pill></span>
      </header>
      {waiting && <WaitBanner waiting={waiting} />}
      <Observed app={app} accounts={accounts} />
      <PageTabs label="应用内容" value={tab} tabs={[["run", "运行", base], ["runs", "战报", `${base}?tab=runs`]]} />
      {tab === "run" ? <RunTab device={device} app={app} /> : (
        <Card flush>
          {(() => {
            const mine = data.jobs.filter((item) => item.deviceId === device.id && item.appKey === app.key);
            return mine.length ? <RunRows jobs={mine} devices={data.devices} columns={["account", "source"]} /> : <Empty>还没有战报</Empty>;
          })()}
        </Card>
      )}
    </>
  );
}

function RunTab({ device, app }: { device: Device; app: App }) {
  const { data } = useConsole();
  const { current: job, queued } = appJobs(data.jobs, device.id, app.key);
  const accounts = data.accounts.filter((account) => account.gameId === app.gameId);
  const tasks = device.tasks.filter((task) => task.targetId === app.gameId);
  const [chosen, setChosen] = useState<string | null>(null);
  const pick = accounts.some((item) => item.id === chosen) ? chosen! : (app.accountId && accounts.some((item) => item.id === app.accountId) ? app.accountId : accounts[0]?.id ?? "");
  const { notes, busy, run, clear } = useRunNow();
  // Free: running another account than the one signed in means switching to it first, which is Pro.
  const switchLocked = usePro().locked("allowAutoAccountSwitch") && !!pick && app.accountId !== pick;
  const pickName = accounts.find((item) => item.id === pick)?.name ?? "这个账号";
  const note = [pick && !switchLocked ? switchNote(app, pick, accounts) : null, device.online ? null : "设备离线，30 分钟内上线才执行"].filter(Boolean).join("；");
  // An idle, online app has nothing to show here: the header already says 空闲.
  const showNow = job || queued.length > 0 || app.currentTask || !device.online;
  return (
    <>
      {showNow && (
        <Card as="section" aria-label="当前运行" flush className={job ? s.currentBusy : undefined}>
          <div className={s.current}>
            {job ? (
              <>
                <div className={s.currentHead}><b>{job.taskName}</b><Pill tone={jobStatus(job, data.devices)[1]} live>{jobStatus(job, data.devices)[0]}</Pill><Link to={paths.job(job.id)} className={s.end}>步骤明细 ›</Link></div>
                <Muted>{[job.accountName, jobSource(job), job.detail].filter(Boolean).join(" · ")}</Muted>
                <div className={s.actions}><JobControls job={job} small /></div>
              </>
            ) : (
              <>
                <div className={s.currentHead}><b>{app.currentTask ?? (device.online ? "空闲" : "离线")}</b></div>
                {app.currentTask ? <Muted>非控制台发起，这里不能停</Muted> : !device.online && <Muted>上线后才会收到任务</Muted>}
              </>
            )}
          </div>
          {queued.map((item) => (
            <Row key={item.id}><Muted as="span">接下来</Muted><Grow><Link to={paths.job(item.id)} className={s.plain}>{item.taskName} · {item.accountName ?? "—"}</Link></Grow>{waitReason(item) && <span className={s.waitNext}>{waitReason(item)}</span>}<Muted as="span">{jobSource(item)}</Muted></Row>
          ))}
        </Card>
      )}
      <Card as="section" flush aria-label="运行">
        {accounts.length > 0 && (
          <div className={s.choiceLine}>用
            <TextSelect label="运行用的游戏账号" value={pick} onChange={(id) => { setChosen(id); clear(); }} options={accounts.map((item): [string, string] => [item.id, item.name])} />运行
          </div>
        )}
        {accounts.length === 0 ? <Muted className={s.cardNote}>先添加账号</Muted> : (
          <>
            {switchLocked && <ProLockRow compact name="自动切号" label={`切到${pickName}跑`} />}
            {note && <Muted className={s.cardNote}>{note}</Muted>}
            {tasks.length ? (
              <RunTaskRows
                tasks={tasks}
                games={data.games}
                account={accounts.find((item) => item.id === pick)}
                jobs={data.jobs}
                deviceId={device.id}
                appKey={app.key}
                busy={busy}
                notes={notes}
                locked={switchLocked}
                onRun={(task) => run(task, pick, { deviceId: device.id, appKey: app.key })}
              />
            ) : <Muted className={s.cardNote}>设备未上报任务</Muted>}
          </>
        )}
      </Card>
    </>
  );
}
