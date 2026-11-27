import type { AppWaiting, Device, Job, JobEvent, JobState, Plan, PlanRunState } from "./api/types";

export type Tone = "" | "ok" | "info" | "warn" | "bad";
/**
 * The one table of what colour a state is, the same on the App (shared/ui/Format.kt): 运行中 blue; 排队 and 等待中 grey
 * (why they wait is warn text); 完成 green; 失败 red, its reason box and failed step too; 待核对, 卡住 and 已暂停 orange;
 * 已取消 and 已跳过 grey. Settings (执行 / 跳过, 单独设置 / 跟随账号) are not states: they use [CONFIG_TONE].
 */
export const STATE_TONES = {
  running: "info", queued: "", waiting: "", done: "ok", failed: "bad", partial: "bad", unknown: "warn", stuck: "warn",
  paused: "warn", pausing: "warn", stopping: "warn", cancelled: "", skipped: "", idle: "ok", offline: "",
} as const satisfies Record<string, Tone>;
/** A setting's two sides (执行 / 跳过, 单独设置 / 跟随账号): soft violet for the one that is set, grey for the other. */
export const CONFIG_TONE = { set: "soft", unset: "" } as const;
export const JOB_STATES: Record<JobState, [string, Tone]> = {
  // 已下发 (LEASED) reads as 运行中: the device has it and is starting.
  WAITING: ["等待中", STATE_TONES.waiting], QUEUED: ["排队", STATE_TONES.queued], LEASED: ["运行中", STATE_TONES.running], RUNNING: ["运行中", STATE_TONES.running],
  COMPLETED: ["完成", STATE_TONES.done], FAILED: ["失败", STATE_TONES.failed], UNKNOWN: ["待核对", STATE_TONES.unknown],
  CANCELLED: ["已取消", STATE_TONES.cancelled], SKIPPED: ["已跳过", STATE_TONES.skipped],
};
/** A plan's latest firing, as a pill. */
export const PLAN_RUN_STATES: Record<PlanRunState, [string, Tone]> = {
  UNKNOWN: ["待核对", STATE_TONES.unknown], ACTIVE: ["运行中", STATE_TONES.running], COMPLETED: ["完成", STATE_TONES.done], PARTIAL_FAILED: ["部分失败", STATE_TONES.partial],
  FAILED: ["失败", STATE_TONES.failed], CANCELLED: ["已取消", STATE_TONES.cancelled], SKIPPED: ["已跳过", STATE_TONES.skipped],
};
export const ACTIVE = new Set<JobState>(["WAITING", "QUEUED", "LEASED", "RUNNING"]);
export const PHASES: Record<string, string> = {
  CONNECTING: "连接中", IDLE: "空闲", DEVELOPING: "调试中", RUNNING: "运行中", PAUSING: "正在暂停", PAUSED: "已暂停", REMOVING: "正在停止", SWITCHING: "切换中", BLOCKED_UNKNOWN: "待核对",
};
export const dateTime = (value: number | null | undefined) => value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "—";
export const clock = (value: number) => new Date(value).toLocaleTimeString("zh-CN", { hour12: false });

export const WEEK = ["一", "二", "三", "四", "五", "六", "日"];
export const clockText = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
export function planRule(plan: Pick<Plan, "days" | "minuteOfDay" | "jitterMinutes">): string {
  const days = plan.days.length === 7 ? "每天" : `每周${plan.days.map((day) => WEEK[day - 1]).join("、")}`;
  const jitter = plan.jitterMinutes && plan.jitterMinutes > 0 ? ` · ±${plan.jitterMinutes}分` : "";
  return `${days} ${clockText(plan.minuteOfDay)}${jitter}`;
}

const EVENT_KINDS: Record<string, string> = {
  "enqueued": "已排队", "step-started": "开始步骤", "step-observed": "步骤结果", "step-completed": "步骤完成", "task-completed": "任务完成",
  "task-failed": "任务失败", "task-restarted": "任务重来", "run-ended": "运行结束", "cancelled": "已取消", "input-unconfirmed": "待核对",
  "result-resolved": "结果已确认", "revocation-observed": "停止确认", "action": "动作", "task-event": "上报事件",
};
const ACTION_RESULTS: Record<string, string> = { PRODUCED: "完成", VERIFIED: "核对通过", UNAVAILABLE: "未通过", INTERRUPTED: "中断" };
export const eventKind = (kind: string) => EVENT_KINDS[kind] ?? kind;
/** Makes the executor's wording readable without changing what it says. */
const RUN_ENDS: Record<string, string> = { COMPLETED: "完成", FAILED: "失败", CANCELLED: "已取消", UNKNOWN: "待核对", INTERRUPTED: "已中断" };
export function eventDetail(event: JobEvent): string {
  if (event.kind === "action") {
    const [result, ...rest] = event.detail.split("：");
    return [ACTION_RESULTS[result] ?? result, rest.join("：")].filter(Boolean).join("：");
  }
  // A run's end names its state the device's way (COMPLETED, FAILED, …).
  if (event.kind === "run-ended") return RUN_ENDS[event.detail] ?? event.detail;
  return event.detail.replace(/^Completed\(evidence=(.*)\)$/, "完成：$1").replace(/^Unknown\(reason=(.*)\)$/, "待核对：$1")
    .replace(/^Failed\(reason=(.*)\)$/, "失败：$1").replace(/^Interrupted$/, "已中断");
}

