import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Chips, MoreMenu, Pill, SegmentTabs } from "../../components/ui";
import { Link, navigate, usePath, useQuery } from "../../router";
import { dev, follow, type DevRun, type DevTrace, type Obj, type Sample } from "./api";
import { devPaths, EDIT_CONFLICT, failure, useDev, type Edit } from "./context";
import { startedHere, useDevRun } from "./events";
import { FrameTools } from "./FrameTools";
import { FrameView, useFrames } from "./FrameReplay";
import { uniqueId } from "./HomePage";
import { isObj, nodeDigest, objs, snippets, str, target, tasks, usedSnippets, type TaskDef } from "./model";
import { NameButton } from "./NameButton";
import { openDirect, type DirectScreen } from "./direct";
import { completed, failedAt, failReason, insertAfter, missBoxes, ok, ownerOfStep, placeOf, running, snippetKey, testValues, type OwnerKey } from "./runs";
import type { InsertTarget } from "./sentence";
import { lineDiff, useDevice } from "./wb";
import { Located } from "./where";
import pub from "./Publish.module.css";
import type { LineFailure, LineMark, ScriptNames, ScriptProblem, TemplateView } from "./ScriptEditor";
import { lintSettings, readsAsNumber, settingView, type SettingView } from "./settingUse";
import w from "./Wb.module.css";
import s from "./Workspace.module.css";

// The editor (CodeMirror) loads only when a script is opened, so the rest of the console stays light.
const ScriptEditor = lazy(() => import("./ScriptEditor").then((m) => ({ default: m.ScriptEditor })));

const CATEGORY: Record<string, string> = { daily: "日常", weekly: "每周", event: "活动", account: "账号" };

/** What a script may say, one line each (docs/design/task-script.md). */
const HELP: [string, string][] = [
  ["去 结界突破", "按页面图走过去"],
  ["等 \"文字\"@区域", "等到这行字"],
  ["点 \"文字\"@区域 [最多 N 次]", "等到、找到、点它"],
  ["清零 认输", "清零已点次数"],
  ["点 图 模板@区域 [最上]", "点图标"],
  ["点 … 偏 dx,dy [空白]", "点目标旁边"],
  ["分情况 / 名字 条件", "等到其一，走那支"],
  ["如果看到 / 如果没看到 条件", "连续 2 帧再判断"],
  ["色 x,y#RRGGBB … / 色 组名@x,y", "取色点，最快"],
  ["点 色 组名@x,y [偏 dx,dy]", "点取色组中心"],
  ["如果有 条件 / 否则", "只看刚等到的画面"],
  ["如果红点@区域 / 否则", "有没有红点"],
  ["如果颜色@区域 r,g,b~r,g,b N%", "这种颜色够不够多"],
  ["按设置 配置项 / 值", "开 关 其他 没有值"],
  ["直到 条件 最多 N 次", "反复做，到了就停"],
  ["反复 最多 N 次 / 跳出", "到了就跳出"],
  ["逐个 名 在 甲,乙", "每个值做一遍；{名}"],
  ["扫描网格 x,y 列x行 步进 dx,dy 格大小 w,h: 条件", "一帧扫网格"],
  ["拖 \"锚\"@区域 偏 dx,dy 到 dx,dy", "从锚点旁拖"],
  ["启动游戏", "启动并等到前台"],
  ["用 片段", "调用片段"],
  ["上报 \"悬赏邀请\"", "排后续任务"],
  ["结果 \"…\" / 停下 \"…\"", "写结果 / 停下"],
  ["长等待 300秒 / 等待 2秒", "放宽看门狗 / 干等"],
];

type Tab = "run" | "problems" | "screen" | "help";
type Issue = { line: number | null; reason: string; location: string; warning?: boolean };

/**
 * 工作区: a task (or, with no task, the snippet library) as one page — steps on the left, the script in the middle,
 * and on the right the trial: where it stopped and why, the screen it stopped on with the tools to make the missing
 * condition there, and every line it ran. The loop write → check → run → fix → run again stays on this page.
 */
