import { useState } from "react";
import { api, enc } from "../../api/client";
import type { App, Device, GameAccount, Job } from "../../api/types";
import { Button, Pill, RowLink } from "../../components/ui";
import { ask } from "../../components/Confirm";
import { orToast } from "../../components/useAction";
import { toast } from "../../components/Toast";
import { ACTIVE, jobPaused, jobSource, jobStatus, shortTime, waitReason } from "../../format";
import { paths } from "../../router";
import { useConsole } from "../../state/context";
import s from "./Jobs.module.css";

/** The jobs an app holds: the one it is running (or was just handed), then the ones queued behind it. */
export function appJobs(jobs: Job[], deviceId: string, appKey: string): { current: Job | null; queued: Job[] } {
  const mine = jobs.filter((job) => job.deviceId === deviceId && job.appKey === appKey && ACTIVE.has(job.state));
  const current = mine.find((job) => job.state === "RUNNING") ?? mine.find((job) => job.state === "LEASED") ?? null;
  return { current, queued: mine.filter((job) => job !== current).reverse() };
}
/** Where a job ran, as the list shows it: the device, and the app when the device has more than one. */
export function jobPlace(job: Job, devices: Device[]): string {
  if (!job.deviceName) return job.state === "WAITING" ? "等可用设备" : "—";
  const device = devices.find((item) => item.id === job.deviceId);
  const app = device && device.apps.length > 1 ? device.apps.find((item) => item.key === job.appKey) : undefined;
  return app ? `${job.deviceName} · ${app.name}` : job.deviceName;
}
export const lastFinished = (jobs: Job[], keep: (job: Job) => boolean) => jobs.find((job) => keep(job) && !ACTIVE.has(job.state)) ?? null;

export function jobCommand(job: Job, command: "pause" | "resume" | "cancel") {
  return orToast(() => api(`/api/jobs/${enc(job.id)}/${command}`, { method: "POST", body: {} }));
}

/**
 * What to say once a run is submitted, from the job the server made: 「已排进 {设备} · 查看」, or, when its device is
 * offline, that it waits for it; without a job (a plan's 立即运行) only 「已提交 · 查看」 to [fallback].
 */
export function runSubmitted(job: Job | null | undefined, devices: Device[], fallback: string = paths.devices) {
  if (!job?.id) { toast("已提交", { tone: "ok", link: { to: fallback, text: "查看" } }); return; }
  const link = { to: paths.job(job.id), text: "查看" };
  const device = devices.find((item) => item.id === job.deviceId);
  if ((device && !device.online) || job.waitReason === "设备离线") { toast("设备离线，30 分钟内上线才执行", { tone: "ok", link }); return; }
  toast(job.deviceName ? `已排进 ${jobPlace(job, devices)}` : "已提交", { tone: "ok", link });
}
/** Starts [job]'s task again for the same account; the server picks the app. */
export async function rerun(job: Job, devices: Device[]) {
  const made = await api<Job>("/api/jobs", { method: "POST", body: { targetId: job.targetId, taskId: job.taskId, accountId: job.accountId, deviceId: null, appKey: null } });
  runSubmitted(made, devices);
}
/** Stops a running job, or gives up an unconfirmed one, once the user agrees; a job still queued is cancelled at once. */
export async function stopJob(job: Job) {
  const question = job.state === "UNKNOWN" ? { title: "放弃本次？", body: "这一步按没做完算，手机腾出来", ok: "放弃" }
    : job.state === "RUNNING" ? { title: `停止「${job.taskName}」？`, body: "任务会停在当前这一步", ok: "停止" }
    : null;
  if (question && !await ask({ ...question, danger: true })) return;
  await jobCommand(job, "cancel");
}
/** Pause or resume, and stop (or cancel before it starts), for a job that is still going. */
export function JobControls({ job, small }: { job: Job; small?: boolean }) {
  const { data } = useConsole();
  const [busy, setBusy] = useState(false);
  if (job.cancelRequested) return null;
  // Paused on the phone itself counts too: 继续 works from here.
  const paused = jobPaused(job, data.devices);
  const command = async (what: "pause" | "resume") => { setBusy(true); try { await jobCommand(job, what); } finally { setBusy(false); } };
  // A result left unconfirmed holds the phone: giving it up takes the step as not done and frees the phone.
  if (job.state === "UNKNOWN") return <Button small={small} variant="danger" onClick={() => void stopJob(job)}>放弃本次</Button>;
  if (!ACTIVE.has(job.state)) return null;
  return (
    <>
      {job.state === "RUNNING" && <Button small={small} disabled={busy} onClick={() => void command(paused ? "resume" : "pause")}>{paused ? "继续" : "暂停"}</Button>}
      <Button small={small} variant="danger" onClick={() => void stopJob(job)}>{job.state === "RUNNING" ? "停止" : "取消"}</Button>
    </>
  );
}

