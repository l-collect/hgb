import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ask } from "../../components/Confirm";
import { Chips, MoreMenu, Pill, SegmentTabs, Tag } from "../../components/ui";
import type { CanvasRun } from "./canvas/Canvas";
import { ToScript } from "./canvas/ToScript";
import { ConfigTab } from "./config/ConfigTab";
import { useTestValues } from "./config/testValues";
import { Link, navigate, usePath, useQuery } from "../../router";
import { dev, dropped, follow, issuesOf, queued, runId, sampleNow, type CheckIssue, type CheckRequest, type DevRun, type DevTrace, type IssueWhere, type Json, type Obj, type Sample, type Template } from "./api";
import { devPaths, EDIT_CONFLICT, failure, PATCH_CONFLICT, useDev, type Edit } from "./context";
import { startedHere, useDevRun } from "./events";
import { FrameTools } from "./FrameTools";
import { FrameView, useFrames } from "./FrameReplay";
import { uniqueId } from "./HomePage";
import { arr, isObj, nodeDigest, objs, snippets, str, target, tasks, usedSnippets, type TaskDef } from "./model";
import { NameButton } from "./NameButton";
import { openDirect, type DirectScreen } from "./direct";
import { completed, failedAt, failReason, insertAfter, missBoxes, ok, ownerOfStep, placeOf, running, snippetKey, testValues, type OwnerKey } from "./runs";
import type { InsertTarget } from "./sentence";
import { lineDiff, useDevice } from "./wb";
import { IssueText, Located, locate, placeOf as placeAt } from "./where";
import pub from "./Publish.module.css";
import type { LineFailure, LineMark, ScriptNames, ScriptProblem, TemplateView } from "./ScriptEditor";
import type { FailHost, SpotHost } from "./SpotPanels";
import { judgeOnServer } from "./api";
import { useReference } from "./coords";
import { serverIdOf } from "./PageGraph";
import { conditionsOf, entryId } from "./StatesPage";
import { braceFit, lintSettings, readsAsNumber, settingView, slotWhileTyping, spanOf, valuesOf, type SettingView } from "./settingUse";
import { PatchConflicts } from "./PatchConflicts";
import type { PickerHost } from "./TemplatePicker";
import w from "./Wb.module.css";
import s from "./Workspace.module.css";

// The editor (CodeMirror) loads only when a script is opened, so the rest of the console stays light.
const ScriptEditor = lazy(() => import("./ScriptEditor").then((m) => ({ default: m.ScriptEditor })));
// 画板 (React Flow) too, only when it is opened.
const Canvas = lazy(() => import("./canvas/Canvas"));
/** 画板 needs a window this wide; narrower, the script shows (and ?view=canvas stays, to come back when it widens). */
const CANVAS_MIN = 1280;
function useWide(min: number) {
  const [wide, setWide] = useState(() => typeof window === "undefined" || window.innerWidth >= min);
  useEffect(() => { const on = () => setWide(window.innerWidth >= min); window.addEventListener("resize", on); return () => window.removeEventListener("resize", on); }, [min]);
  return wide;
}

const CATEGORY: Record<string, string> = { daily: "日常", weekly: "每周", event: "活动", account: "账号" };

/** What a script may say, one line each (docs/design/task-script.md); the third, when given, is what a click inserts. */
const HELP: [string, string, string?][] = [
  ["去 结界突破", "按页面图走过去"],
  ["等 \"文字\"@区域", "等到这行字"],
  ["点 \"文字\"@区域 [最多 N 次]", "等到、找到、点它"],
  ["清零 认输", "清零已点次数"],
  ["点 图 模板@区域 [最上]", "点图标"],
  ["点 … 偏 dx,dy [空白]", "点目标旁边"],
  ["分情况 / 名字 条件", "等到其一，走那支", "分情况\n  名字 条件"],
  ["如果看到 / 如果没看到 条件", "连续 2 帧再判断", "如果看到 条件"],
  ["色 x,y#RRGGBB … / 色 组名@x,y", "取色点，最快"],
  ["点 色 组名@x,y [偏 dx,dy]", "点取色组中心"],
  ["如果有 条件 / 否则", "只看刚等到的画面", "如果有 条件\n否则"],
  ["如果红点@区域 / 否则", "有没有红点", "如果红点@区域\n否则"],
  ["如果颜色@区域 r,g,b~r,g,b N%", "这种颜色够不够多"],
  ["按设置 配置项 / 值", "开 关 其他 没有值", "按设置 配置项\n  值"],
  ["反复 最多 {rounds} 次 / 等待 {pause|2}秒", "读配置项的数", "反复 最多 {rounds} 次"],
  ["直到 条件 最多 N 次", "反复做，到了就停", "直到 条件 最多 3 次"],
  ["反复 最多 N 次 / 跳出", "到了就跳出", "反复 最多 3 次\n  跳出"],
  ["逐个 名 在 甲,乙", "每个值做一遍；{名}"],
  ["扫描网格 x,y 列x行 步进 dx,dy 格大小 w,h: 条件", "一帧扫网格"],
  ["拖 \"锚\"@区域 偏 dx,dy 到 dx,dy", "从锚点旁拖"],
  ["启动游戏", "启动并等到前台"],
  ["用 片段", "调用片段"],
  ["上报 \"悬赏邀请\"", "排后续任务"],
  ["结果 \"…\" / 停下 \"…\"", "写结果 / 停下", "结果 \"…\""],
  ["长等待 300秒 / 等待 2秒", "放宽看门狗 / 干等", "等待 2秒"],
];

type Tab = "run" | "problems" | "screen" | "help" | "config";
type Issue = { line: number | null; reason: string; location: string; where?: IssueWhere | null; warning?: boolean };
/** A problem as listed and marked: from the server's check, or found here on the spot. */
type Shown = { line: number | null; reason: string; warning: boolean; col?: number; len?: number };
/** The same line and words once. */
const once = <T extends { line: number | null; reason: string }>(xs: T[]): T[] => { const seen = new Set<string>(); return xs.filter((x) => { const k = `${x.line}|${x.reason}`; if (seen.has(k)) return false; seen.add(k); return true; })
  .sort((a, b) => (a.line ?? 1e9) - (b.line ?? 1e9)); };
/** 「2 错 · 1 提醒」. */
const tally = (xs: { warning: boolean }[]) => { const e = xs.filter((x) => !x.warning).length, wn = xs.length - e; return [e ? `${e} 错` : "", wn ? `${wn} 提醒` : ""].filter(Boolean).join(" · "); };
/** What a click on a 写法 line inserts: its own text, else the line with [optional] parts left out and the first of a / b. */
const helpInsert = ([sayIt, , insert]: [string, string, string?]) => insert ?? sayIt.replace(/\s*\[[^\]]*\]/g, "").split(" / ")[0];

/**
 * [body] with the script of the step or snippet [key] names (as Workspace's ownerIn finds it: the first of that id)
 * set to [text]: new objects only on the way down to it (as config/uses withEdits), the rest the draft's own.
 */
function withScript(body: Obj, key: OwnerKey, taskId: string | undefined, text: string): Obj {
  const replaceFirst = (list: Json | undefined, hit: (o: Obj) => boolean, change: (o: Obj) => Obj): Json[] => {
    let done = false;
    return arr(list).map((x) => { if (done || !isObj(x) || !hit(x)) return x; done = true; return change(x); });
  };
  if (!key.startsWith("step:")) return { ...body, snippets: replaceFirst(body.snippets, (sn) => sn.id === key.slice(8), (sn) => ({ ...sn, script: text })) };
  return { ...body, tasks: replaceFirst(body.tasks, (t) => (str(t.id) ?? "") === taskId,
    (t) => ({ ...t, steps: replaceFirst(t.steps, (st) => st.id === key.slice(5), (st) => ({ ...st, script: text })) })) };
}

/**
 * 工作区: a task (or, with no task, the snippet library) as one page — steps on the left, the script in the middle,
 * and on the right the trial: where it stopped and why, the screen it stopped on with the tools to make the missing
 * condition there, and every line it ran. The loop write → check → run → fix → run again stays on this page.
 */