export function Workspace({ task: taskId, step: stepId, snippet: snippetId }: { task?: string; step?: string; snippet?: string }) {
  const { draft, game, apply, reloadTrials, edits: allEdits, setEdit: putEdit, saveScript, conflicts, device } = useDev();
  const phone = useDevice();
  const path = usePath();
  const query = useQuery();
  const body = draft?.body;
  const task = body && taskId ? tasks(body).find((t) => t.id === taskId) : undefined;
  const allSnippets = body ? snippets(body) : [];
  const step = task && !snippetId ? task.steps.find((st) => st.id === stepId) ?? task.steps[0] : undefined;
  const snippetOnly = !taskId ? snippetId ?? String(allSnippets[0]?.id ?? "") : undefined;
  const key: OwnerKey | null = snippetId ? snippetKey(snippetId) : step ? ownerOfStep(step) : snippetOnly ? snippetKey(snippetOnly) : null;

  /** The step or snippet a key names, in [b]. */
  const ownerIn = useCallback((b: Obj, k: OwnerKey): Obj | undefined => k.startsWith("step:")
    ? tasks(b).find((t) => t.id === taskId)?.steps.find((st) => st.id === k.slice(5))
    : snippets(b).find((sn) => sn.id === k.slice(8)), [taskId]);
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
  useEffect(() => { setCursor(null); }, [key]);
  const owner = body && key ? ownerIn(body, key) : undefined;
  const saved = key ? savedOf(key) : undefined;
  const isScript = typeof saved === "string";
  const text = key && edits[key] !== undefined ? edits[key] : saved ?? "";
  const textNow = useRef(text); textNow.current = text;
  const dirtyKeys = Object.keys(edits).filter((k) => savedOf(k) !== undefined && edits[k] !== savedOf(k));
  const dirty = !!key && dirtyKeys.includes(key);

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

  // ---- checking: the draft as it would be with this text, a moment after typing stops
  const [issues, setIssues] = useState<Issue[] | null>(null);
  const [others, setOthers] = useState<Issue[]>([]);
  const prefix = !key ? "" : key.startsWith("snippet:") ? `snippet/${key.slice(8)}` : `target/${String(task?.raw.targetId ?? "")}/task/${taskId}/step/${key.slice(5)}`;
  useEffect(() => {
    if (!body || !key || !isScript) { setIssues([]); setOthers([]); return; }
    let live = true; setIssues(null);
    const timer = setTimeout(async () => {
      const copy = JSON.parse(JSON.stringify(body)) as Obj;
      const mine = ownerIn(copy, key); if (!mine) return;
      mine.script = text;
      try {
        const result = await dev.check(copy);
        if (!live) return;
        // This script's, then the rest of the task's: its other steps and the snippets it uses.
        const used = task ? usedSnippets(copy, task.raw).map((id) => `snippet/${id}`) : [];
        const taskAt = task ? `target/${String(task.raw.targetId ?? "")}/task/${taskId}` : null;
        const within = (loc: string, at: string) => loc === at || loc.startsWith(`${at}/`);
        // Errors, then warnings (a separate list now; an issue's own severity is still read for older servers).
        const all = [...result.issues.map((x) => ({ ...x, warning: isWarning(x) })), ...(result.warnings ?? []).map((x) => ({ ...x, warning: true }))];
        setIssues(all.filter((x) => within(x.location, prefix)).map((x) => {
          const at = /\/script\/line\/(\d+)$/.exec(x.location);
          const line = x.where?.line ?? (at ? Number(at[1]) : null);
          return { line, reason: x.reason, location: x.location, warning: x.warning };
        }));
        setOthers(all.filter((x) => !within(x.location, prefix) && ((taskAt && within(x.location, taskAt)) || used.some((at) => within(x.location, at))))
          .map((x) => ({ line: null, reason: x.reason, location: x.location, warning: x.warning })));
      } catch (error) { if (live) { setIssues([{ line: null, reason: `检查没做成：${failure(error)}`, location: "" }]); setOthers([]); } }
    }, 600);
    return () => { live = false; clearTimeout(timer); };
  }, [text, body, key]); // eslint-disable-line react-hooks/exhaustive-deps
  // Settings read wrong, found on the spot while the server's check (half a minute) is still out; its answer then wins.
  const local = useMemo(() => isScript ? lintSettings(text, task ? task.fields : null, !!key?.startsWith("snippet:")) : [], [text, task, isScript, key]);
  const problems = useMemo((): ScriptProblem[] => issues === null
    ? local.map((x) => ({ line: x.line, reason: x.reason, severity: x.severity, col: x.col, len: x.len }))
    : issues.flatMap((x) => x.line === null ? [] : [{ line: x.line, reason: x.reason, severity: x.warning ? "warning" as const : "error" as const,
      ...placeIn(local, x.line) }]), [issues, local]);

  // ---- completion and template pictures
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
      numberFields: (task?.fields ?? []).filter(readsAsNumber).map((f) => ({ id: String(f.id), label: str(f.label) ?? String(f.id) })),
      pages: objs(library.pages).map((p) => str(p.name) ?? String(p.id)),
    };
  }, [body, task, key]); // eslint-disable-line react-hooks/exhaustive-deps
  const [sizes, setSizes] = useState<Record<string, string>>({});
  useEffect(() => {
    dev.templates(game).then((list) => {
      const grouped = new Map<string, { dim: string; count: number }>();
      for (const t of list) {
        const base = t.id.split("@")[0];
        const prev = grouped.get(base);
        grouped.set(base, prev ? { dim: prev.dim, count: prev.count + 1 } : { dim: `${t.width}×${t.height}`, count: 1 });
      }
      setSizes(Object.fromEntries(Array.from(grouped.entries()).map(([k, v]) => [k, v.count > 1 ? `${v.dim} · ${v.count} 套主题` : v.dim])));
    }).catch(() => undefined);
  }, [game]);
  const setting = useCallback((id: string): SettingView | null => {
    const f = task?.fields.find((x) => String(x.id) === id);
    return f && task ? settingView(f, task.steps, `${devPaths.config(task.id)}?field=${encodeURIComponent(id)}`) : null;
  }, [task]);
  const template = useCallback((name: string): TemplateView | null => names.templates.includes(name) ? { src: dev.templateImage(game, name), meta: sizes[name] ?? "模板" } : null, [names, game, sizes]);

  // ---- trials: the task's newest one, followed while it goes on
  const [run, setRun] = useState<DevRun | null>(null);
  // Starting: the server compiles the draft first (about half a minute), then the phone takes it.
  const [preparing, setPreparing] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
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
  const presets = task ? testValues(task.fields) : [];
  const values = preset === -1 && custom ? custom : presets[preset]?.[1] ?? presets[0]?.[1] ?? {};
  const start = async () => {
    if (!task || !device || startingRef.current) return;
    startingRef.current = true; setStarting(true);
    setMessage(null); setTab("run"); setRunError(null);
    // The old result goes at once: what shows now is this trial's.
    shown.current = ""; setRun(null); setFromPhone(false);
    try {
      for (const k of dirtyKeys) if (!await save(k)) { setRunError("有脚本没保存成，没开始试跑"); return; }
      const only = scope === "step" && step && !snippetId ? String(step.id) : undefined;
      setPreparing(true);
      const started = await dev.startRun({ kind: "trial", target: game, device, task: task.id, step: only, configuration: values });
      startedHere.add(started.id);
      setPreparing(false);
      shown.current = started.id; setRun(started);
      const done = await follow(started.id, show);
      await reloadTrials();
      if (done) for (let i = 0; i < 10 && shown.current === started.id && !(await dev.run(started.id).then((x) => {
        show(x); return (completed(done) || !!x.screen) && !!x.framesUploaded;
      }).catch(() => false)); i++)
        await new Promise((resolve) => setTimeout(resolve, 1500));
    } catch (error) { setRunError(failure(error)); }
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

  if (!draft || !body) return null;
  if (taskId && !task) return <div className={s.missing}><div className={w.card}><div className={w.empty}>草稿里没有这个任务</div></div></div>;

  const busy = starting || running(run);
  const openKey = (k: OwnerKey, line?: number) => {
    if (line) setGoTo({ key: k, line, at: Date.now() });
    if (!task) { navigate(devPaths.snippet(k.slice(8))); return; }
    const st = task.steps.find((x) => ownerOfStep(x) === k);
    navigate(st ? devPaths.step(task.id, String(st.id)) : devPaths.taskSnippet(task.id, k.slice(8)));
  };
  openKeyRef.current = (k) => openKey(k);
  const lines = (k: OwnerKey) => (savedOf(k) ?? "").split("\n").length;
  const uses = (id: string) => tasks(body).filter((t) => usedSnippets(body, t.raw).includes(id)).length;
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
  const tabs: [Tab, string][] = [...(task ? [["run", "试跑"] as [Tab, string]] : []), ["problems", issues?.length || others.length ? `问题 ${(issues?.length ?? 0) + others.length}` : "问题"], ["screen", "画面"], ["help", "写法"]];

  return (
    <div className={s.layout}>
      <nav aria-label="步骤和片段" className={s.tree}>
        {task ? <>
          <div className={s.taskHead}>
            <b className={s.taskName} title={task.name}>{task.name}</b>
            <span className={w.muted}>{category} · <Link to={devPaths.config(task.id)}>配置 {task.fields.length} ›</Link></span>
          </div>
          <Steps task={task} current={step && !snippetId ? String(step.id) : null} run={run} failIndex={failIndex} dirty={dirtyKeys} lines={lines}
            onAdd={async (name, wanted) => {
              const sid = uniqueId(wanted || name, task.steps.map((x) => String(x.id)), "step");
              const problem = await apply([{ op: "insert", path: `tasks:${task.id}`, field: "steps", after: task.steps.length ? String(task.steps.at(-1)!.id) : null, value: { id: sid, name, script: "" } }]);
              if (problem) say(problem); else navigate(devPaths.step(task.id, sid));
            }} />
        </> : <div className={s.taskHead}><b>片段</b><span className={w.muted}>{allSnippets.length} 个</span></div>}
        <SnippetList ids={task ? usedSnippets(body, task.raw) : allSnippets.map((sn) => String(sn.id))} title={task ? "用到的片段" : ""} current={key} dirty={dirtyKeys} uses={uses} onOpen={openKey} />
        {task && <AllSnippets ids={allSnippets.map((sn) => String(sn.id)).filter((id) => !usedSnippets(body, task.raw).includes(id))} current={key} uses={uses} onOpen={openKey} />}
      </nav>

      <section aria-label="脚本" className={s.editor}>
        {message && <div role="status" className={message[1] ? `${w.muted} ${w.okText}` : w.message}>{message[0]}</div>}
        {key && owner ? <>
          <div className={s.bar}>
            <b className={s.barName}>{stepNo ? `${stepNo} · ` : ""}{label}</b>
            {task && step && !snippetId && <StepTools task={task} step={step} apply={apply} onMessage={say} onRemoved={() => setEdit(ownerOfStep(step), undefined)} />}
            {key.startsWith("snippet:") && <Pill>片段 · 用在 {uses(key.slice(8))} 处</Pill>}
            <span className={s.grow} />
            {isScript && <span className={w.muted}>{issues === null ? "检查中…" : issues.length ? <button type="button" className={s.linkish} onClick={() => setTab("problems")}>{issues.length} 处问题</button> : "没问题"}</span>}
            {dirty && <span className={s.unsaved}>{conflicted ? "冲突" : "未保存"}</span>}
            {isScript && <button type="button" className={`${w.btn} ${w.sm} ${dirty ? w.primary : ""}`} disabled={saving || !dirty || conflicted} onClick={() => void save(key)}>
              {saving ? "保存中…" : <>保存 <kbd className={s.kbd}>⌘S</kbd></>}</button>}
          </div>
          {conflicted && isScript && <Conflict theirs={saved ?? ""} mine={text} busy={saving}
            onMine={async () => { if (await save(key, true)) say(null); }}
            onTheirs={() => { setEdit(key, undefined); setMessage(["已换成别处的版本", true]); }} />}
          {isScript ? (
            <div className={`${w.card} ${s.script}`}>
              <Suspense fallback={<div className={w.empty}>正在打开编辑器…</div>}>
                <ScriptEditor key={key} value={text} onChange={(v) => setEdit(key, v === saved ? undefined : v)} onSave={() => { if (!conflicted) void save(key); }} onCursor={setCursor}
                  problems={problems} names={names} goTo={goTo && goTo.key === key ? goTo : null} onJumped={() => setGoTo(null)} marks={marks} failure={failed} template={template} setting={setting} />
              </Suspense>
            </div>
          ) : (
            <div className={`${w.card} ${s.blocks}`}>
              <b>这{key.startsWith("snippet:") ? "个片段" : "一步"}是积木写的</b>
              <Link className={w.btn} to={key.startsWith("snippet:") ? devPaths.snippetBlocks(key.slice(8)) : devPaths.blocks(taskId!, key.slice(5))}>打开积木</Link>
            </div>
          )}
        </> : <div className={`${w.card} ${w.empty}`}>{task ? "还没有步骤 · 在左边加一步" : "还没有片段"}</div>}
      </section>

      <aside aria-label="试跑 · 问题 · 画面 · 写法" className={s.aside}>
        <div role="tablist" aria-label="右侧面板" className={s.tabs}>
          {tabs.map(([id, name]) => <button key={id} type="button" role="tab" className={s.tab} aria-selected={tab === id} onClick={() => setTab(id)}>{name}</button>)}
        </div>
        <div className={s.panel}>
          {task && tab === "run" && (
            <RunPanel task={task} step={step} snippetOpen={!!snippetId} run={run} busy={busy} device={device} offline={offline} failIndex={failIndex} places={places} savedOf={savedOf}
              why={why} scope={scope} setScope={setScope} presets={presets} custom={custom} preset={preset} setPreset={setPreset}
              preparing={preparing} error={runError} fromPhone={fromPhone} body={body} onRefresh={(x) => { if (shown.current === x.id) setRun(x); }}
              onStart={() => void start()} onOpen={openKey} onMessage={(t) => setRunError(t)} target={insertTarget} backHere={backHere} />
          )}
          {tab === "problems" && (issues === null ? <>
            <span className={w.muted}>检查中…{local.length ? " 先看本地查到的：" : ""}</span>
            {local.map((x, i) => <button key={i} type="button" className={s.problem} onClick={() => key && setGoTo({ key, line: x.line, at: Date.now() })}>
              <span className={s.ln}>L{x.line}</span>{x.severity === "warning" && <span className={s.warnTag}>提醒</span>}{x.reason}</button>)}
          </> : <>
            <div className={s.group}>本脚本</div>
            {issues.length === 0 ? <span className={w.muted}>没问题</span>
              : issues.map((x, i) => <button key={i} type="button" className={s.problem} onClick={() => key && x.line !== null && setGoTo({ key, line: x.line, at: Date.now() })}>
                {x.line !== null && <span className={s.ln}>L{x.line}</span>}{x.warning && <span className={s.warnTag}>提醒</span>}{x.reason}</button>)}
            {task && <>
              <div className={s.group}>这个任务用到的</div>
              {others.length === 0 ? <span className={w.muted}>没问题</span>
                : others.map((x, i) => <div key={i} className={s.problem}><Located text={x.location} body={body} />：{x.reason}</div>)}
            </>}
          </>)}
          {tab === "screen" && (device
            ? <FrameTools key={device} picture={<Peek device={device} />} target={insertTarget} assets={backHere}
                makeSample={() => sampleNow(game, device)} />
            : <span className={w.muted}>顶栏选一台手机</span>)}
          {tab === "help" && <div className={s.help}>
            {HELP.map(([sayIt, does]) => <div key={sayIt}><code>{sayIt}</code><span className={w.muted}>{does}</span></div>)}
            <span className={w.muted}>区域 @x,y,宽,高 · 条件用“且”连 · # 后是注释</span>
          </div>}
        </div>
      </aside>
    </div>
  );
}

