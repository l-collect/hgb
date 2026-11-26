import { api, ApiFailure, apiUrl, enc } from "../../api/client";

/** The developer workbench's server API (/api/dev). Drafts are the compact published form, edited by node patches. */

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type Obj = { [key: string]: Json };

export interface DraftSummary { target: string; baseVersion: string; revision: number; updatedAt: number }
/** [bases]: node digests of the tasks and snippets as imported, keyed `tasks/<id>` and `snippets/<id>`. */
export interface DraftView { target: string; baseVersion: string; revision: number; body: Obj; bases: Record<string, string> }
/** A task's newest finished trial; [digest] is the task's node digest when it ran. */
export interface TrialRecord { task: string; step: string | null; device: string; state: string; detail: string; startedAt: number; endedAt: number; digest: string }
export interface DriftWarning { state: string; kind: string; subject: string; observed: string; threshold: string; hits: number; lastSeenAt: number; source: string }
/**
 * [base]: the node's digest when editing it began (shallowDigest for set, nodeDigest for put and delete); given, the
 * server judges the conflict by it instead of [expect]. A second patch on the same node in one batch takes [expect].
 */
export interface DraftPatch { op: "set" | "put" | "delete" | "insert"; path: string; value?: Json; field?: string; after?: string | null; expect?: string; base?: string }
/** [current]: the node as stored now (with its [digest] and [shallowDigest]); [mine]: what the patch wanted to write. */
export interface PatchConflict { path: string; reason: string; current?: Json; digest?: string | null; shallowDigest?: string | null; mine?: Json }
export interface PatchResult { revision: number; conflicts: PatchConflict[]; message?: string | null }
/** What 从仓库同步 did: with keepMine, [kept] are the nodes left as the author had them, [conflicts] those the repository changed too. */
export interface SyncResult { revision: number; kept?: string[]; conflicts?: { path: string; reason: string }[]; snapshot?: string | null }
/** A copy of the draft kept before a sync or restore ([reason] sync | restore | manual). */
export interface DraftSnapshot { id: string; target: string; revision: number; baseVersion: string; reason: string; at: number; tasks: number; snippets: number }
/** One script checked ([task] with [step], or [snippet]); [target] + [revision] let a newer check make an older one give up. */
export interface CheckRequest { bundle: Obj; task?: string; step?: string; snippet?: string; target?: string; revision?: number; measure?: boolean }
export interface Capability { id: string; version: number; inputs: Record<string, string>; outputs: Record<string, string>; role: string; sendsInput: boolean; optional: string[] }
/** Where an issue is, as the server reads its location: what the editor can jump to; [line] is the script's line (1-based). */
export interface IssueWhere { target?: string | null; task?: string | null; step?: string | null; snippet?: string | null; line?: number | null }
export interface CheckIssue { location: string; reason: string; where?: IssueWhere | null;
  /** Older servers' mark on an issue that only warns; newer ones list warnings apart ([CheckResult.warnings]). */ severity?: string }
/** One way a 按设置 goes: [test] equals / contains ([value]), range ([atLeast]..[atMost]), missing (没有值) or otherwise (其他). */
export interface SettingCase { test: string; value?: Json; atLeast?: Json; atMost?: Json; line?: number | null; location?: string | null }
/**
 * One place a setting is read (the engine's SettingUse). [kind]: branch | repeat | until | input | runWhen | trigger.
 * [location] is the script line when a script, else the program path ([path] always). For input: [capability], [input],
 * [scale] (1000: seconds read as milliseconds). [default]: `{x|3}`'s 3.
 */
export interface SettingUse { field: string; kind: string; location: string; path: string; task?: string | null; step?: string | null; snippet?: string | null;
  line?: number | null; capability?: string | null; input?: string | null; scale?: number | null; default?: Json; cases?: SettingCase[] }
/** [ok] counts [issues] only; [warnings] (same shape) never block a publish. [settingUses] covers what was checked ([scope]). */
export interface CheckResult { ok: boolean; issues: CheckIssue[]; tasks: number; publishedBytes: number; expandedBytes: number;
  scope?: string; warnings?: CheckIssue[]; settingUses?: SettingUse[] }
export interface CompiledWait { key: string; label: string; states: Obj[] }
export interface DevMe { maintainer: boolean | null; samples: number; sampleBytes: number; sampleQuota: number; serverRecognizer?: boolean }
export interface SampleText { text: string; box: number[] }
export interface Sample { id: string; target: string; name: string; device: string; width: number; height: number; bytes: number; createdAt: number;
  texts: SampleText[]; privateRegions: number[][]; recognized: boolean }