export function Workspace({ task: taskId, step: stepId, snippet: snippetId }: { task?: string; step?: string; snippet?: string }) {
  const { draft, game, apply, reloadTrials, edits: allEdits, setEdit: putEdit, saveScript, conflicts, device, refused, resolveRefused } = useDev();
  const phone = useDevice();
  const path = usePath();
  const query = useQuery();
  const body = draft?.body;
  // Worked out once per draft read: a new object each render would redo all that is made from them.
  const taskList = useMemo(() => body ? tasks(body) : [], [body]);
  const task = useMemo(() => taskId ? taskList.find((t) => t.id === taskId) : undefined, [taskList, taskId]);
  const allSnippets = useMemo(() => body ? snippets(body) : [], [body]);
  // Which snippets each task calls (directly or through others), and so in how many tasks each snippet is used.
  const usedBy = useMemo(() => {
    const counts = new Map<string, number>();
    const byTask = new Map<TaskDef, string[]>();
    if (body) for (const t of taskList) {
      const used = usedSnippets(body, t.raw);
      byTask.set(t, used);
      for (const id of used) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return { counts, byTask };
  }, [body, taskList]);
  const taskUsed = useMemo(() => task ? usedBy.byTask.get(task) ?? [] : [], [task, usedBy]);
  const uses = useCallback((id: string) => usedBy.counts.get(id) ?? 0, [usedBy]);
  const step = task && !snippetId ? task.steps.find((st) => st.id === stepId) ?? task.steps[0] : undefined;
  const snippetOnly = !taskId ? snippetId ?? String(allSnippets[0]?.id ?? "") : undefined;
  const key: OwnerKey | null = snippetId ? snippetKey(snippetId) : step ? ownerOfStep(step) : snippetOnly ? snippetKey(snippetOnly) : null;

  /** The step or snippet a key names, in [b]. */
  const ownerIn = useCallback((b: Obj, k: OwnerKey): Obj | undefined => {
    if (!k.startsWith("step:")) return snippets(b).find((sn) => sn.id === k.slice(8));
    // As tasks(b).find(…).steps, without making every task's view to look at one.
    const t = objs(b.tasks).find((x) => (str(x.id) ?? "") === taskId);
    return t ? objs(t.steps).find((st) => st.id === k.slice(5)) : undefined;
  }, [taskId]);
  const savedOf = useCallback((k: OwnerKey) => body ? str(ownerIn(body, k)?.script) : undefined, [body, ownerIn]);

  // Unsaved text, per script, kept in the workbench while moving around it. A step's key is the task's own.
  const scoped = useCallback((k: OwnerKey) => k.startsWith("step:") ? `step:${taskId}/${k.slice(5)}` : k, [taskId]);
  const edits = useMemo(() => Object.fromEntries(Object.entries(allEdits).flatMap(([k, v]) =>
    k.startsWith(`step:${taskId}/`) ? [[`step:${k.slice(6 + String(taskId).length)}`, v]] : k.startsWith("snippet:") ? [[k, v]] : [])), [allEdits, taskId]);
  const setEdit = useCallback((k: OwnerKey, v: string | undefined) => putEdit(scoped(k), v, savedOf(k)), [putEdit, scoped, savedOf]);
  const [message, setMessage] = useState<[string, boolean] | null>(null);
  const say = (text: string | null) => setMessage(text ? [text, false] : null);
  const [tab, setTab] = useState<Tab>(taskId ? "run" : "problems");
  const [goTo, setGoTo] = useState<{ key: OwnerKey; line: number; at: number } | null>(null);
  const [cursor, setCursor] = useState<number | null>(null);
  // The phone's screen last looked at in 画面: the tools there keep that very picture as their sample.
  const [peekUrl, setPeekUrl] = useState<string | null>(null);
  useEffect(() => { setCursor(null); }, [key]);
  const owner = body && key ? ownerIn(body, key) : undefined;
  const saved = key ? savedOf(key) : undefined;
  const isScript = typeof saved === "string";
  // 脚本 | 画板: ?view=canvas, kept across a reload; ⌘E switches.
  const wantCanvas = query.get("view") === "canvas";
  const wide = useWide(CANVAS_MIN);
  const [narrowSeen, setNarrowSeen] = useState(false);
  const showCanvas = wantCanvas && wide && isScript;
  const setView = useCallback((canvas: boolean) => {
    const q = new URLSearchParams(window.location.search);
    if (canvas) q.set("view", "canvas"); else q.delete("view");
    navigate(window.location.pathname + (q.toString() ? `?${q}` : ""), { replace: true });
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "e" && isScript) { e.preventDefault(); setView(!wantCanvas); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isScript, wantCanvas, setView]);
  useEffect(() => { if (wide) setNarrowSeen(false); }, [wide]);
  const [drawerHost, setDrawerHost] = useState<HTMLDivElement | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editorRoot, setEditorRoot] = useState<HTMLDivElement | null>(null);
  // A change made on the board is saved by itself a moment later (改动即时写回), through the same save as ⌘S: by
  // script, the text the board left. Typing in the script view (after ⌘E, say) is not saved by itself.
  const boardText = useRef(new Map<OwnerKey, string>());
  const [boardTick, setBoardTick] = useState(0);
  const markBoard = useCallback((k: OwnerKey, t: string) => { boardText.current.set(k, t); setBoardTick((n) => n + 1); }, []);
  // 积木 rewritten as a script here: the node as it was, for 撤销; keys undone are not rewritten again by themselves.
  const [converted, setConverted] = useState<{ key: OwnerKey; before: Obj; script: string } | null>(null);
  const undoneKeys = useRef(new Set<OwnerKey>());
  const text = key && edits[key] !== undefined ? edits[key] : saved ?? "";
  const textNow = useRef(text); textNow.current = text;
  const dirtyKeys = Object.keys(edits).filter((k) => savedOf(k) !== undefined && edits[k] !== savedOf(k));
  const dirty = !!key && dirtyKeys.includes(key);
  // A refused save settled in the workbench's conflict panel: its message goes with it.
  useEffect(() => { if (!dirty) setMessage((m) => (m?.[0] === PATCH_CONFLICT ? null : m)); }, [dirty]);

  /** Puts [insert] after line [after] of the open script, unsaved, and goes to it. */
  const insertAt = useCallback((insert: string, after: number) => {
    if (!key) return;
    setEdit(key, insertAfter(textNow.current, after, insert));
    setGoTo({ key, line: after + 1, at: Date.now() });
    setMessage([`已插到 L${after + 1}`, true]);
  }, [key, setEdit]);
  /** Puts [line] in place of line [at] of the open script, unsaved, and goes to it. */
  const replaceAt = useCallback((at: number, line: string) => {
    if (!key) return;
    const lines = textNow.current.split("\n");
    if (at < 1 || at > lines.length) return;
    lines[at - 1] = line;
    setEdit(key, lines.join("\n"));
    setGoTo({ key, line: at, at: Date.now() });
    setMessage([`已替换 L${at} 的条件`, true]);
  }, [key, setEdit]);

  // From other parts: ?insert=<text>&line=N (素材's 插到) puts the text after line N; ?line=N alone opens there;
  // ?values=<json> (配置项's 带回试跑) becomes the 自定义 test values. Each is taken once and dropped from the address.
  const [scope, setScope] = useState<"step" | "task">("step");
  const [custom, setCustom] = useState<Obj | null>(null);
  const [preset, setPreset] = useState(0);
  const qs = query.toString();
  const linked = useRef<string | null>(null);
  useEffect(() => {
    const q = new URLSearchParams(qs);
    let drop = false;
    const values = q.get("values");
    if (values !== null) {
      try { const v = JSON.parse(values); if (isObj(v)) { setCustom(v); setPreset(-1); setTab("run"); } else say("测试值读不懂"); }
      catch { say("测试值读不懂"); }
      q.delete("values"); drop = true;
    }
    // ?scope=task (发布's 整任务试跑) opens the trial on the whole task.
    if (q.get("scope") === "task") { setScope("task"); setTab("run"); q.delete("scope"); drop = true; }
    const insert = q.get("insert"); const line = q.get("line");
    if (insert !== null && key && isScript) {
      if (q.get("replace") === "1") replaceAt(Math.max(1, Number(line) || 1), insert); else insertAt(insert, Math.max(0, Number(line) || 0));
      q.delete("insert"); q.delete("line"); q.delete("replace"); drop = true;
    }
    else if (insert === null && line && key && linked.current !== `${key}#${line}`) { linked.current = `${key}#${line}`; setGoTo({ key, line: Number(line), at: Date.now() }); }
    if (drop) navigate(path + (q.toString() ? `?${q}` : ""), { replace: true });
  }, [qs, key, isScript]); // eslint-disable-line react-hooks/exhaustive-deps

  const [saving, setSaving] = useState(false);
  const [starting, setStarting] = useState(false);
  const savingRef = useRef(false);
  const startingRef = useRef(false);

  const save = useCallback(async (k: OwnerKey, force = false) => {
    if (edits[k] === undefined) return true;
    if (savingRef.current) return false;
    savingRef.current = true; setSaving(true);
    try {
      const problem = await saveScript(scoped(k), force);
      if (problem) { say(problem); if (problem === EDIT_CONFLICT && k !== key) openKeyRef.current(k); return false; }
      return true;
    } finally {
      savingRef.current = false; setSaving(false);
    }
  }, [edits, saveScript, scoped, key]);
  const openKeyRef = useRef<(k: OwnerKey) => void>(() => undefined);
  const saveRef = useRef(save); saveRef.current = save;
  const editsRef = useRef(edits); editsRef.current = edits;
  const holdRef = useRef<(k: OwnerKey) => boolean>(() => false);
  holdRef.current = (k) => !!refused || conflicts.includes(scoped(k));
  useEffect(() => {
    for (const [k, t] of [...boardText.current]) if (edits[k] !== t) boardText.current.delete(k);
    if (!boardText.current.size) return;
    let timer: ReturnType<typeof setTimeout>;
    const run = async () => {
      // A save under way: try again when it is done.
      if (savingRef.current) { timer = setTimeout(() => void run(), 500); return; }
      for (const [k, t] of [...boardText.current]) {
        if (editsRef.current[k] !== t) { boardText.current.delete(k); continue; }
        if (holdRef.current(k)) continue;
        boardText.current.delete(k);
        await saveRef.current(k);
      }
    };
    timer = setTimeout(() => void run(), 2000);
    return () => clearTimeout(timer);
  }, [edits, boardTick]);

  // ---- checking: only this script, as it would be with this text, a moment after typing stops. A newer check
  // cancels the one before (here and, by the revision, on the server); the last result stays, marked 可能过期, until
  // the new one comes.
  const [checked, setChecked] = useState<{ key: OwnerKey; issues: Issue[]; others: Issue[] } | null>(null);
  const [checking, setChecking] = useState(false);
  // The server's queue was full: when it is tried again by itself ([retryNow] at once), and what the server said.
  const [queuedUntil, setQueuedUntil] = useState<{ at: number; said: string } | null>(null);
  const retryNow = useRef<(() => void) | null>(null);
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => { if (!queuedUntil) return; setClock(Date.now()); const t = setInterval(() => setClock(Date.now()), 1000); return () => clearInterval(t); }, [queuedUntil]);
  const issues = checked && checked.key === key ? checked.issues : null;
  const others = checked && checked.key === key ? checked.others : [];
  useEffect(() => {
    if (!body || !key || !isScript) { setChecked(key ? { key, issues: [], others: [] } : null); setChecking(false); setQueuedUntil(null); return; }
    let live = true; setChecking(true);
    const control = new AbortController();
    let retry: ReturnType<typeof setTimeout> | undefined;
    if (!ownerIn(body, key)) { setChecking(false); return; }
    const snippetId = key.startsWith("snippet:") ? key.slice(8) : null;
    // Made when it is sent, not on every key: the draft with this script's text, only the way down to it copied.
    let request: CheckRequest | null = null;
    const requestNow = (): CheckRequest => request = request ?? { bundle: withScript(body, key, taskId, text), target: game, revision: draft?.revision, measure: false,
      ...(snippetId ? { snippet: snippetId } : { task: taskId, step: key.slice(5) }) };
    const send = async (again: boolean) => {
      try {
        const result = await dev.check(requestNow(), control.signal);
        if (!live) return;
        // This script's, then what it touches: its snippets, and for a snippet the steps that call it.
        const all = [...result.issues.map((x) => ({ ...x, warning: isWarning(x) })), ...(result.warnings ?? []).map((x) => ({ ...x, warning: true }))];
        const own = (x: CheckIssue) => { const at = whereOf(x); return snippetId ? at.snippet === snippetId && !at.task : at.task === taskId && at.step === key.slice(5) && !at.snippet; };
        setChecked({ key,
          issues: all.filter(own).map((x) => ({ line: whereOf(x).line ?? null, reason: x.reason, location: x.location, warning: x.warning })),
          others: all.filter((x) => !own(x) && (!!whereOf(x).task || !!whereOf(x).snippet)).map((x) => ({ line: null, reason: x.reason, location: x.location, where: x.where, warning: x.warning })) });
        setChecking(false); setQueuedUntil(null);
      } catch (error) {
        if (!live || control.signal.aborted) return;
        // Given up for a newer check (from another window, say): nothing to show.
        if (dropped(error)) { setChecking(false); return; }
        // The server's queue is full: say so, and try once more a little later.
        if (queued(error) && !again) {
          setQueuedUntil({ at: Date.now() + 8000, said: failure(error) });
          retry = setTimeout(() => void send(true), 8000);
          retryNow.current = () => { clearTimeout(retry); retryNow.current = null; setQueuedUntil(null); void send(true); };
          return;
        }
        setQueuedUntil(null); setChecking(false);
        setChecked({ key, issues: [{ line: null, reason: `检查没做成：${failure(error)}`, location: "" }], others: [] });
      }
    };
    const timer = setTimeout(() => void send(false), 600);
    return () => { live = false; clearTimeout(timer); clearTimeout(retry); retryNow.current = null; control.abort(); };
  }, [text, body, key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setQueuedUntil(null); }, [text, key]);
  // Settings read wrong, found on the spot while the server's check (half a minute) is still out; its answer then wins.
  const local = useMemo(() => isScript ? lintSettings(text, task ? task.fields : null, !!key?.startsWith("snippet:")) : [], [text, task, isScript, key]);
  // One list is shown everywhere (the marks in the editor, the count on top, the head of 问题): the server's answer;
  // while a newer check is out, what was found here on the spot (the server's older answer folded as 上次检查), or,
  // when nothing was found here, that older answer.
  const served = useMemo((): Shown[] | null => issues === null ? null
    : once(issues.map((x) => ({ line: x.line, reason: x.reason, warning: !!x.warning, ...(x.line === null ? {} : placeIn(local, x.line)) }))), [issues, local]);
  const spot = useMemo((): Shown[] => once(local.map((x) => ({ line: x.line, reason: x.reason, warning: x.severity === "warning", col: x.col, len: x.len }))), [local]);
  const fromSpot = checking && (spot.length > 0 || served === null);
  const shownIssues: Shown[] = fromSpot ? spot : served ?? [];
  const staleIssues = fromSpot ? served : null;
  const problems = useMemo((): ScriptProblem[] => shownIssues.flatMap((x) => x.line === null ? []
    : [{ line: x.line, reason: x.reason, severity: x.warning ? "warning" as const : "error" as const, col: x.col, len: x.len }]), [shownIssues]);
  const otherShown = once(others.map((x) => ({ ...x, warning: !!x.warning })));

  const [sizes, setSizes] = useState<Record<string, string>>({});
  const [library, setLibrary] = useState<Template[]>([]);
  const [libraryRead, setLibraryRead] = useState(0);
  useEffect(() => {
    dev.templates(game).then((list) => {
      setLibrary(list);
      const grouped = new Map<string, { dim: string; count: number }>();
      for (const t of list) {
        const base = t.id.split("@")[0];
        const prev = grouped.get(base);
        grouped.set(base, prev ? { dim: prev.dim, count: prev.count + 1 } : { dim: `${t.width}×${t.height}`, count: 1 });
      }
      setSizes(Object.fromEntries(Array.from(grouped.entries()).map(([k, v]) => [k, v.count > 1 ? `${v.dim} · ${v.count} 套主题` : v.dim])));
    }).catch(() => undefined);
  }, [game, libraryRead]);
  // 选图: the library by the names scripts write, each with the pages that mention it; the newest picture; a cut kept in the draft.
  const pickerHost = useMemo((): PickerHost | null => {
    if (!body) return null;
    const g = objs(body.targets).find((t) => t.id === (task?.raw.targetId ?? objs(body.targets)[0]?.id));
    const lib = isObj(g?.library) ? g.library : {};
    const pageList = objs(lib.pages).map((p) => ({ name: str(p.name) ?? String(p.id), text: JSON.stringify(p) }));
    const bases = Array.from(new Set(library.map((t) => t.id.split("@")[0])));
    return {
      templates: bases.map((name) => { const t = library.find((x) => x.id.split("@")[0] === name)!;
        return { name, src: dev.templateImage(game, t.id), meta: sizes[name] ?? `${t.width}×${t.height}`, pages: pageList.filter((p) => p.text.includes(name)).map((p) => p.name) }; }),
      pages: pageList.map((p) => p.name),
      sample: async (name) => {
        const all = await dev.samples(game);
        // The sample this picture was cut from (any theme of it), so the line's region is drawn on its own scene.
        const from = library.find((t) => t.id.split("@")[0] === name && t.sample)?.sample;
        const origin = from ? all.find((x) => x.id === from) : undefined;
        if (origin) return { sample: origin, origin: true };
        const newest = [...all].sort((a, b) => b.createdAt - a.createdAt)[0];
        return newest ? { sample: newest, origin: false } : null;
      },
      sampleSrc: (id) => dev.sampleImage(id),
      cut: async (sample, rect, name) => {
        // A name the library already has would be overwritten: only when asked (DriftGuide's 替换 is its own path).
        const taken = Array.from(new Set([...library.map((x) => x.id.split("@")[0]), ...objs(body.resources).map((r) => String(r.id).split("@")[0])]));
        const base = name.split("@")[0];
        if (taken.includes(base) && !await ask({ title: "已有同名图，替换？", body: `「${base}」会换成这次裁的图，用到它的脚本都跟着变`, ok: "替换", cancel: "取消", danger: true }))
        { let n = 2; while (taken.includes(`${base}-${n}`)) n++; throw new Error(`已有「${base}」，换个名字（如 ${base}-${n}）`); }
        const t = await dev.cut(game, { id: name, sample: sample.id, rect, confirmedTexts: [] });
        const entry = { id: t.id, assetName: t.assetName, bytes: t.bytes, sha256: t.sha256 };
        const problem = await apply(async (b) => {
          const old = objs(b.resources).find((r) => r.id === t.id);
          return [old ? { op: "put", path: `resources:${t.id}`, expect: await nodeDigest(old), value: entry } : { op: "insert", path: "", field: "resources", value: entry }];
        });
        if (problem) throw new Error(problem);
        setLibraryRead((n) => n + 1);
        return t.id;
      },
    };
  }, [body, task, library, sizes, game, apply]);
  // ---- completion and template pictures
  // 文字条件 and 页面引用 (the script editor's popovers): the game's samples (read once, newest first), its regions,
  // pages and routes, and judging one page on one sample on the server.
  const reference = useReference();
  const samplesOf = useRef<{ game: string; list: Promise<Sample[]> } | null>(null);
  const spotHost = useMemo((): SpotHost | null => {
    if (!body) return null;
    const g = objs(body.targets).find((t) => t.id === (task?.raw.targetId ?? objs(body.targets)[0]?.id));
    const lib = isObj(g?.library) ? g.library : {};
    const pages = objs(lib.pages), routes = objs(lib.routes), known = objs(lib.states);
    const regions = isObj(lib.regions) ? lib.regions : {};
    const pageOf = (word: string): Obj | undefined => pages.find((x) => x.id === word) ?? pages.find((x) => str(x.name) === word);
    const stateOf = (p: Obj): Obj | undefined => {
      const st = p.state;
      if (typeof st === "string") return known.find((x) => x.id === st);
      if (!isObj(st)) return undefined;
      const base = str(st.state) ? known.find((x) => x.id === str(st.state)) : undefined;
      return base ? { ...base, ...st } : st;
    };
    return {
      reference,
      samples: () => {
        if (samplesOf.current?.game !== game) {
          // A failed read is not kept: the next panel asks again.
          const list = dev.samples(game).then((all) => [...all].sort((a, b) => b.createdAt - a.createdAt), (error) => { samplesOf.current = null; throw error; });
          samplesOf.current = { game, list };
        }
        return samplesOf.current.list;
      },
      sampleSrc: (id) => dev.sampleImage(id),
      recognize: async (id) => { const read = await dev.recognizeSample(id); samplesOf.current = null; return read; },
      region: (name) => { const r = arr(regions[name]).map(Number); return r.length === 4 && r.every(Number.isFinite) ? r : null; },
      page: (word) => {
        // Scripts write a page's name (`去 结界突破`) or its id (`等 页 courtyard`).
        const p = pageOf(word); if (!p) return null;
        const id = String(p.id);
        const st = stateOf(p);
        const to = Array.from(new Set(routes.filter((r) => r.from === id).map((r) => String(r.to))));
        return { id, name: str(p.name) ?? id,
          conditions: st ? conditionsOf(st).map(([k, , l]) => k === "有" ? l : `没有${l}`) : [],
          templates: st ? arr(st.present).map((c) => typeof c === "string" ? c : isObj(c) ? str(c.template) : undefined).filter((x): x is string => !!x) : [],
          to: to.map((t) => ({ id: t, name: str(pages.find((x) => x.id === t)?.name) ?? t })) };
      },
      templateSample: (name) => library.find((t) => t.id.split("@")[0] === name && t.sample)?.sample ?? null,
      judge: async (word, sample) => {
        const p = pageOf(word); if (!p) return "phone";
        // What the server can judge pages by, as 页面 counts it: library states and every wait's candidates.
        const waits = await dev.waits(game).catch(() => []);
        const sid = serverIdOf(p, new Set([...known.map((x) => String(x.id)), ...waits.flatMap((x) => x.states.map(entryId)).filter((x): x is string => !!x)]));
        if (!sid) return "phone";
        const got = await judgeOnServer(game, [sid], [sample]);
        if (!got) return "server";
        return got.rows[0]?.results.find((c) => c.page === sid) ?? "phone";
      },
      openPage: (word) => { const p = pageOf(word); navigate(`${devPaths.pages}?page=${encodeURIComponent(p ? String(p.id) : word)}`); },
    };
  }, [body, task, library, game, reference]); // eslint-disable-line react-hooks/exhaustive-deps
  const names = useMemo((): ScriptNames => {
    const b = body ?? {};
    const models = new Set(objs(b.visionProfiles).flatMap((p) => isObj(p.models) ? Object.values(p.models).map(String) : []));
    const g = objs(b.targets).find((t) => t.id === (task?.raw.targetId ?? objs(b.targets)[0]?.id));
    const library = isObj(g?.library) ? g.library : {};
    return {
      templates: Array.from(new Set(objs(b.resources).map((r) => String(r.id)).filter((id) => !models.has(id)).map((id) => id.split("@")[0]))),
      regions: isObj(library.regions) ? Object.keys(library.regions) : [],
      snippets: allSnippets.map((sn) => String(sn.id)).filter((id) => key !== snippetKey(id)),
      fields: (task?.fields ?? []).map((f) => String(f.id)),
      // After {: every setting, those that do not fit this place greyed with why; those that may lack a value end as {x|n}.
      braces: (head, after) => (task?.fields ?? []).map((f) => {
        const label = str(f.label) ?? String(f.id);
        const span = readsAsNumber(f) ? spanOf(f) : null;
        const fit = key?.startsWith("snippet:") ? { ok: false, needDefault: null, short: "片段里不能读" } : braceFit(f, slotWhileTyping(head, after));
        return { id: String(f.id), label, detail: `${label}${span ? ` · ${span[0]}–${span[1]}${str(f.unit) ? ` ${str(f.unit)}` : ""}` : ""}`, bad: fit.ok ? undefined : fit.short, needDefault: fit.needDefault };
      }).sort((a, b) => Number(!!a.bad) - Number(!!b.bad)),
      values: (id) => { const f = task?.fields.find((x) => String(x.id) === id); return f ? valuesOf(f).map((v) => ({ word: v.word, label: v.label })) : null; },
      picker: pickerHost,
      spots: spotHost,
      pages: objs(library.pages).map((p) => str(p.name) ?? String(p.id)),
    };
  }, [body, task, key, pickerHost, spotHost]); // eslint-disable-line react-hooks/exhaustive-deps
  const setting = useCallback((id: string): SettingView | null => {
    const f = task?.fields.find((x) => String(x.id) === id);
    return f && task ? settingView(f, task.steps, `${devPaths.config(task.id)}?field=${encodeURIComponent(id)}`) : null;
  }, [task]);
  const template = useCallback((name: string): TemplateView | null => names.templates.includes(name) ? { src: dev.templateImage(game, name), meta: sizes[name] ?? "模板" } : null, [names, game, sizes]);

  // ---- trials: the task's newest one, followed while it goes on
  const tv = useTestValues(taskId ?? "");
  const [run, setRun] = useState<DevRun | null>(null);
  // Starting: the server compiles the draft first (about half a minute), then the phone takes it.
  const [preparing, setPreparing] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  // A refused trial's issues (the draft did not pass its check), each a link to its place.
  const [runIssues, setRunIssues] = useState<CheckIssue[]>([]);
  // The trial shown was started on the phone (or another window), not here.
  const [fromPhone, setFromPhone] = useState(false);
  const shown = useRef<string | null>(null);
  const show = (x: DevRun) => { if (shown.current === x.id) setRun(x); };
  useEffect(() => () => { shown.current = null; }, []);
  useEffect(() => {
    if (!taskId) return;
    // ?run=<id> opens that trial (a link to an older one); otherwise the task's newest.
    const wanted = new URLSearchParams(window.location.search).get("run");
    dev.runs().then(async (all) => {
      const mine = all.find((x) => x.kind === "trial" && x.task === taskId && (!wanted || x.id === wanted));
      if (!mine || shown.current !== null) return;
      shown.current = mine.id; setRun(mine); setFromPhone(!startedHere.has(mine.id));
      if (running(mine)) { await follow(mine.id, show); await reloadTrials(); }
    }).catch(() => undefined);
  }, [taskId]); // eslint-disable-line react-hooks/exhaustive-deps
  // Pushed by the server: the trial shown as it goes, and a trial of this task started on the phone, shown at once.
  useDevRun((x) => {
    if (x.kind !== "trial" || x.target !== game || x.task !== taskId) return;
    if (shown.current === x.id) { setRun((was) => was && was.updatedAt > x.updatedAt ? was : x); return; }
    if (!running(x) || startingRef.current || startedHere.has(x.id) || shown.current === "") return;
    shown.current = x.id; setRun(x); setFromPhone(true); setRunError(null);
  }, [game, taskId]);
  // The first choice is the test values shared with 配置项 and 画板 (set there by hand, else each default).
  const presets: [string, Obj][] = task ? testValues(task.fields).map(([name, v], i) => [i === 0 ? "测试值" : name, v] as [string, Obj]) : [];
  const values = preset === -1 && custom ? custom : preset === 0 ? tv.trial : presets[preset]?.[1] ?? tv.trial;
  /** [stepOnly]: this step whatever 范围 says (失败行现场的「重跑这一步」). */
  const start = async (stepOnly = false) => {
    if (!task || !device || startingRef.current) return;
    startingRef.current = true; setStarting(true);
    setMessage(null); setTab("run"); setRunError(null); setRunIssues([]);
    // The old result goes at once: what shows now is this trial's.
    shown.current = ""; setRun(null); setFromPhone(false);
    try {
      if (refused || dirtyKeys.some((k) => conflicts.includes(scoped(k)))) { setRunError("先在左边选用哪边，再试跑"); return; }
      for (const k of dirtyKeys) if (!await save(k)) { setRunError("有脚本没保存成，没开始试跑"); return; }
      const only = (stepOnly || scope === "step") && step && !snippetId ? String(step.id) : undefined;
      // The id is made here, so the server's events (排队, 准备) are followed before it answers.
      const id = runId();
      startedHere.add(id); shown.current = id;
      setPreparing(true);
      const started = await dev.startRun({ id, kind: "trial", target: game, device, task: task.id, step: only, configuration: values });
      startedHere.add(started.id);
      setPreparing(false);
      shown.current = started.id; setRun((was) => was && was.id === started.id && was.updatedAt > started.updatedAt ? was : started);
      const done = await follow(started.id, show);
      await reloadTrials();
      if (done) for (let i = 0; i < 10 && shown.current === started.id && !(await dev.run(started.id).then((x) => {
        show(x); return (completed(done) || !!x.screen) && !!x.framesUploaded;
      }).catch(() => false)); i++)
        await new Promise((resolve) => setTimeout(resolve, 1500));
    } catch (error) {
      const listed = issuesOf(error);
      setRunIssues(listed);
      // Listed one by one below; the message then only says why.
      setRunError(listed.length ? null : failure(error));
    }
    finally { startingRef.current = false; setStarting(false); setPreparing(false); }
  };

  // ---- the run read against the scripts it ran
  const failIndex = failedAt(run);
  const places = useMemo(() => task && run ? run.traces.map((tr) => placeOf(tr, task, savedOf)) : [], [run, task, savedOf]);
  const failTrace = failIndex >= 0 ? run!.traces[failIndex] : undefined;
  const why = failTrace ? failReason(failTrace.trace, failTrace.reason) : "";
  const fresh = useMemo(() => {
    if (!key || !run) return { marks: [] as LineMark[], failed: null as LineFailure | null };
    const byLine = new Map<number, LineMark["tone"]>();
    places.forEach((chain, i) => chain.forEach((p) => {
      if (p.key !== key) return;
      if (i === failIndex) byLine.set(p.line, "bad");
      else if (ok(run.traces[i].result) && !byLine.has(p.line)) byLine.set(p.line, "ok");
    }));
    const here = failIndex >= 0 ? places[failIndex].filter((p) => p.key === key).at(-1) : undefined;
    return { marks: [...byLine].map(([line, tone]) => ({ line, tone })), failed: here ? { line: here.line, text: why } : null };
  }, [key, run, places, failIndex, why]);
  // The run's lines are the saved script's: while the text differs, the editor keeps the marks it has (moved with the edits).
  const shownMarks = useRef<{ key: OwnerKey | null; value: typeof fresh }>({ key: null, value: fresh });
  const typing = !!key && edits[key] !== undefined && edits[key] !== saved;
  if (!typing || shownMarks.current.key !== key) shownMarks.current = { key, value: fresh };
  const { marks, failed } = shownMarks.current.value;
  // 失败行现场: the failed trial's frames at the failing action (read when opened), and what can be done from there.
  const actions = useRef({ start, tab: setTab }); actions.current = { start, tab: setTab };
  const failHost = useMemo((): FailHost | null => {
    if (!run || !failTrace) return null;
    const at = new Date(run.updatedAt), two = (n: number) => String(n).padStart(2, "0");
    return {
      time: `${two(at.getHours())}:${two(at.getMinutes())}`, why,
      frames: () => dev.runFrames(run.id).then((all) => {
        const mine = all.filter((f) => f.step === failTrace.step && f.action === failTrace.action);
        return mine.length ? mine : all.slice(-5);
      }),
      rerun: () => void actions.current.start(true),
      // The kept sample shows in 文字条件 and 页面引用 next time they open.
      keep: run.screen ? () => dev.keepRunScreen(run.id).then((x) => { samplesOf.current = null; return x; }) : null,
      replay: () => actions.current.tab("run"),
    };
  }, [run?.id, run?.screen, run?.framesUploaded, failTrace?.step, failTrace?.action, why]); // eslint-disable-line react-hooks/exhaustive-deps
  // The same trial for 画板: by line of this script, how it went there, the lines it went through one after another.
  const boardRun = useMemo((): CanvasRun | null => {
    if (!key || !run || !run.traces.length && !running(run)) return null;
    const lines = new Map<number, { tone: "ok" | "bad" | "running"; ms: number; times: number }>();
    const walked = new Set<string>();
    let prev: number | null = null; let steps = 0;
    run.traces.forEach((tr, i) => {
      const here = places[i]?.filter((x) => x.key === key).at(-1);
      if (!here) return;
      const was = lines.get(here.line);
      const tone = i === failIndex ? "bad" : ok(tr.result) ? "ok" : was?.tone ?? "ok";
      lines.set(here.line, { tone: was?.tone === "bad" ? "bad" : tone, ms: (was?.ms ?? 0) + tr.elapsedMs, times: (was?.times ?? 0) + (was && prev === here.line ? 0 : 1) });
      if (prev !== null && prev !== here.line) walked.add(`${prev}>${here.line}`);
      if (prev !== here.line) steps++;
      prev = here.line;
    });
    const busyNow = running(run);
    if (busyNow && prev !== null) lines.set(prev, { ...(lines.get(prev) ?? { ms: 0, times: 1 }), tone: "running" });
    const secs = Math.max(0, Math.round((run.updatedAt - run.createdAt) / 1000));
    if (!steps && !busyNow) return null;
    return { lines, walked, busy: busyNow, failure: failed, screen: run.screen ? dev.runScreen(run.id) : null, secs, steps, passed: completed(run) };
  }, [key, run, places, failIndex, failed]);

  // What the board's cards need: named regions (to frame them), how long each snippet is.
  // The task's settings, the same array until the draft changes (a new one each render would redraw the board).
  const boardFields = useMemo(() => body && taskId ? tasks(body).find((t) => t.id === taskId)?.fields ?? [] : [], [body, taskId]);
  const regions = useMemo((): Record<string, number[]> => {
    if (!body) return {};
    const g = objs(body.targets).find((t) => t.id === (task?.raw.targetId ?? objs(body.targets)[0]?.id));
    const lib = isObj(g?.library) ? g.library : {};
    const rs = isObj(lib.regions) ? lib.regions : {};
    const out: Record<string, number[]> = {};
    for (const [name, v] of Object.entries(rs)) {
      const list = Array.isArray(v) ? v : isObj(v) && Array.isArray(v.within) ? v.within : null;
      if (list && list.length === 4 && list.every((n) => typeof n === "number")) out[name] = list as number[];
    }
    return out;
  }, [body, taskId]); // eslint-disable-line react-hooks/exhaustive-deps
  const snippetLines = useCallback((name: string) => {
    const t = savedOf(snippetKey(name));
    return t === undefined ? undefined : t.split("\n").filter((l) => l.trim() && !l.trim().startsWith("#")).length;
  }, [savedOf]);

  if (!draft || !body) return null;
  if (taskId && !task) return <div className={s.missing}><div className={w.card}><div className={w.empty}>草稿里没有这个任务</div></div></div>;

  const busy = starting || running(run);
  const openKey = (k: OwnerKey, line?: number) => {
    if (line) setGoTo({ key: k, line, at: Date.now() });
    // 画板 stays 画板 while moving between steps and snippets.
    const q = wantCanvas ? "?view=canvas" : "";
    if (!task) { navigate(devPaths.snippet(k.slice(8)) + q); return; }
    const st = task.steps.find((x) => ownerOfStep(x) === k);
    navigate((st ? devPaths.step(task.id, String(st.id)) : devPaths.taskSnippet(task.id, k.slice(8))) + q);
  };
  openKeyRef.current = (k) => openKey(k);
  const lines = (k: OwnerKey) => (savedOf(k) ?? "").split("\n").length;
  const label = !key ? "" : step && !snippetId ? str(step.name) ?? String(step.id) : key.startsWith("snippet:") ? key.slice(8) : key.slice(5);
  const stepNo = step && !snippetId ? task!.steps.indexOf(step) + 1 : null;
  // Where a made condition goes: the failed line when it is in this script, else the cursor's.
  const insertLine = isScript ? failed?.line ?? cursor : null;
  const backHere = task && step && !snippetId && insertLine !== null
    ? `?task=${encodeURIComponent(task.id)}&step=${encodeURIComponent(String(step.id))}&line=${insertLine}` : "";
  const insertTarget: InsertTarget | null = insertLine === null ? null
    : { line: insertLine, lineText: text.split("\n")[insertLine - 1] ?? null, insert: insertAt, replace: replaceAt };
  const conflicted = !!key && conflicts.includes(scoped(key));
  const offline = !!device && phone !== undefined && !phone.online;
  const category = task ? str(objs(target(body, String(task.raw.targetId))?.categories).find((c) => c.id === task.raw.category)?.name) ?? CATEGORY[str(task.raw.category) ?? ""] ?? "任务" : "";
  // Errors known before a trial (this script's, then the snippets it uses): the trial button sends to the first.
  const ownErrors = shownIssues.filter((x) => !x.warning);
  const otherErrors = otherShown.filter((x) => !x.warning);
  const blockers = ownErrors.length + otherErrors.length;
  const toFirstError = () => {
    const mine = ownErrors.find((x) => x.line !== null);
    if (mine && key) { setGoTo({ key, line: mine.line!, at: Date.now() }); return; }
    const o = otherErrors[0]; const place = o ? placeAt(o.where, body) ?? locate(o.location, body) : null;
    if (place) navigate(place.to); else setTab("problems");
  };
  const tabs: [Tab, string][] = [...(task ? [["run", "试跑"] as [Tab, string]] : []), ["problems", shownIssues.length || otherShown.length ? `问题 ${shownIssues.length + otherShown.length}` : "问题"],
    ...(task ? [["config", "配置项"] as [Tab, string]] : []), ["screen", "画面"], ["help", "写法"]];
  const ownerPath = key ? (key.startsWith("snippet:") ? `snippets:${key.slice(8)}` : `tasks:${taskId}/steps:${key.slice(5)}`) : "";
  const undoConvert = async () => {
    if (!converted || !key) return;
    const before = converted.before;
    // Changed since it was rewritten: going back to the blocks drops those changes, so ask first.
    if (text !== converted.script && !await ask({ title: "撤销改写？", body: "改写之后在脚本里的改动会丢掉，回到原来的积木", ok: "撤销改写", cancel: "保留脚本", danger: true })) return;
    const problem = await apply(async (b) => { const now = ownerIn(b, converted.key); return now ? [{ op: "put", path: ownerPath, expect: await nodeDigest(now), value: before }] : []; });
    if (problem) { say(problem); return; }
    undoneKeys.current.add(scoped(converted.key)); setConverted(null); setEdit(key, undefined);
  };

  return (
    <div className={s.layout} data-view={showCanvas ? "canvas" : undefined}>
      <nav aria-label="步骤和片段" className={s.tree}>
        {task ? <>
          <div className={s.taskHead}>
            <b className={s.taskName} title={task.name}>{task.name}</b>
            <span className={w.muted}>{category} · <Link to={devPaths.config(task.id)}>配置 {task.fields.length} ›</Link></span>
          </div>
          <Steps query={wantCanvas ? "?view=canvas" : ""} task={task} current={step && !snippetId ? String(step.id) : null} run={run} failIndex={failIndex} dirty={dirtyKeys} lines={lines}
            onAdd={async (name, wanted) => {
              const sid = uniqueId(wanted || name, task.steps.map((x) => String(x.id)), "step");
              const problem = await apply([{ op: "insert", path: `tasks:${task.id}`, field: "steps", after: task.steps.length ? String(task.steps.at(-1)!.id) : null, value: { id: sid, name, script: "" } }]);
              if (problem) say(problem); else navigate(devPaths.step(task.id, sid) + (wantCanvas ? "?view=canvas" : ""));
            }} />
        </> : <div className={s.taskHead}><b>片段</b><span className={w.muted}>{allSnippets.length} 个</span></div>}
        <SnippetList ids={task ? taskUsed : allSnippets.map((sn) => String(sn.id))} title={task ? "用到的片段" : ""} current={key} dirty={dirtyKeys} uses={uses} onOpen={openKey} />
        {task && <AllSnippets ids={allSnippets.map((sn) => String(sn.id)).filter((id) => !taskUsed.includes(id))} current={key} uses={uses} onOpen={openKey} />}
      </nav>

      <section aria-label="脚本" className={s.editor}>
        {message && !((refused || conflicted) && (message[0] === PATCH_CONFLICT || message[0] === EDIT_CONFLICT)) &&
          <div role="status" className={message[1] ? `${w.muted} ${w.okText}` : w.message}>{message[0]}</div>}
        {/* A refused save's two sides: here, at the top of the editor, the one place it is said. */}
        {refused && <PatchConflicts conflicts={refused} body={body} onChoose={async (mine) => { const problem = await resolveRefused(mine); if (!problem) say(null); return problem; }} />}
        {key && owner ? <>
          <div className={s.bar}>
            <b className={s.barName}>{stepNo ? `${stepNo} · ` : ""}{label}</b>
            {isScript && <span title="⌘E 切换"><SegmentTabs label="编辑方式" items={[["script", "脚本"], ["canvas", "画板"]]} value={showCanvas ? "canvas" : "script"}
              onChange={(v) => { setNarrowSeen(false); setView(v === "canvas"); }} /></span>}
            {task && step && !snippetId && <StepTools task={task} step={step} apply={apply} onMessage={say} onRemoved={() => setEdit(ownerOfStep(step), undefined)} />}
            {key.startsWith("snippet:") && <Pill>片段 · 用在 {uses(key.slice(8))} 处</Pill>}
            <span className={s.grow} />
            {isScript && <span className={w.muted}>{queuedUntil && checking ? <QueueLine until={queuedUntil} now={clock} onRetry={() => retryNow.current?.()}
                last={shownIssues} local={fromSpot} />
              : !shownIssues.length ? (checking ? "检查中…" : "没问题") : <>
              <button type="button" className={s.linkish} onClick={() => setTab("problems")}>
                {fromSpot || !checking ? "" : "上次 "}<Tally xs={shownIssues} /></button>
              {checking && <span title="新的检查还没回来">（检查中）</span>}</>}</span>}
            {dirty && <span className={s.unsaved}>{conflicted || refused ? "选用哪边" : "未保存"}</span>}
            {isScript && <button type="button" className={`${w.btn} ${w.sm} ${dirty ? w.primary : ""}`} disabled={saving || !dirty || conflicted} onClick={() => void save(key)}>
              {saving ? "保存中…" : <>保存 <kbd className={s.kbd}>⌘S</kbd></>}</button>}
          </div>
          {conflicted && isScript && !refused && <Conflict theirs={saved ?? ""} mine={text} busy={saving}
            onMine={async () => { if (await save(key, true)) say(null); }}
            onTheirs={() => { setEdit(key, undefined); setMessage(["已换成别处的版本", true]); }} />}
          {converted && converted.key === key && <div role="status" className={s.converted}>已把积木改写成脚本
            <button type="button" className={`${w.btn} ${w.sm}`} onClick={() => void undoConvert()}>撤销</button>
            <button type="button" className={`${s.linkish} ${w.muted}`} aria-label="关掉提示" onClick={() => setConverted(null)}>✕</button></div>}
          {wantCanvas && !wide && isScript && !narrowSeen && <div role="status" className={s.narrow}><b>画板需要更宽的窗口</b><span className={w.muted}>已切到脚本，窗口拉宽到 {CANVAS_MIN} 以上会回到画板</span>
            <button type="button" className={`${w.btn} ${w.sm}`} onClick={() => setNarrowSeen(true)}>知道了</button></div>}
          {isScript ? <>
            <div ref={setEditorRoot} className={`${w.card} ${s.script}`} style={showCanvas ? { display: "none" } : undefined}>
              <Suspense fallback={<div className={w.empty}>正在打开编辑器…</div>}>
                <ScriptEditor key={key} value={text} onChange={(v) => setEdit(key, v === saved ? undefined : v)} onSave={() => { if (!conflicted) void save(key); }} onCursor={setCursor}
                  problems={problems} names={names} goTo={!showCanvas && goTo && goTo.key === key ? goTo : null} onJumped={() => setGoTo(null)} marks={marks} failure={failed} fail={failHost} template={template} setting={setting} />
              </Suspense>
            </div>
            {showCanvas && <Suspense fallback={<div className={`${w.card} ${w.empty}`}>正在打开画板…</div>}>
              <Canvas key={key} text={text} onText={(v) => { markBoard(key, v); setEdit(key, v === saved ? undefined : v); }} onBoardText={(v) => markBoard(key, v)}
                lock={conflicted || refused ? "这一步在别处被改过 · 你的改动还在，先在上面选用哪边；选完前画板只读" : null}
                taskId={task?.id} stepId={step && !snippetId ? String(step.id) : undefined} fields={boardFields} names={names} game={game} problems={problems}
                run={boardRun} goTo={goTo && goTo.key === key ? goTo : null} onJumped={() => setGoTo(null)}
                onScript={(line) => { setView(false); if (line) setGoTo({ key, line, at: Date.now() }); }} onSnippet={(name) => openKey(snippetKey(name))}
                editorRoot={editorRoot} onSave={() => { if (!conflicted) void save(key); }} onRetry={task && device && !offline && !busy ? () => void start() : null}
                drawerHost={drawerHost} onDrawer={setDrawerOpen} regions={regions} snippetLines={snippetLines} storeKey={`${game}/${scoped(key)}`}
                saved={saving ? "保存中…" : dirty ? "未保存" : "已写回"} />
            </Suspense>}
          </> : (
            <ToScript key={key} owner={owner} path={ownerPath} apply={apply} auto={!undoneKeys.current.has(scoped(key))}
              onConverted={(before, script) => { setConverted({ key, before, script }); setGoTo(null); }} />
          )}
        </> : <div className={`${w.card} ${w.empty}`}>{task ? "还没有步骤 · 在左边加一步" : "还没有片段"}</div>}
      </section>

      <aside aria-label="试跑 · 问题 · 画面 · 写法" className={s.aside}>
        {showCanvas && <div ref={setDrawerHost} className={s.drawerHost} style={{ display: drawerOpen ? "flex" : "none" }} />}
        {!(showCanvas && drawerOpen) && <>
        <div role="tablist" aria-label="右侧面板" className={s.tabs}>
          {tabs.map(([id, name]) => <button key={id} type="button" role="tab" className={s.tab} aria-selected={tab === id} onClick={() => setTab(id)}>{name}</button>)}
        </div>
        <div className={s.panel}>
          {task && tab === "run" && (
            <RunPanel task={task} step={step} snippetOpen={!!snippetId} run={run} busy={busy} device={device} offline={offline} failIndex={failIndex} places={places} savedOf={savedOf}
              why={why} scope={scope} setScope={setScope} presets={presets} custom={custom} preset={preset} setPreset={setPreset}
              preparing={preparing} error={runError} issues={runIssues} fromPhone={fromPhone} body={body} onRefresh={(x) => { if (shown.current === x.id) setRun(x); }}
              onStart={() => void start()} onOpen={openKey} onMessage={(t) => setRunError(t)} target={insertTarget} backHere={backHere}
              blockers={blockers} onFix={toFirstError} />
          )}
          {tab === "problems" && queuedUntil && checking && <span className={w.muted}><QueueLine until={queuedUntil} now={clock} onRetry={() => retryNow.current?.()} last={null} local={false} /></span>}
          {tab === "problems" && <ProblemList head={fromSpot ? `本地刚查到 · ${spot.length}` : checking && served ? "本脚本 · 上次检查" : "本脚本"} checking={checking}
            items={shownIssues} fresh={fromSpot} stale={staleIssues} onGo={(line) => key && setGoTo({ key, line, at: Date.now() })} />}
          {tab === "problems" && served !== null && (task || otherShown.length > 0) && <>
            <div className={s.group}>{key?.startsWith("snippet:") ? "调用它的地方" : "用到的片段"}{checking ? " · 上次检查" : ""}</div>
            {otherShown.length === 0 ? <span className={w.muted}>没问题</span>
              : otherShown.map((x, i) => <div key={i} className={s.problem}>{x.warning && <span className={s.warnTag}>提醒</span>}<IssueText issue={x} body={body} /></div>)}
          </>}
          {tab === "screen" && (device
            ? <FrameTools key={device} picture={<Peek device={device} onShown={setPeekUrl} />} target={insertTarget} assets={backHere}
                fresh={!peekUrl} pictureKey={peekUrl ?? ""}
                makeSample={(signal, sent) => peekUrl ? sampleFromPicture(game, peekUrl).catch(() => sampleNow(game, device, signal, sent)) : sampleNow(game, device, signal, sent)} />
            : <span className={w.muted}>顶栏选一台手机</span>)}
          {tab === "help" && <div className={s.help}>
            <span className={w.muted}>{isScript ? `点一条插到 L${cursor ?? lines(key!)} 后` : "打开脚本后可点插入"}</span>
            {HELP.map((h) => <button key={h[0]} type="button" className={s.helpItem} disabled={!isScript}
              onClick={() => { const firstNumber = (task?.fields ?? []).find(readsAsNumber); insertAt(helpInsert(h).replace("{rounds}", `{${firstNumber ? String(firstNumber.id) : "rounds"}}`), cursor ?? text.split("\n").length); }}>
              <code>{h[0]}</code><span className={w.muted}>{h[1]}</span></button>)}
            <span className={w.muted}>区域 @x,y,宽,高 · 条件用“且”连 · # 后是注释</span>
          </div>}
          {tab === "config" && task && <ConfigTab taskId={task.id} />}
        </div>
        </>}
      </aside>
    </div>
  );
}