/** Has the phone take a sample of its screen now, and gives it once it is stored. */
async function sampleNow(game: string, device: string): Promise<Sample> {
  const run = await dev.startRun({ kind: "sample", target: game, device, name: "画面" });
  const done = await follow(run.id, () => {});
  if (done.state !== "FINISHED") throw new Error(done.detail || "没采到");
  const all = await dev.samples(game);
  const made = all.find((x) => x.id === done.sample) ?? all[0];
  if (!made) throw new Error("没采到");
  return made;
}

/** The task's steps, each with how the trial shown went on it (• = not saved), and a way to add one. */
function Steps({ task, current, run, failIndex, dirty, lines, onAdd }: { task: TaskDef; current: string | null; run: DevRun | null; failIndex: number;
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
        <Link key={sid} to={devPaths.step(task.id, sid)} className={s.item} aria-current={current === sid ? "page" : undefined} title={what}>
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
    {provided.length > 0 && <Link to={devPaths.config(task.id)} title={provided.map((f) => str(f.label) ?? String(f.id)).join("、")}><Pill>提供 {provided.length} 项</Pill></Link>}
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
  preparing: boolean; error: string | null; fromPhone: boolean; body: Obj; onRefresh: (run: DevRun) => void;
  onStart: () => void; onOpen: (k: OwnerKey, line?: number) => void; onMessage: (text: string | null) => void;
  target: InsertTarget | null; backHere: string }) {
  const { task, step, run, busy, failIndex, places } = p;
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
  const stopped = run && !busy && !completed(run);
  const halted = run && (run.facts.some((f) => f.type === "stopped") || run.detail === "在控制台停止");
  const now = busy && run?.state === "RUNNING" ? rows.at(-1) : undefined;
  const [pill, tone]: [string, "ok" | "bad" | "info" | ""] = p.preparing ? ["服务器准备中（约 30 秒）", "info"]
    : busy ? [!run ? "开始中…" : run.state === "SENT" ? "等手机…" : `试跑中${now ? ` · ${where(now)}` : ""}`, "info"]
    : !run ? ["还没试跑", ""] : completed(run) ? ["通过", "ok"] : halted ? ["已停止", ""]
    : failRow ? [`停在 ${where(failRow)}`, "bad"] : ["没通过", "bad"];
  const secs = run ? Math.max(0, Math.round((run.updatedAt - run.createdAt) / 1000)) : 0;
  // The screen a failed trial stopped on comes a moment after the result: wait for it a while, then offer to ask again.
  const [late, setLate] = useState(false);
  const [asking, setAsking] = useState(false);
  const waitingScreen = !!run && !busy && !completed(run) && !run.screen;
  useEffect(() => {
    setLate(false);
    if (!waitingScreen) return;
    const t = setTimeout(() => setLate(true), 15_000);
    return () => clearTimeout(t);
  }, [run?.id, waitingScreen]); // eslint-disable-line react-hooks/exhaustive-deps
  const askAgain = async () => {
    if (!run) return;
    setAsking(true);
    try { const x = await dev.run(run.id); p.onRefresh(x); if (!x.screen) setLate(true); } catch (error) { p.onMessage(failure(error)); }
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
      <button type="button" className={`${w.btn} ${w.primary} ${s.grow}`} disabled={busy || !p.device || p.offline}
        onClick={p.onStart}>{busy ? "试跑中…" : !p.device ? "顶栏选手机" : p.offline ? "手机离线" : scope === "step" ? "▶ 试跑本步" : "▶ 试跑整个任务"}</button>
      {busy && run && <button type="button" className={w.btn} disabled={run.stopping}
        onClick={async () => { try { await dev.stopRun(run.id); } catch (error) { p.onMessage(failure(error)); } }}>{run.stopping ? "正在停…" : "停止"}</button>}
    </div>
    {scope === "step" && step && task.steps.indexOf(step) > 0 && !busy && <span className={w.muted}>本步会先跑第 1 步</span>}
    {p.error && <div role="alert" className={w.message}><Located text={p.error} body={p.body} /></div>}
    {(run || p.preparing || busy) && <div className={s.line}>
      {p.fromPhone && run && <Pill tone="soft">{busy ? "来自手机 · 进行中" : "来自手机"}</Pill>}
      {failRow?.key && !busy ? <button type="button" className={s.linkish} onClick={() => p.onOpen(failRow.key!, failRow.line)}><Pill tone={tone || undefined}>{pill}</Pill></button>
        : <Pill tone={tone || undefined}>{pill}</Pill>}
      {run && <span className={w.muted}>{secs} 秒{run.frameCount ? ` · ${run.frameCount} 帧` : ""}</span>}
      <span className={s.grow} />
      {frames.length > 0 && <>
        <button type="button" className={`${w.btn} ${w.sm}`} aria-label="上一帧" disabled={view === 0} onClick={() => setView(view === null ? frames.length - 1 : Math.max(0, view - 1))}>◀</button>
        <button type="button" className={`${w.btn} ${w.sm}`} aria-label="下一帧" disabled={view === null} onClick={() => setView(view === null || view >= frames.length - 1 ? null : view + 1)}>▶</button>
      </>}
    </div>}
    {stopped && p.why && <div className={s.why}>{p.why}</div>}
    {frame ? <>
      <FrameView frame={frame} />
      <span className={w.muted}>帧 {view! + 1}/{frames.length}{frame.lookMs > 0 ? ` · ${frame.lookMs}ms` : ""}{frame.matched.length ? ` · 命中 ${frame.matched.join("、")}` : ""}</span>
    </> : stopped && (stopPicture
      ? <FrameTools key={run!.id} picture={stopPicture} target={p.target} assets={p.backHere} makeSample={() => dev.keepRunScreen(run!.id)} />
      : !halted && (late
        ? <div className={s.line}><span className={w.muted}>停下画面没传上来</span>
            <button type="button" className={`${w.btn} ${w.sm}`} disabled={asking} onClick={() => void askAgain()}>{asking ? "获取中…" : "重新获取"}</button></div>
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
      <span className={w.muted}>− 别处的 · + 你的</span>
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
function Peek({ device }: { device: string }) {
  const [shown, setShown] = useState<{ url: string; at: number } | null>(null);
  const [mode, setMode] = useState<"off" | "connecting" | "direct" | "relay">("off");
  const [rate, setRate] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [why, setWhy] = useState<string | null>(null);
  const alive = useRef(true);
  const session = useRef(0);
  useEffect(() => () => { alive.current = false; session.current++; }, []);
  useEffect(() => () => { if (shown) URL.revokeObjectURL(shown.url); }, [shown]);
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

export const Back = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M14 5L7 12L14 19" /></svg>;

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
  const said = `准入：${str(field?.label) ?? String(when.field)} ${multi ? (when.not === true ? "不含" : "含") : when.not === true ? "≠" : "="} ${options.find(([v]) => v === value)?.[1] ?? value ?? ""}`;
  if (!editing) return <button type="button" className={s.linkish} title="点开修改" onClick={() => setEditing(true)}><Pill tone="soft">{said}</Pill></button>;
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

/** A server issue that only warns (it does not stop a publish). */
const isWarning = (x: { severity?: string }) => x.severity === "warning" || x.severity === "warn";
/** The server's issue narrowed to the part of the line the local check found for the same thing, when it did. */
function placeIn(local: { line: number; col: number; len: number }[], line: number): { col?: number; len?: number } {
  const hit = local.find((x) => x.line === line);
  return hit ? { col: hit.col, len: hit.len } : {};
}