export interface Template { id: string; assetName: string; bytes: number; sha256: string; width: number; height: number; sample: string | null; rect: number[]; sameAs: string[] }
export interface DevTrace { step: string; action: string; capability: string; result: string; reason?: string; elapsedMs: number; trace?: Obj }
export interface DevFrame {
  step: string; action: string; atMs: number; lookMs: number; matched: string[]; held?: string | null;
  conditions: Json[]; referenceWidth: number; referenceHeight: number; frameWidth: number; frameHeight: number;
  tap?: number[] | null; tapRegion?: number[] | null; thumb?: string | null;
}
/**
 * [phase]: queued (the server's queue, [queuePosition] 1 = next) → preparing (compiling) → sent (on its way to the phone)
 * → running → done; older servers leave it empty. [source]: web | phone, whoever started it.
 */
export interface DevRun { id: string; kind: string; device: string; target: string; state: string; detail: string; createdAt: number; updatedAt: number; task?: string | null; step?: string | null; sample?: string | null; screen?: boolean; frameCount?: number; framesUploaded?: boolean; stopping?: boolean;
  facts: { type: string; detail: string }[]; traces: DevTrace[]; source?: string; phase?: string; queuePosition?: number | null }
export interface PublishResult { version: string; published: boolean; bundleBytes: number; uploads: { id: string; assetName: string; bytes: number }[];
  reused: { id: string; assetName: string; bytes: number; release?: string }[]; uploadBytes: number; commitSha?: string | null }

/** A refused request with everything the server said ([data]: an IssuesError's issues, a 409's conflicts…). */
export class DevFailure extends ApiFailure {
  constructor(status: number, code: string, message: string, readonly data: Obj | null) { super(status, code, message); }
}
/** Like [api], keeping the whole refusal and taking a [signal] to give up; a request given up throws the AbortError as it is. */
async function call<T>(path: string, options: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const { method = "GET", body, signal } = options;
  const headers: Record<string, string> = { "X-YYS-Request": "1" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  let reply: Response;
  try { reply = await fetch(apiUrl(path), { method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: "include", signal }); }
  catch (error) { if (signal?.aborted) throw error; throw new ApiFailure(0, "network", "无法连接服务器，请检查网络"); }
  const data = reply.status === 204 ? null : await reply.json().catch(() => null);
  if (!reply.ok) throw new DevFailure(reply.status, data?.code ?? "error", data?.message ?? "操作失败，请稍后再试", data && typeof data === "object" ? data : null);
  return data as T;
}
/** A fresh id for a run, so its events can be followed before the server answers. */
export function runId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16)); b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
/** The check's queue was full or took too long (503 queue_full / queue_timeout): worth one more try a little later. */
export const queued = (error: unknown) => error instanceof ApiFailure && error.status === 503 && (error.code === "queue_full" || error.code === "queue_timeout" || error.code === "busy");
/** A check given up for a newer one (409 superseded / stale, or aborted here): nothing to show. */
export const dropped = (error: unknown) => (error instanceof DOMException && error.name === "AbortError")
  || (error instanceof ApiFailure && error.status === 409 && (error.code === "superseded" || error.code === "stale"));
/** The issues a refused trial (400 invalid_draft) listed, each with where it is. */
export const issuesOf = (error: unknown): CheckIssue[] => error instanceof DevFailure && Array.isArray(error.data?.issues) ? error.data!.issues as unknown as CheckIssue[] : [];