/** The picture looked at ([url], an object URL from 看一张 or 实时) kept as a sample as it is: no new picture from the phone. */
async function sampleFromPicture(game: string, url: string): Promise<Sample> {
  const blob = await (await fetch(url)).blob();
  return dev.uploadSample(game, new File([blob], blob.type === "image/png" ? "画面.png" : "画面.jpg", { type: blob.type || "image/png" }));
}

/** 「检查排队中 · 8 秒后重试 · 现在重试」, with the count shown beside it: the last check's (上次), or what was found here (本地). */
function QueueLine({ until, now, onRetry, last, local }: { until: { at: number; said: string }; now: number; onRetry: () => void; last: Shown[] | null; local: boolean }) {
  const secs = Math.max(0, Math.ceil((until.at - now) / 1000));
  return <span title={until.said}>检查排队中 · {secs ? `${secs} 秒后重试` : "重试中"} · <button type="button" className={`${s.linkish} ${w.okText}`} onClick={onRetry}>现在重试</button>
    {last && last.length > 0 && (local ? <> · <Tally xs={last} />（本地）</> : <> · 上次 <Tally xs={last} /></>)}</span>;
}
/** Errors and warnings apart: 「2 错 · 1 提醒」. */
function Tally({ xs }: { xs: { warning: boolean }[] }) {
  const e = xs.filter((x) => !x.warning).length, wn = xs.length - e;
  return <>{e > 0 && <span className={s.countErr}>{e} 错</span>}{e > 0 && wn > 0 && " · "}{wn > 0 && <span className={s.countWarn}>{wn} 提醒</span>}</>;
}
/** 问题's own part: the list shown (found here on the spot while the check is out), and the older answer folded under 上次检查. */
function ProblemList({ head, checking, items, fresh, stale, onGo }: { head: string; checking: boolean; items: Shown[]; fresh: boolean; stale: Shown[] | null; onGo: (line: number) => void }) {
  const [open, setOpen] = useState(false);
  const row = (x: Shown, i: number, cls = "") => <button key={i} type="button" className={`${s.problem} ${cls}`} disabled={x.line === null} onClick={() => x.line !== null && onGo(x.line)}>
    {x.line !== null && <span className={s.ln}>L{x.line}</span>}{x.warning && <span className={s.warnTag}>提醒</span>}{x.reason}</button>;
  return <>
    <div className={s.group}>{head}{checking ? "（检查中）" : ""}</div>
    {items.length === 0 ? <span className={w.muted}>{checking ? "检查中…" : "没问题"}</span> : items.map((x, i) => row(x, i, fresh ? s.problemNew : ""))}
    {stale && stale.length > 0 && <>
      <button type="button" className={s.fold} aria-expanded={open} onClick={() => setOpen(!open)}>上次检查 · {tally(stale)} {open ? "▾" : "›"}</button>
      {open && stale.map((x, i) => row(x, i, s.stale))}
    </>}
  </>;
}