export type RunColumn = "place" | "account" | "source";
/** Run records as rows that open the record. Newest first, as the server sends them. */
export function RunRows({ jobs, devices, columns, limit }: { jobs: Job[]; devices: Device[]; columns: RunColumn[]; limit?: number }) {
  const [all, setAll] = useState(false);
  const shown = limit && !all ? jobs.slice(0, limit) : jobs;
  return (
    <>
      {shown.map((job) => {
        const [label, tone] = jobStatus(job, devices);
        return (
          <RowLink key={job.id} to={paths.job(job.id)}>
            <span className={s.task}>{job.taskName}{!columns.includes("account") && job.accountName ? ` · ${job.accountName}` : ""}</span>
            {columns.includes("account") && <span className={`${s.cell} ${s.narrow}`}>{job.accountName ?? "—"}</span>}
            {columns.includes("place") && devices.length > 1 && <span className={`${s.cell} ${s.wide}`}>{jobPlace(job, devices)}</span>}
            {columns.includes("source") && <span className={s.cell}>{jobSource(job)}</span>}
            <span className={`${s.cell} ${s.time}`}>{shortTime(job.updatedAt)}</span>
            <span className={s.state}><Pill tone={tone} live={ACTIVE.has(job.state)}>{label}</Pill>{waitReason(job) && <span className={s.reason}>{waitReason(job)}</span>}</span>
          </RowLink>
        );
      })}
      {limit && jobs.length > limit ? <div className={s.more}><Button variant="link" onClick={() => setAll(!all)}>{all ? "收起" : `全部 ${jobs.length} 条`}</Button></div> : null}
    </>
  );
}

/**
 * Starts tasks now: a toast says where it went (「已排进 X · 查看」), and a refusal stays as a note beside the task.
 * [place] is the app to send it to, or none to let the server pick an app signed in to the account (or one that can
 * switch to it).
 */
export function useRunNow() {
  const { data } = useConsole();
  const [notes, setNotes] = useState<Record<string, { text: string; ok: boolean }>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (task: { targetId: string; taskId: string }, accountId: string, place: { deviceId: string; appKey: string } | null) => {
    const key = task.taskId; setBusy(key);
    setNotes((now) => { const next = { ...now }; delete next[key]; return next; });
    try {
      const job = await api<Job>("/api/jobs", { method: "POST", body: { targetId: task.targetId, taskId: task.taskId, accountId, deviceId: place?.deviceId ?? null, appKey: place?.appKey ?? null } });
      runSubmitted(job, data.devices);
    } catch (error) {
      setNotes((now) => ({ ...now, [key]: { text: error instanceof Error ? error.message : "提交失败", ok: false } }));
    } finally { setBusy(null); }
  };
  return { notes, busy, run, clear: () => setNotes({}) };
}
export function Note({ note }: { note?: { text: string; ok: boolean } }) {
  if (!note?.text) return null;
  return <span className={!note.ok ? s.noteBad : s.note} role="status">{note.text}</span>;
}

const nameOf = (accounts: GameAccount[], id: string | null) => accounts.find((item) => item.id === id)?.name ?? null;
/** Only when running [accountId] on [app] switches accounts (or cannot): what will happen, in one short line. */
export function switchNote(app: App, accountId: string, accounts: GameAccount[]): string | null {
  if (app.accountId === accountId) return null;
  const name = nameOf(accounts, accountId) ?? "这个账号";
  if (!app.switchable) return `${app.name}不能切号，需已登录${name}`;
  const back = nameOf(accounts, app.defaultAccountId);
  return `先切到${name}${back ? `，跑完切回${back}` : ""}`;
}