export const dev = {
  me: () => api<DevMe>("/api/dev/me"),
  catalog: () => api<Capability[]>("/api/dev/catalog"),
  drafts: () => api<DraftSummary[]>("/api/dev/drafts"),
  draft: (target: string) => api<DraftView>(`/api/dev/drafts/${enc(target)}`),
  waits: (target: string) => api<CompiledWait[]>(`/api/dev/drafts/${enc(target)}/waits`),
  /** [keepMine]: tasks, snippets and the rest changed here stay as they are (a snapshot is kept first either way). */
  importLatest: (target: string, keepMine = true) => api<SyncResult>(`/api/dev/drafts/${enc(target)}/import-latest`, { method: "POST", body: { keepMine } }),
  snapshots: (target: string) => api<DraftSnapshot[]>(`/api/dev/drafts/${enc(target)}/snapshots`),
  saveSnapshot: (target: string) => api<DraftSnapshot>(`/api/dev/drafts/${enc(target)}/snapshots`, { method: "POST", body: {} }),
  restoreSnapshot: (target: string, id: string) => api<SyncResult>(`/api/dev/drafts/${enc(target)}/snapshots/${enc(id)}/restore`, { method: "POST", body: {} }),
  /** A refused batch (409) comes back as its result, with each conflict's two sides. */
  patch: async (target: string, patches: DraftPatch[]) => {
    try { return await call<PatchResult>(`/api/dev/drafts/${enc(target)}/patches`, { method: "POST", body: { source: "web", patches } }); }
    catch (error) {
      if (error instanceof DevFailure && error.status === 409 && Array.isArray(error.data?.conflicts)) return error.data as unknown as PatchResult;
      throw error;
    }
  },
  /** A bare bundle checks everything; a [CheckRequest] one script. */
  check: (body: Obj | CheckRequest, signal?: AbortSignal) => call<CheckResult>("/api/dev/check", { method: "POST", body, signal }),
  trials: (target: string) => api<TrialRecord[]>(`/api/dev/games/${enc(target)}/trials`),
  driftWarnings: (target: string) => api<DriftWarning[]>(`/api/dev/games/${enc(target)}/drift-warnings`),
  clearDriftWarnings: (target: string, item?: { state: string; kind: string; subject: string }) =>
    api(`/api/dev/games/${enc(target)}/drift-warnings` + (item ? `?state=${enc(item.state)}&kind=${enc(item.kind)}&subject=${enc(item.subject)}` : ""), { method: "DELETE" }),
  samples: (target: string) => api<Sample[]>(`/api/dev/games/${enc(target)}/samples`),
  /** A screenshot from elsewhere as a sample: a PNG as it is, anything else redrawn as one (a redrawn PNG is often much larger). */
  uploadSample: async (target: string, file: File) => {
    const name = file.name.replace(/\.[^.]+$/, "").slice(0, 64) || "上传的图";
    const path = `/api/dev/games/${enc(target)}/samples?name=${enc(name)}&device=${enc("上传")}`;
    if (file.type === "image/png") return api<Sample>(path, { method: "POST", body: file });
    const bitmap = await createImageBitmap(file);
    const canvas = Object.assign(document.createElement("canvas"), { width: bitmap.width, height: bitmap.height });
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0);
    const png = await new Promise<Blob>((done, fail) => canvas.toBlob((b) => b ? done(b) : fail(new Error("图片转换失败")), "image/png"));
    return api<Sample>(path, { method: "POST", body: png });
  },
  sampleImage: (id: string) => apiUrl(`/api/dev/samples/${enc(id)}/image`),
  /** Reads every text on the sample on the server, with the phone's recognizer: no phone needed. */
  recognizeSample: (id: string) => api<Sample>(`/api/dev/samples/${enc(id)}/recognize`, { method: "POST" }),
  changeSample: (id: string, change: { name?: string; privateRegions?: number[][] }) => api<Sample>(`/api/dev/samples/${enc(id)}`, { method: "PATCH", body: change }),
  deleteSample: (id: string) => api(`/api/dev/samples/${enc(id)}`, { method: "DELETE" }),
  templates: (target: string) => api<Template[]>(`/api/dev/games/${enc(target)}/templates`),
  templateImage: (target: string, id: string) => apiUrl(`/api/dev/games/${enc(target)}/templates/${enc(id)}/image`),
  cut: (target: string, cut: { id: string; sample: string; rect: number[]; confirmedTexts: string[]; reason?: string; maskBackground?: boolean; maskTolerance?: number }) =>
    api<Template>(`/api/dev/games/${enc(target)}/templates`, { method: "POST", body: cut }),
  deleteTemplate: (target: string, id: string) => api(`/api/dev/games/${enc(target)}/templates/${enc(id)}`, { method: "DELETE" }),
  /** [id]: made here ([runId]) to follow the run's events before this answers; a refused trial throws its issues ([issuesOf]). */
  startRun: (start: { id?: string; kind: string; target: string; device: string; task?: string; step?: string; sample?: string; states?: Json[]; name?: string; configuration?: Obj }) =>
    call<DevRun>("/api/dev/runs", { method: "POST", body: start }),
  run: (id: string) => api<DevRun>(`/api/dev/runs/${enc(id)}`),
  /** The author's recent commands, newest first (kept for a few hours, across restarts of the server). */
  runs: () => api<DevRun[]>("/api/dev/runs"),
  /** The screen an unfinished trial stopped on, kept with the run for a few hours. */
  runScreen: (id: string) => apiUrl(`/api/dev/runs/${enc(id)}/screen`),
  runFrames: (id: string) => api<DevFrame[]>(`/api/dev/runs/${enc(id)}/frames`),
  /** Asks the phone to send the stopped-on screen again; it comes as a dev-run event (409 still_running / device_offline). */
  resendScreen: (id: string) => api(`/api/dev/runs/${enc(id)}/screen/resend`, { method: "POST", body: {} }),
  keepRunScreen: (id: string) => api<Sample>(`/api/dev/runs/${enc(id)}/screen/keep`, { method: "POST" }),
  /** Tells the phone to update its App now (silently once it has updated itself before; otherwise it asks on the phone). */
  updateApp: (device: string) => api(`/api/dev/devices/${enc(device)}/app-update`, { method: "POST", body: {} }),
  /** Asks the phone to stop the trial where it is; it then reports how far it got, with the screen it stopped on. */
  stopRun: (id: string) => api<DevRun>(`/api/dev/runs/${enc(id)}/stop`, { method: "POST", body: {} }),
  /** The phone's screen as it is now, whatever it is doing, as an object URL (revoke it when done). */
  peek: async (device: string): Promise<string> => {
    let reply: Response;
    try { reply = await fetch(apiUrl(`/api/dev/devices/${enc(device)}/peek`), { method: "POST", headers: { "X-YYS-Request": "1" }, credentials: "include" }); }
    catch { throw new ApiFailure(0, "network", "无法连接服务器，请检查网络"); }
    if (!reply.ok) { const data = await reply.json().catch(() => null); throw new ApiFailure(reply.status, data?.code ?? "error", data?.message ?? "没取到画面"); }
    return URL.createObjectURL(await reply.blob());
  },
  publish: (target: string, request: { version: string; changelog: string; minApp: string; dryRun: boolean }) =>
    api<PublishResult>(`/api/dev/drafts/${enc(target)}/publish`, { method: "POST", body: request }),
};