/** A plan's days, short as the design writes them: 每天 / 工作日 / 周末 / 周五六日, then · ±N分. */
export function cycleText(days: number[], jitterMinutes?: number): string {
  const sorted = [...days].sort();
  const key = sorted.join("");
  const text = key === "1234567" ? "每天" : key === "12345" ? "工作日" : key === "67" ? "周末" : `周${sorted.map((day) => WEEK[day - 1]).join("")}`;
  return jitterMinutes && jitterMinutes > 0 ? `${text} · ±${jitterMinutes}分` : text;
}

/** An action's kind under the one set of names the App and the web share, and its pill colour (a kind, not a state: no state colours). */
export function actionKind(kind: string): [string, Tone | "soft"] {
  switch (kind) {
    case "look": return ["看画面", "soft"];
    case "act": return ["执动作", "soft"];
    case "nav": return ["去页面", "soft"];
    case "branch": return ["按配置", ""];
    case "loop": return ["循环流", ""];
    case "end": return ["写战报", ""];
    default: return ["控制流", ""];
  }
}

/** A time in a list: today shows the clock, yesterday says so, older ones add the date. */
export function shortTime(value: number | null | undefined): string {
  if (!value) return "—";
  const at = new Date(value); const now = new Date();
  const hm = at.toLocaleTimeString("zh-CN", { hour12: false, hour: "2-digit", minute: "2-digit" });
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((day(now) - day(at)) / 86400000);
  if (days === 0) return hm;
  if (days === 1) return `昨天 ${hm}`;
  return at.getFullYear() === now.getFullYear() ? `${at.getMonth() + 1}月${at.getDate()}日 ${hm}` : `${at.getFullYear()}年${at.getMonth() + 1}月${at.getDate()}日`;
}
/** A time ahead in two parts: the clock, and the day when it is not today (「明天」, 「12月3日」); for the hero card. */
export function nextParts(value: number): { day: string; hm: string } {
  const at = new Date(value); const now = new Date();
  const hm = `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((day(at) - day(now)) / 86400000);
  if (days <= 0) return { day: "", hm };
  if (days === 1) return { day: "明天", hm };
  return { day: at.getFullYear() === now.getFullYear() ? `${at.getMonth() + 1}月${at.getDate()}日` : `${at.getFullYear()}年${at.getMonth() + 1}月${at.getDate()}日`, hm };
}
/** A time ahead: today shows the clock, then 明天, then the date. */
export function nextTime(value: number): string {
  const at = new Date(value); const now = new Date();
  const hm = at.toLocaleTimeString("zh-CN", { hour12: false, hour: "2-digit", minute: "2-digit" });
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((day(at) - day(now)) / 86400000);
  if (days <= 0) return hm;
  if (days === 1) return `明天 ${hm}`;
  return `${at.getMonth() + 1}月${at.getDate()}日 ${hm}`;
}
export const seconds = (ms: number) => ms < 60000 ? `${Math.max(1, Math.round(ms / 1000))} 秒` : `${Math.floor(ms / 60000)} 分 ${Math.round((ms % 60000) / 1000)} 秒`;

const PLATFORMS: Record<string, string> = { android: "Android", windows: "Windows 桌面端", ios: "iOS" };
export const platformName = (platform: string) => PLATFORMS[platform.toLowerCase()] ?? platform;

/** The plan a job came from; empty for a run started by hand, which needs no saying. */
export const jobSource = (job: Job) => job.planName ? `计划 · ${job.planName}` : "";
/** The phase of the app a job runs on, as its device last said; null when unknown. */
export function jobPhase(job: Job, devices?: Device[]): string | null {
  if (!devices || !job.deviceId) return null;
  const device = devices.find((item) => item.id === job.deviceId);
  if (!device?.online) return null;
  return device.apps.find((app) => app.key === job.appKey)?.phase ?? device.phase ?? null;
}
/**
 * Whether a running job is paused, or asked to pause, by the web or on the phone itself: then the button says 继续. A
 * leased job whose phone says PAUSED counts too, as jobStatus shows it 已暂停.
 */
export const jobPaused = (job: Job, devices?: Device[]) => {
  const phase = jobPhase(job, devices);
  if (job.state === "LEASED") return phase === "PAUSED";
  return job.state === "RUNNING" && (job.pauseRequested || phase === "PAUSED" || phase === "PAUSING");
};
/** What the app a running job runs on waits for on the phone (等无障碍 …); null when nothing, or not known (offline: its apps are old news). */
export function jobWaiting(job: Job, devices?: Device[]): AppWaiting | null {
  if (!devices || !job.deviceId || job.state !== "RUNNING") return null;
  const device = devices.find((item) => item.id === job.deviceId);
  if (!device?.online) return null;
  return device.apps.find((app) => app.key === job.appKey)?.waiting ?? null;
}
/**
 * The job's state as the user should read it, the same in every place that shows one (战报行, 作业页, 设备卡, 账号头):
 * pending pause and cancel requests count, and with [devices] what its phone says too. A pause is 已暂停 only once the
 * device says so (正在暂停 until then), and one made on the phone shows too; a started job whose phone waits for
 * something (无障碍断开, 锁屏 …) is 「卡住 · 等无障碍」, not 运行中.
 */
export function jobStatus(job: Job, devices?: Device[]): [string, Tone] {
  const [label, tone] = JOB_STATES[job.state];
  if (job.cancelRequested && ACTIVE.has(job.state)) return ["正在停止", STATE_TONES.stopping];
  if (job.state === "RUNNING" || job.state === "LEASED") {
    const phase = jobPhase(job, devices);
    if (phase === "PAUSED") return ["已暂停", STATE_TONES.paused];
    if (job.state === "RUNNING" && (job.pauseRequested || phase === "PAUSING")) return ["正在暂停", STATE_TONES.pausing];
    const waiting = jobWaiting(job, devices);
    if (waiting) return [`卡住 · ${waiting.text}`, STATE_TONES.stuck];
  }
  return [label, tone];
}
/**
 * One line for a job seen from its account (账号头): 「卡住 · 等无障碍」, 「已暂停 · 手机」, 「运行中 · 手机」; the device is
 * left out when stuck, since what it waits for says more.
 */
export function jobHeadline(job: Job, devices?: Device[]): [string, Tone] {
  const [label, tone] = jobStatus(job, devices);
  if (label.startsWith("卡住") || !job.deviceName) return [label, tone];
  return [`${label} · ${job.deviceName}`, tone];
}
/** How long a started job has run so far, in whole minutes (「已跑 12 分」); null before it starts or after it ends. */
export function ranFor(job: Job, startedAt: number | null | undefined, now = Date.now()): string | null {
  if (!startedAt || (job.state !== "RUNNING" && job.state !== "LEASED")) return null;
  return `已跑 ${Math.max(0, Math.floor((now - startedAt) / 60000))} 分`;
}
/** What to do about what the phone waits for, in one line. */
const WAIT_NEXT: Record<string, string> = {
  accessibility: "在手机上重新开启无障碍", unlock: "解锁手机", game: "打开游戏", capture: "在手机上允许截图",
};
export const waitNext = (waiting: AppWaiting) => WAIT_NEXT[waiting.code] ?? "";
/** The first waiting app of an online device. */
export const deviceWaiting = (device: Device): AppWaiting | null => device.online ? device.apps.find((app) => app.waiting)?.waiting ?? null : null;
/** Why a job that has not started yet is held; empty when the server gave no reason. */
export const waitReason = (job: Job) => (job.state === "WAITING" || job.state === "QUEUED") && job.waitReason ? job.waitReason : "";
/** How an app is doing, as a pill; waiting for the phone (无障碍, 解锁 …) wins over its phase. */
export function appStatus(phase: string, online: boolean, waiting?: AppWaiting | null): [string, Tone] {
  if (!online) return ["离线", STATE_TONES.offline];
  if (waiting) return [waiting.text, STATE_TONES.stuck];
  const label = PHASES[phase] ?? phase;
  if (phase === "RUNNING" || phase === "SWITCHING") return [label, STATE_TONES.running];
  if (phase === "IDLE") return [label, STATE_TONES.idle];
  if (phase === "BLOCKED_UNKNOWN") return [label, STATE_TONES.unknown];
  if (phase === "PAUSED" || phase === "PAUSING" || phase === "REMOVING") return [label, STATE_TONES.paused];
  return [label, ""];
}
export const shortDuration = (ms: number) => ms < 10000 ? `${(ms / 1000).toFixed(1)} 秒` : seconds(ms);