/** The task's steps, each with how the trial shown went on it (• = not saved), and a way to add one. */
function Steps({ task, current, run, failIndex, dirty, lines, onAdd, query }: { query: string; task: TaskDef; current: string | null; run: DevRun | null; failIndex: number;
  dirty: string[]; lines: (k: OwnerKey) => number; onAdd: (name: string, id: string) => unknown }) {
  const tone = (sid: string) => {
    if (!run) return undefined;
    if (failIndex >= 0 && run.traces[failIndex].step === sid) return "bad";
    return run.traces.some((tr) => tr.step === sid) ? "ok" : undefined;
  };
  return <>
    <div className={s.group}>步骤</div>
    {task.steps.map((st, i) => {
      const sid = String(st.id); const k = ownerOfStep(st);
      const what = str(st.use) ? `片段 ${str(st.use)}` : typeof st.script === "string" ? `${lines(k)} 行` : "积木";
      return (
        <Link key={sid} to={devPaths.step(task.id, sid) + query} className={s.item} aria-current={current === sid ? "page" : undefined} title={what}>
          <span aria-hidden="true" className={s.dot} data-tone={tone(sid)} />
          <span className={s.itemName}>{i + 1} {str(st.name) ?? sid}</span>
          {dirty.includes(k) && <span className={s.unsavedDot} aria-label="没保存">•</span>}
        </Link>
      );
    })}
    <NameButton label="＋ 步骤" placeholder="步骤名" askId className={s.more} onName={onAdd} />
  </>;
}

