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
export interface DraftPatch { op: "set" | "put" | "delete" | "insert"; path: string; value?: Json; field?: string; after?: string | null; expect?: string }
export interface PatchConflict { path: string; reason: string }
export interface PatchResult { revision: number; conflicts: PatchConflict[] }
export interface Capability { id: string; version: number; inputs: Record<string, string>; outputs: Record<string, string>; role: string; sendsInput: boolean; optional: string[] }
export interface CheckIssue { location: string; reason: string }
export interface CheckResult { ok: boolean; issues: CheckIssue[]; tasks: number; publishedBytes: number; expandedBytes: number }
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
export interface DevRun { id: string; kind: string; device: string; target: string; state: string; detail: string; createdAt: number; updatedAt: number; task?: string | null; step?: string | null; sample?: string | null; screen?: boolean; frameCount?: number; framesUploaded?: boolean; stopping?: boolean;
  facts: { type: string; detail: string }[]; traces: DevTrace[] }
export interface PublishResult { version: string; published: boolean; bundleBytes: number; uploads: { id: string; assetName: string; bytes: number }[];
  reused: { id: string; assetName: string; bytes: number; release?: string }[]; uploadBytes: number; commitSha?: string | null }

export const dev = {
  me: () => api<DevMe>("/api/dev/me"),
  catalog: () => api<Capability[]>("/api/dev/catalog"),
  drafts: () => api<DraftSummary[]>("/api/dev/drafts"),
  draft: (target: string) => api<DraftView>(`/api/dev/drafts/${enc(target)}`),
  waits: (target: string) => api<CompiledWait[]>(`/api/dev/drafts/${enc(target)}/waits`),
  importLatest: (target: string) => api<PatchResult>(`/api/dev/drafts/${enc(target)}/import-latest`, { method: "POST", body: {} }),
  patch: (target: string, patches: DraftPatch[]) => api<PatchResult>(`/api/dev/drafts/${enc(target)}/patches`, { method: "POST", body: { source: "web", patches } }),
  check: (body: Obj) => api<CheckResult>("/api/dev/check", { method: "POST", body }),
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
  startRun: (start: { kind: string; target: string; device: string; task?: string; step?: string; sample?: string; states?: Json[]; name?: string; configuration?: Obj }) =>
    api<DevRun>("/api/dev/runs", { method: "POST", body: start }),
  run: (id: string) => api<DevRun>(`/api/dev/runs/${enc(id)}`),
  /** The author's recent commands, newest first (kept for a few hours, across restarts of the server). */
  runs: () => api<DevRun[]>("/api/dev/runs"),
  /** The screen an unfinished trial stopped on, kept with the run for a few hours. */
  runScreen: (id: string) => apiUrl(`/api/dev/runs/${enc(id)}/screen`),
  runFrames: (id: string) => api<DevFrame[]>(`/api/dev/runs/${enc(id)}/frames`),
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