/** Waits for a run to finish, polling; [seen] gets each state as it comes. */
export async function follow(id: string, seen: (run: DevRun) => void, limitMs = 35 * 60_000): Promise<DevRun> {
  const until = Date.now() + limitMs;
  for (;;) {
    const run = await dev.run(id);
    seen(run);
    if (run.state !== "SENT" && run.state !== "RUNNING") return run;
    if (Date.now() > until) return run;
    await new Promise((done) => setTimeout(done, 2000));
  }
}

/** One sample judged against pages on the server: whether each page holds there, with its best score. */
export interface JudgeRow { sample: string; sampleName: string; results: JudgeCell[] }
/** [unknown]: the server cannot tell (a template to match…), [why] says what decided it. */
export interface JudgeCell { page: string; holds: boolean; score?: number | null; unknown?: boolean | null; why?: string | null }
export interface JudgeResult { server: boolean; rows: JudgeRow[] }
/**
 * Judges pages on samples on the server in one request ([pages] / [samples] null = all). Null when the server cannot
 * read screens (501 no_recognizer) or does not judge yet (a 404 with no code: the route is missing): the caller then asks
 * the phone, one sample at a time. Any other failure (no_sample, no_target…) is thrown for the page to show.
 */
export async function judgeOnServer(target: string, pages: string[] | null, samples: string[] | null): Promise<JudgeResult | null> {
  try { return await api<JudgeResult>(`/api/dev/games/${enc(target)}/judge`, { method: "POST", body: { pages, samples } }); }
  catch (error) {
    if (error instanceof ApiFailure && ((error.status === 501 && error.code === "no_recognizer") || (error.status === 404 && error.code === "error"))) return null;
    throw error;
  }
}
/** The draft as it was imported or last published (to show what changed), when the server keeps it; null otherwise. */
export async function draftBase(target: string): Promise<Obj | null> {
  try { const view = await api<{ body: Obj }>(`/api/dev/drafts/${enc(target)}/base`); return view?.body ?? null; }
  catch (error) { if (error instanceof ApiFailure && (error.status === 404 || error.status === 501)) return null; throw error; }
}