function SnippetList({ ids, title, current, dirty, uses, onOpen }: { ids: string[]; title: string; current: OwnerKey | null; dirty: string[];
  uses: (id: string) => number; onOpen: (k: OwnerKey) => void }) {
  if (!ids.length) return null;
  return <>
    {title && <div className={s.group}>{title}</div>}
    {ids.map((id) => (
      <button key={id} type="button" className={s.item} aria-current={current === snippetKey(id) ? "page" : undefined} onClick={() => onOpen(snippetKey(id))}>
        <span className={`${s.itemName} ${s.mono}`}>{id}</span>
        {dirty.includes(snippetKey(id)) && <span className={s.unsavedDot} aria-label="没保存">•</span>}
        <span className={w.muted}>{uses(id)}</span>
      </button>
    ))}
  </>;
}

/** The snippets the task does not use, folded away until asked for. */
function AllSnippets({ ids, current, uses, onOpen }: { ids: string[]; current: OwnerKey | null; uses: (id: string) => number; onOpen: (k: OwnerKey) => void }) {
  const [open, setOpen] = useState(ids.some((id) => current === snippetKey(id)));
  if (!ids.length) return null;
  return <>
    <button type="button" className={s.more} aria-expanded={open} onClick={() => setOpen(!open)}>{open ? "收起" : `其他片段 ${ids.length} ›`}</button>
    {open && <SnippetList ids={ids} title="" current={current} dirty={[]} uses={uses} onOpen={onOpen} />}
  </>;
}

/** The chosen step's 准入 (run condition) and what it provides, and behind ⋯ moving, removing and conditioning it. */
function StepTools({ task, step, apply, onMessage, onRemoved }: { task: TaskDef; step: Obj; apply: (edit: Edit) => Promise<string | null>; onMessage: (text: string | null) => void; onRemoved: () => void }) {
  const sid = String(step.id);
  const taskPath = `tasks:${task.id}`;
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const stepsIn = (b: Obj) => tasks(b).find((x) => x.id === task.id)?.steps ?? [];
  const run = async (edit: Edit) => { onMessage(null); const problem = await apply(edit); if (problem) onMessage(problem); return !problem; };
  const i = task.steps.indexOf(step);
  const move = (to: number) => run(async (b) => {
    const now = stepsIn(b); const st = now.find((x) => x.id === sid); if (!st) return [];
    const rest = now.filter((x) => x.id !== sid);
    return [{ op: "delete", path: `${taskPath}/steps:${sid}`, expect: await nodeDigest(st) },
      { op: "insert", path: taskPath, field: "steps", after: to === 0 ? null : String(rest[to - 1]?.id ?? rest.at(-1)?.id), value: st }];
  });
  const remove = async () => {
    setRemoving(false);
    if (await run(async (b) => { const st = stepsIn(b).find((x) => x.id === sid); return st ? [{ op: "delete", path: `${taskPath}/steps:${sid}`, expect: await nodeDigest(st) }] : []; }))
      { onRemoved(); navigate(devPaths.task(task.id)); }
  };
  const setWhen = (next: Obj | null) => run(async (b) => {
    const st = stepsIn(b).find((x) => x.id === sid); if (!st) return [];
    const value: Obj = { ...st }; if (next) value.when = next; else delete value.when;
    return [{ op: "put", path: `${taskPath}/steps:${sid}`, expect: await nodeDigest(st), value }];
  });
  const choices = testable(task.fields);
  const used = task.steps.map((x) => isObj(x.when) ? str(x.when.field) : undefined).filter((x): x is string => !!x);
  const provided = task.fields.filter((f) => f.stepId === step.id);
  const actions: [string, () => void, boolean?][] = [
    ...(i > 0 ? [["上移", () => void move(i - 1)] as [string, () => void]] : []),
    ...(i < task.steps.length - 1 ? [["下移", () => void move(i + 1)] as [string, () => void]] : []),
    ...(choices.length ? [[isObj(step.when) ? "改运行条件" : "加运行条件", () => {
      if (!isObj(step.when)) void setWhen(firstCondition(likely(choices, used)));
      setEditing(true);
    }] as [string, () => void]] : []),
    ["移出任务", () => setRemoving(true), true],
  ];
  return <>
    <RunCondition step={step} fields={task.fields} editing={editing} setEditing={setEditing} onChange={(next) => void setWhen(next)} />
    {provided.length > 0 && <Link to={devPaths.config(task.id)} title={provided.map((f) => str(f.label) ?? String(f.id)).join("、")}><Pill>配置 {provided.length} 项</Pill></Link>}
    {removing && <span className={s.cond}><span>移出「{str(step.name) ?? sid}」？</span>
      <button type="button" className={`${w.btn} ${w.sm} ${w.danger}`} onClick={() => void remove()}>移出</button>
      <button type="button" className={`${w.btn} ${w.sm}`} onClick={() => setRemoving(false)}>取消</button></span>}
    <MoreMenu label="步骤操作" actions={actions} />
  </>;
}

/** 试跑: scope, test values, run; where it stopped and why, the screen it stopped on with the tools, and every line it ran. */
function RunPanel(p: { task: TaskDef; step: Obj | undefined; snippetOpen: boolean; run: DevRun | null; busy: boolean; device: string | null; offline: boolean; failIndex: number;
  places: { key: OwnerKey; line: number }[][]; savedOf: (k: OwnerKey) => string | undefined; why: string;
  scope: "step" | "task"; setScope: (v: "step" | "task") => void; presets: [string, Obj][]; custom: Obj | null; preset: number; setPreset: (i: number) => void;
  preparing: boolean; error: string | null; issues: CheckIssue[]; fromPhone: boolean; body: Obj; onRefresh: (run: DevRun) => void;
  onStart: () => void; onOpen: (k: OwnerKey, line?: number) => void; onMessage: (text: string | null) => void;
  target: InsertTarget | null; backHere: string;
  /** Errors already known in the scripts: the button goes to the first ([onFix]) before it runs. */
  blockers: number; onFix: () => void }) {
  const { task, step, run, busy, failIndex, places } = p;
  // While it runs the seconds go on by themselves, and how long the phone has said nothing.
  const [tick, setTick] = useState(() => Date.now());
  useEffect(() => { if (!busy) return; setTick(Date.now()); const t = setInterval(() => setTick(Date.now()), 1000); return () => clearInterval(t); }, [busy]);
  const canStep = !!step && !p.snippetOpen;
  const scope = canStep ? p.scope : "task";
  const frames = useFrames(busy ? null : run);
  const [view, setView] = useState<number | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [size, setSize] = useState<[number, number] | null>(null);
  useEffect(() => { setView(null); setOpen(null); }, [run?.id]);
  // Consecutive actions of one line (wait, find, tap) are one row.
  const rows: { at: number; step: string; key: OwnerKey | null; line: number; ms: number; bad: boolean; skip: boolean }[] = [];
  run?.traces.forEach((tr, i) => {
    const deep = places[i]?.at(-1);
    const last = rows.at(-1);
    if (last && last.step === tr.step && deep && last.key === deep.key && last.line === deep.line) {
      last.ms += tr.elapsedMs; last.bad ||= i === failIndex; last.at = i; return;
    }
    rows.push({ at: i, step: tr.step, key: deep?.key ?? null, line: deep?.line ?? 0, ms: tr.elapsedMs, bad: i === failIndex, skip: !ok(tr.result) && i !== failIndex });
  });
  const lineText = (k: OwnerKey | null, line: number, fallback: string) => {
    const raw = k ? (p.savedOf(k) ?? "").split("\n")[line - 1] : undefined;
    return raw ? raw.replace(/#.*$/, "").replace(/@\S+/g, "").replace(/\s+/g, " ").trim() || fallback : fallback;
  };
  const where = (r: (typeof rows)[number]) => {
    const st = task.steps.find((x) => x.id === r.step);
    if (!r.key || !st) return `步 ${task.steps.findIndex((x) => x.id === r.step) + 1}`;
    return r.key === ownerOfStep(st) ? `L${r.line}` : `${r.key.slice(8)} L${r.line}`;
  };
  const failRow = rows.find((r) => r.bad);
  /** Where a trial stopped, said whole: 「2 领奖 · L12」, or 「2 领奖 · 片段 open L3」. */
  const stopPlace = (r: (typeof rows)[number]) => {
    const i = task.steps.findIndex((x) => x.id === r.step);
    const st = task.steps[i];
    const name = st ? `${i + 1} ${str(st.name) ?? String(st.id)}` : `步 ${i + 1}`;
    if (!r.key || !st) return name;
    return r.key === ownerOfStep(st) ? `${name} · L${r.line}` : `${name} · 片段 ${r.key.slice(8)} L${r.line}`;
  };
  const stopped = run && !busy && !completed(run);
  const halted = run && (run.facts.some((f) => f.type === "stopped") || run.detail === "在控制台停止");
  const now = busy && run?.state === "RUNNING" ? rows.at(-1) : undefined;
  // Where it is: 排队 · 前面 N 个 → 准备 → 已发到手机 → 运行中 → the result.
  const phase = run?.phase ?? "";
  const [pill, tone]: [string, "ok" | "bad" | "info" | ""] = busy && run && run.state === "SENT" && phase === "queued"
      ? [run.queuePosition && run.queuePosition > 1 ? `排队 · 前面 ${run.queuePosition - 1} 个` : "排队 · 下一个", "info"]
    : busy && (!run || (run.state === "SENT" && phase === "preparing")) ? ["准备中", "info"]
    : busy && run?.state === "SENT" ? ["已发到手机", "info"]
    : busy ? [`运行中${now ? ` · ${where(now)}` : ""}`, "info"]
    : !run ? ["还没试跑", ""] : completed(run) ? ["通过", "ok"] : halted ? ["已停止", ""]
    : failRow ? [`停在 ${stopPlace(failRow)}`, "bad"] : ["没通过", "bad"];
  const secs = run ? Math.max(0, Math.round(((busy ? tick : run.updatedAt) - run.createdAt) / 1000)) : 0;
  const onPhone = busy && !!run && (run.state === "RUNNING" || (run.state === "SENT" && phase !== "queued" && phase !== "preparing"));
  const quiet = run ? Math.max(0, Math.round((tick - run.updatedAt) / 1000)) : 0;
  // The screen a failed trial stopped on comes a moment after the result: wait for it a while, then offer to ask again.
  const [late, setLate] = useState(false);
  const [asking, setAsking] = useState(false);
  const [asked, setAsked] = useState<string | null>(null);
  // Refused before it reached the phone (the server's compile): there is no screen to wait for.
  const unsent = !!run && run.phase === "done" && !run.traces.length && !run.facts.length;
  const waitingScreen = !!run && !busy && !completed(run) && !run.screen && !unsent;
  useEffect(() => {
    setLate(false); setAsked(null);
    if (!waitingScreen) return;
    const t = setTimeout(() => setLate(true), 15_000);
    return () => clearTimeout(t);
  }, [run?.id, waitingScreen]); // eslint-disable-line react-hooks/exhaustive-deps
  /** 重传画面: the phone sends the screen again; it arrives as a dev-run event (screen=true), read once more a little later too. */
  const askAgain = async () => {
    if (!run) return;
    setAsking(true); setAsked(null);
    try {
      await dev.resendScreen(run.id);
      setAsked("已请手机重传");
      const id = run.id;
      setTimeout(() => { dev.run(id).then(p.onRefresh, () => undefined); }, 6000);
    } catch (error) { setAsked(failure(error)); }
    setAsking(false);
  };
  // A 7×4 lineup alone makes 28 variants: show a few, the chosen one always among them, the rest behind ＋N.
  const [allValues, setAllValues] = useState(false);
  const every: [number, string][] = [...p.presets.map(([name], i) => [i, name] as [number, string]), ...(p.custom ? [[-1, "自定义"] as [number, string]] : [])];
  const SHOWN = 6;
  const chips = allValues || every.length <= SHOWN + 1 ? every
    : [...every.slice(0, SHOWN), ...every.slice(SHOWN).filter(([i]) => i === p.preset || i === -1)];
  const hidden = every.length - chips.length;
  const missedBoxes = missBoxes(failIndex >= 0 ? run!.traces[failIndex].trace : undefined);
  const refW = Number(run && failIndex >= 0 ? run.traces[failIndex].trace?.referenceWidth : 0) || 0;
  const refH = Number(run && failIndex >= 0 ? run.traces[failIndex].trace?.referenceHeight : 0) || 0;
  const stopPicture = run?.screen ? (
    <div className={s.screen}>
      <img src={dev.runScreen(run.id)} alt="停下时的画面" onLoad={(e) => setSize([e.currentTarget.naturalWidth, e.currentTarget.naturalHeight])}
        onError={(e) => { e.currentTarget.style.display = "none"; }} />
      {size && missedBoxes.map((m, i) => {
        const [bw, bh] = m.screen || !refW || !refH ? size : [refW, refH];
        return <span key={i} className={s.box} style={{ left: `${m.box[0] / bw * 100}%`, top: `${m.box[1] / bh * 100}%`, width: `${m.box[2] / bw * 100}%`, height: `${m.box[3] / bh * 100}%` }}>
          {m.label && <span className={s.boxLabel}>{m.label}</span>}</span>;
      })}
      <span className={s.caption}>停下时的画面{frames.length ? ` · 帧 ${frames.length}/${frames.length}` : ""}</span>
    </div>
  ) : null;
  const frame = view !== null ? frames[view] : undefined;
  return <>
    {canStep && <SegmentTabs label="范围" items={[["step", "本步"], ["task", "整个任务"]]} value={scope} onChange={p.setScope} />}
    {task.fields.length > 0 && <div className={s.line}>
      <Chips label="测试值" items={chips} value={p.preset} onChange={p.setPreset} disabled={busy} />
      {(hidden > 0 || allValues) && <button type="button" className={s.plus} onClick={() => setAllValues(!allValues)}>{allValues ? "收起" : `＋${hidden}`}</button>}
      <Link className={s.plus} to={devPaths.config(task.id)} title="在配置项页调一组值带回来">＋</Link>
    </div>}
    <div className={s.line}>
      {p.blockers > 0 && !busy && p.device && !p.offline
        ? <><button type="button" className={`${w.btn} ${w.primary} ${s.grow}`} onClick={p.onFix}>先修 {p.blockers} 处问题</button>
            <button type="button" className={`${s.linkish} ${w.muted} ${s.small}`} onClick={p.onStart}>仍要试跑</button></>
        : <button type="button" className={`${w.btn} ${w.primary} ${s.grow}`} disabled={busy || !p.device || p.offline}
        onClick={p.onStart}>{busy ? "试跑中…" : !p.device ? "顶栏选手机" : p.offline ? "手机离线" : scope === "step" ? "▶ 试跑本步" : "▶ 试跑整个任务"}</button>}
      {busy && run && <button type="button" className={w.btn} disabled={run.stopping}
        onClick={async () => { try { await dev.stopRun(run.id); } catch (error) { p.onMessage(failure(error)); } }}>{run.stopping ? "正在停…" : "停止"}</button>}
    </div>
    {scope === "step" && step && task.steps.indexOf(step) > 0 && !busy && <span className={w.muted}>本步会先跑第 1 步</span>}
    {p.error && !p.issues.length && <div role="alert" className={w.message}><Located text={p.error} body={p.body} /></div>}
    {p.issues.length > 0 && (() => {
      // Held back by the check: said once, with where.
      const first = p.issues[0]; const place = placeAt(first.where, p.body) ?? locate(first.location, p.body);
      return <div role="alert" className={s.blocked}><b>检查没过</b>
        {place ? <Link to={place.to} title={first.reason}>{place.label} ›</Link> : <span>{first.reason}</span>}
        {place && <span className={w.muted}>{first.reason}</span>}
        {p.issues.length > 1 && <span className={w.muted}>还有 {p.issues.length - 1} 处</span>}</div>;
    })()}
    {(run || p.preparing || busy) && !p.issues.length && <div className={s.line}>
      {run && (run.source === "phone" || (p.fromPhone && run.source !== "web")) ? <Pill tone="soft">{busy ? "来自手机 · 进行中" : "来自手机"}</Pill>
        : run && p.fromPhone ? <Pill tone="soft">来自别的窗口</Pill> : null}
      {failRow?.key && !busy ? <button type="button" className={s.linkish} onClick={() => p.onOpen(failRow.key!, failRow.line)}><Pill tone={tone || undefined}>{pill}</Pill></button>
        : <Pill tone={tone || undefined}>{pill}</Pill>}
      {run && <span className={w.muted}>{secs} 秒{run.frameCount ? ` · ${run.frameCount} 帧` : ""}</span>}
      {onPhone && (quiet > 60 ? <span className={`${s.late} ${s.small}`}>手机 {quiet} 秒没回报</span>
        : <span className={`${w.muted} ${s.small}`}>最后回报 {quiet} 秒前</span>)}
      <span className={s.grow} />
      {frames.length > 0 && <>
        <button type="button" className={`${w.btn} ${w.sm}`} aria-label="上一帧" disabled={view === 0} onClick={() => setView(view === null ? frames.length - 1 : Math.max(0, view - 1))}>◀</button>
        <button type="button" className={`${w.btn} ${w.sm}`} aria-label="下一帧" disabled={view === null} onClick={() => setView(view === null || view >= frames.length - 1 ? null : view + 1)}>▶</button>
      </>}
    </div>}
    {stopped && p.why && <div className={s.why}>{p.why}</div>}
    {stopped && !p.why && !halted && !p.issues.length && run?.detail && <div className={s.why}><Located text={run.detail} body={p.body} /></div>}
    {frame ? <>
      <FrameView frame={frame} />
      <span className={w.muted}>帧 {view! + 1}/{frames.length}{frame.lookMs > 0 ? ` · ${frame.lookMs}ms` : ""}{frame.matched.length ? ` · 命中 ${frame.matched.join("、")}` : ""}</span>
    </> : stopped && (stopPicture
      ? <FrameTools key={run!.id} picture={stopPicture} target={p.target} assets={p.backHere} makeSample={() => dev.keepRunScreen(run!.id)} />
      : !halted && !unsent && (late
        ? <div className={s.line}><span className={w.muted}>{asked ?? "停下画面没传上来"}</span>
            <button type="button" className={`${w.btn} ${w.sm}`} disabled={asking} onClick={() => void askAgain()}>{asking ? "请求中…" : "重传画面"}</button></div>
        : <span className={w.muted}>停下画面：等手机传上来…</span>))}
    {rows.length > 0 && (
      <div className={`${w.card} ${s.rows}`}>
        {rows.map((r) => {
          const tr = run!.traces[r.at];
          const score = scoreOf(tr);
          return <div key={r.at}>
            <div className={s.row} data-tone={r.bad ? "bad" : undefined}>
              <button type="button" className={s.rowMain} onClick={() => r.key && p.onOpen(r.key, r.line)}>
                <span className={s.ln}>{where(r)}</span>
                <span className={s.rowText}>{lineText(r.key, r.line, tr.capability.replace(/^\w+\./, ""))}{score ? ` · ${score}` : ""}</span>
                <span className={w.muted}>{r.ms >= 100 ? `${(r.ms / 1000).toFixed(1)}s` : ""}</span>
              </button>
              {isObj(tr.trace?.lastPoll) && <button type="button" className={s.expand} aria-label="看这一轮耗时" aria-expanded={open === r.at} onClick={() => setOpen(open === r.at ? null : r.at)}>›</button>}
            </div>
            {open === r.at && <div className={s.poll}>{poll(tr)}</div>}
          </div>;
        })}
      </div>
    )}
  </>;
}

/** A script changed elsewhere while it was edited here: both sides, line by line, and which to keep. */
function Conflict({ theirs, mine, busy, onMine, onTheirs }: { theirs: string; mine: string; busy: boolean; onMine: () => void; onTheirs: () => void }) {
  const lines = lineDiff(theirs, mine);
  const shown = lines.filter((l, i, all) => l.kind !== "same" || all.slice(Math.max(0, i - 2), i + 3).some((x) => x.kind !== "same"));
  return (
    <div className={`${w.card} ${s.conflict}`} role="alert">
      <b>别处改过这段脚本（你开始编辑之后）</b>
      <span className={w.muted}>− 别处的 · + 我的</span>
      <div className={pub.diff}>
        {shown.map((l, i) => <div key={i} className={pub.diffLine} data-kind={l.kind}><span className={pub.ln}>{l.kind === "add" ? l.b : l.a}</span><span>{l.kind === "add" ? "+" : l.kind === "del" ? "−" : " "} {l.text}</span></div>)}
      </div>
      <div className={s.toolRow}>
        <button type="button" className={`${w.btn} ${w.sm} ${w.primary}`} disabled={busy} onClick={onMine}>用我的</button>
        <button type="button" className={`${w.btn} ${w.sm}`} disabled={busy} onClick={onTheirs}>用别处的</button>
      </div>
    </div>
  );
}

/** The best score a look reached ("0.97"), or a colour's difference. */
function scoreOf(tr: DevTrace): string {
  const t = tr.trace; if (!t) return "";
  const scores = Array.isArray(t.scores) ? t.scores.map(Number).filter((n) => !Number.isNaN(n)) : [];
  if (scores.length) return `最高 ${Math.max(...scores).toFixed(2)}`;
  if (typeof t.score === "number") return t.score.toFixed(2);
  return "";
}
/** Where the last look's time went: the capture, each recognition call, the whole look. */
function poll(tr: DevTrace): string {
  const lp = isObj(tr.trace?.lastPoll) ? tr.trace!.lastPoll : {};
  const parts: string[] = [];
  if (typeof lp.snapMs === "number") parts.push(`截图 ${lp.snapMs}ms`);
  if (typeof lp.lookMs === "number") parts.push(`识别 ${lp.lookMs}ms`);
  const calls = Array.isArray(lp.inspect) ? lp.inspect.filter(isObj) : [];
  if (calls.length) parts.push(`${calls.length} 次识别调用`);
  if (typeof tr.trace?.polls === "number") parts.push(`${tr.trace.polls} 轮`);
  return parts.join(" · ") || "没有记录";
}

/**
 * 画面: the phone's screen as it is now. 看一张 takes one picture through the server. 实时 tries to see it directly
 * (WebRTC, the server only introduces the two) and shows each picture as soon as the last has come; where no direct
 * path can be found it takes them through the server instead, one after the other. Says which it is.
 */
function Peek({ device, onShown }: { device: string; onShown?: (url: string | null) => void }) {
  const [shown, setShown] = useState<{ url: string; at: number } | null>(null);
  const [mode, setMode] = useState<"off" | "connecting" | "direct" | "relay">("off");
  const [rate, setRate] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [why, setWhy] = useState<string | null>(null);
  const alive = useRef(true);
  const session = useRef(0);
  useEffect(() => () => { alive.current = false; session.current++; }, []);
  useEffect(() => { onShown?.(shown?.url ?? null); return () => { if (shown) URL.revokeObjectURL(shown.url); }; }, [shown]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => onShown?.(null), []); // eslint-disable-line react-hooks/exhaustive-deps
  const showUrl = (url: string) => { if (alive.current) setShown({ url, at: Date.now() }); else URL.revokeObjectURL(url); };
  const once = async () => {
    setBusy(true); setWhy(null);
    try { showUrl(await dev.peek(device)); } catch (error) { if (alive.current) setWhy(failure(error)); }
    finally { if (alive.current) setBusy(false); }
  };
  const stop = () => { session.current++; setMode("off"); setRate(null); };
  const live = async () => {
    const mine = ++session.current;
    const on = () => alive.current && session.current === mine;
    setWhy(null); setMode("connecting");
    let direct: DirectScreen | null = null;
    try { direct = await openDirect(device); } catch (error) { if (on()) setWhy(`${error instanceof Error ? error.message : "直连没打通"} · 改走服务器`); }
    if (!on()) { direct?.close(); return; }
    setMode(direct ? "direct" : "relay");
    const times: number[] = [];
    try {
      while (on()) {
        const url = direct ? await direct.next() : await dev.peek(device);
        if (!on()) { URL.revokeObjectURL(url); break; }
        showUrl(url);
        times.push(Date.now()); while (times.length > 6) times.shift();
        if (times.length > 1) setRate((times.length - 1) * 1000 / (times.at(-1)! - times[0]));
        // Through the server one picture follows the last, a moment apart, so it never piles up there.
        if (!direct) await new Promise((r) => setTimeout(r, 300));
      }
    } catch (error) { if (on()) { setWhy(error instanceof Error ? error.message : failure(error)); stop(); } }
    finally { direct?.close(); }
  };
  const label = mode === "direct" ? "直连" : mode === "relay" ? "经服务器" : mode === "connecting" ? "连接中…" : "";
  return <>
    <div className={s.line}>
      <button type="button" className={`${w.btn} ${w.sm}`} aria-pressed={mode !== "off"} onClick={() => mode === "off" ? void live() : stop()}>{mode === "off" ? "实时画面" : "停止实时"}</button>
      <button type="button" className={`${w.btn} ${w.sm}`} disabled={busy || mode !== "off"} onClick={() => void once()}>{busy ? "截屏中…" : "看一张"}</button>
    </div>
    {why && <span className={w.muted}>{why}</span>}
    {shown && <figure className={s.peek}><img src={shown.url} alt="手机现在的画面" />
      <figcaption className={w.muted}>{new Date(shown.at).toTimeString().slice(0, 8)}{label ? ` · ${label}` : ""}{mode !== "off" && rate ? ` · ${rate.toFixed(1)} 帧/秒` : ""}</figcaption></figure>}
  </>;
}

/** The settings a run condition can test: single and multiple choices, and switches. */
const testable = (fields: Obj[]) => fields.filter((f) => f.widget === "SWITCH" || ((f.widget === "SINGLE_CHOICE" || f.widget === "MULTI_CHOICE") && objs(f.options).length > 0));
/** The setting a new condition most likely tests: one no step is conditioned on yet, a switch before a choice, then the first. */
function likely(choices: Obj[], used: string[]): Obj {
  const fresh = choices.filter((f) => !used.includes(String(f.id)));
  return fresh.find((f) => f.widget === "SWITCH") ?? fresh[0] ?? choices[0];
}
/** A condition on [field] that holds for its first value: the editor's starting point. */
function firstCondition(field: Obj): Obj {
  if (field.widget === "SWITCH") return { field: String(field.id), equals: true };
  const first = str(objs(field.options)[0]?.value) ?? "";
  return field.widget === "MULTI_CHOICE" ? { field: String(field.id), contains: first } : { field: String(field.id), equals: first };
}

/** 准入 as a pill ("准入：收取结界 = 开"); clicked, it opens into the setting, is / is not, and the value. */
function RunCondition({ step, fields, editing, setEditing, onChange }: { step: Obj; fields: Obj[]; editing: boolean; setEditing: (v: boolean) => void; onChange: (next: Obj | null) => void }) {
  const choices = testable(fields);
  const when = isObj(step.when) ? step.when : null;
  const field = when ? fields.find((f) => f.id === when.field) : undefined;
  if (!when) return null;
  const multi = field?.widget === "MULTI_CHOICE";
  const toggle = field?.widget === "SWITCH";
  const value = multi ? str(when.contains) : when.equals === true ? "true" : when.equals === false ? "false" : str(when.equals);
  const options: [string, string][] = toggle ? [["true", "开"], ["false", "关"]] : objs(field?.options).map((o) => [str(o.value) ?? "", str(o.label) ?? ""]);
  const set = (v: string, not: boolean) => onChange({ field: String(when.field), ...(multi ? { contains: v } : { equals: toggle ? v === "true" : v }), ...(not ? { not: true } : {}) });
  const said = `${str(field?.label) ?? String(when.field)} ${multi ? (when.not === true ? "不含 " : "含 ") : when.not === true ? "不是 " : ""}${options.find(([v]) => v === value)?.[1] ?? value ?? ""} 才跑`;
  if (!editing) return <button type="button" className={s.linkish} title="点开修改" onClick={() => setEditing(true)}><Tag>{said}</Tag></button>;
  return (
    <span className={s.cond}>
      <select aria-label="按哪个配置项" className={s.select} value={String(when.field)} onChange={(e) => { const f = choices.find((x) => x.id === e.target.value); if (f) onChange(firstCondition(f)); }}>
        {!choices.some((f) => f.id === when.field) && <option value={String(when.field)}>{str(field?.label) ?? String(when.field)}（{field ? "不能用" : "找不到"}）</option>}
        {choices.map((f) => <option key={String(f.id)} value={String(f.id)}>{str(f.label) ?? String(f.id)}</option>)}
      </select>
      <select aria-label="判断" className={s.select} value={when.not === true ? "not" : "is"} onChange={(e) => set(value ?? "", e.target.value === "not")}>
        <option value="is">{multi ? "含" : "是"}</option><option value="not">{multi ? "不含" : "不是"}</option>
      </select>
      <select aria-label="值" className={s.select} value={value ?? ""} onChange={(e) => set(e.target.value, when.not === true)}>
        {options.map(([v, name]) => <option key={v} value={v}>{name}</option>)}
      </select>
      <span className={s.muted}>才跑</span>
      <button type="button" className={`${w.btn} ${w.sm}`} onClick={() => setEditing(false)}>好</button>
      <button type="button" className={`${w.btn} ${w.sm}`} onClick={() => { setEditing(false); onChange(null); }}>去掉</button>
    </span>
  );
}

/** Where an issue is: the server's [CheckIssue.where], or for an older server read from its location. */
function whereOf(x: CheckIssue): IssueWhere {
  if (x.where) return x.where;
  const loc = x.location;
  const after = (word: string) => { const parts = loc.split("/"); const i = parts.indexOf(word); return i >= 0 ? parts[i + 1] : undefined; };
  const line = /\/script\/line\/(\d+)$/.exec(loc)?.[1];
  return { task: after("task") ?? null, step: after("step") ?? null, snippet: loc.startsWith("snippet/") ? loc.split("/")[1] : null, line: line ? Number(line) : null };
}
/** A server issue that only warns (it does not stop a publish). */
const isWarning = (x: { severity?: string }) => x.severity === "warning" || x.severity === "warn";
/** The server's issue narrowed to the part of the line the local check found for the same thing, when it did. */
function placeIn(local: { line: number; col: number; len: number }[], line: number): { col?: number; len?: number } {
  const hit = local.find((x) => x.line === line);
  return hit ? { col: hit.col, len: hit.len } : {};
}
