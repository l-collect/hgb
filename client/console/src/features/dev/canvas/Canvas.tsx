/**
 * 画板: a step's (or snippet's) script drawn as cards and lines (canvas-design Main/Nodes/Edges/Add/Drawer/Run/States/
 * ConfigCanvas). The script text is the only data: the board is read from it each time, and every change made here is
 * a change to the lines it touches, given back through [CanvasProps.onText] — the same unsaved text, saving and undo
 * the script view uses.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Background, BackgroundVariant, MarkerType, MiniMap, ReactFlow, ReactFlowProvider, useEdgesState, useNodesState, useReactFlow, useViewport,
  type Edge, type FinalConnectionState, type Node, type OnConnectStartParams } from "@xyflow/react";
import "@xyflow/react/dist/base.css";
import { redo as cmRedo, undo as cmUndo } from "@codemirror/commands";
import { EditorView } from "@codemirror/view";
import type { Obj } from "../api";
import { dev, type Sample } from "../api";
import { toPicture, useReference } from "../coords";
import { str } from "../model";
import { newestSample } from "../ScreenPick";
import type { ScriptNames, ScriptProblem } from "../ScriptEditor";
import { readsOf, valuesOf } from "../settingUse";
import { ConfigPanel } from "../config/ConfigPanel";
import { NewConfigDialog } from "../config/NewConfigDialog";
import { useTestValues } from "../config/testValues";
import { valueText } from "../config/fields";
import { ITEMS, MENUS, STARTERS, suggest, type Item, type MakeCtx } from "./catalog";
import { Drawer } from "./Drawer";
import { build, type EdgeData, type LookCtx, type Run, type StmtData } from "./graph";
import { Board, edgeTypes, nodeTypes, runText, type BoardApi, type StopData } from "./nodes";
import { allStmts, duplicate, insert, LOOPS, move, read, remove, removeProblem, setCode, splice, stmtAt, type Doc, type Kind, type Place } from "./script";
import c from "./Canvas.module.css";

export interface CanvasRun {
  /** By statement line: how the trial went there. */
  lines: Map<number, Run>;
  /** "a>b": the trial went from line a to line b. */
  walked: Set<string>;
  busy: boolean;
  failure: { line: number; text: string } | null;
  screen: string | null;
  secs: number;
  steps: number;
  passed: boolean;
}
export interface CanvasProps {
  text: string;
  onText: (next: string) => void;
  /** The text an undo / redo on the board left (the board's change too). */
  onBoardText: (text: string) => void;
  /** Why the board may not be changed now (a change made elsewhere waits for 用哪边), or null. */
  lock: string | null;
  taskId?: string; stepId?: string; fields: Obj[]; names: ScriptNames; game: string;
  problems: ScriptProblem[];
  run: CanvasRun | null;
  goTo: { line: number; at: number } | null; onJumped: () => void;
  onScript: (line?: number) => void; onSnippet: (name: string) => void;
  /** The script editor kept open behind the board: undo and redo are its history, shared with the script view. */
  editorRoot: HTMLElement | null;
  onSave: () => void; onRetry: (() => void) | null;
  /** Where the drawer shows (the right column), and whether it is open. */
  drawerHost: HTMLElement | null; onDrawer: (open: boolean) => void;
  regions: Record<string, number[]>; snippetLines: (name: string) => number | undefined;
  /** Kept folds are this script's (localStorage). */
  storeKey: string;
  saved: string;
}

export default function Canvas(p: CanvasProps) {
  return <ReactFlowProvider><Inner {...p} /></ReactFlowProvider>;
}

type Menu = { place: Place; x: number; y: number; compact: boolean; from: Kind | null; field?: boolean };
const FOLD_KEY = "hgb.dev.canvasFolds";
const readFolds = (k: string): string[] => { try { const all = JSON.parse(localStorage.getItem(FOLD_KEY) ?? "{}"); return Array.isArray(all[k]) ? all[k].filter((x: unknown) => typeof x === "string") : []; } catch { return []; } };
const writeFolds = (k: string, v: string[]) => { try { const all = JSON.parse(localStorage.getItem(FOLD_KEY) ?? "{}"); all[k] = v; localStorage.setItem(FOLD_KEY, JSON.stringify(all)); } catch { /* kept for this visit */ } };

function Inner(p: CanvasProps) {
  const rf = useReactFlow();
  const { zoom } = useViewport();
  const reference = useReference();
  const wrap = useRef<HTMLDivElement>(null);
  const doc = useMemo(() => read(p.text), [p.text]);
  // What cannot be drawn (indentation): the last board that could, read-only, until the script is fixed.
  const lastGood = useRef<Doc | null>(null);
  if (!doc.error) lastGood.current = doc;
  const shown = doc.error ? lastGood.current ?? read("") : doc;
  const readOnly = !!doc.error || !!p.lock;
  const [selected, setSelected] = useState<number | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const [hideRun, setHideRun] = useState(false);
  const [panel, setPanel] = useState(false);
  const [hotField, setHotField] = useState<string | null>(null);
  const [hoverEdge, setHoverEdge] = useState<string | null>(null);
  // Folds are kept by what the line says (and which of the lines saying it), so they stay put when lines move.
  const [foldAnchors, setFoldAnchors] = useState<Set<string>>(() => new Set(readFolds(p.storeKey)));
  useEffect(() => { if (!said) return; const t = setTimeout(() => setSaid(null), 2600); return () => clearTimeout(t); }, [said]);
  const middles = useRef(new Map<string, { x: number; y: number }>()).current;
  const { values } = useTestValues(p.taskId ?? "");
  const [sample, setSample] = useState<Sample | null>(null);
  useEffect(() => { let live = true; newestSample(p.game).then((x) => { if (live) setSample(x); }, () => undefined); return () => { live = false; }; }, [p.game]);

  // ---- what the cards say
  const reads = useMemo(() => readsOf(shown.text), [shown]);
  const ctx = useMemo((): LookCtx => {
    const byLine = new Map<number, string[]>();
    for (const r of reads.reads) if (r.kind === "number") byLine.set(r.line, [...(byLine.get(r.line) ?? []), r.field]);
    return {
      label: (id) => { const f = p.fields.find((x) => String(x.id) === id); return f ? str(f.label) ?? id : undefined; },
      test: (id) => { const f = p.fields.find((x) => String(x.id) === id); return f ? valueText(f, values[id] as never) : undefined; },
      reads: byLine, regions: p.regions, snippetLines: p.snippetLines,
    };
  }, [reads, p.fields, values, p.regions, p.snippetLines]);
  const hot = useMemo(() => hotField ? new Set(reads.reads.filter((r) => r.field === hotField).map((r) => r.line)) : null, [reads, hotField]);
  const issues = useMemo(() => {
    const m = new Map<number, { reason: string; warning: boolean }>();
    for (const x of p.problems) {
      const s = stmtAt(shown, x.line); if (!s) continue;
      const line = s.kind === "else" ? s.parent!.line : s.line;
      const was = m.get(line);
      if (!was || (was.warning && x.severity !== "warning")) m.set(line, { reason: x.reason, warning: x.severity === "warning" });
    }
    return m;
  }, [JSON.stringify(p.problems), shown]); // eslint-disable-line react-hooks/exhaustive-deps
  const run = p.run && !hideRun ? p.run : null;
  const anchors = useMemo(() => {
    const seen = new Map<string, number>(); const byLine = new Map<number, string>();
    for (const st of allStmts(shown)) { const n = (seen.get(st.text) ?? 0) + 1; seen.set(st.text, n); byLine.set(st.line, `${st.text}#${n}`); }
    return byLine;
  }, [shown]);
  const folds = useMemo(() => new Set([...anchors].filter(([, a]) => foldAnchors.has(a)).map(([l]) => l)), [anchors, foldAnchors]);
  const built = useMemo(() => build({ doc: shown, ctx, folded: folds, run: run?.lines ?? new Map(), walked: run?.walked ?? new Set(), issues, hot }), [shown, ctx, folds, run, issues, hot]);

  // The stop card beside the card the trial stopped on.
  const failNode = run?.failure && !run.busy ? built.nodes.find((n) => (n.data as StmtData).line === stmtAt(shown, run.failure!.line)?.line) : undefined;
  // The stop card's buttons call the newest handlers given; the card is redrawn only when what it shows changes
  // (whether 再试一次 shows among it), not on every render of the page around the board.
  const onScriptNow = useRef(p.onScript); onScriptNow.current = p.onScript;
  const onRetryNow = useRef(p.onRetry); onRetryNow.current = p.onRetry;
  const canRetry = !!p.onRetry;
  const allNodes = useMemo((): Node[] => {
    if (!failNode || !run?.failure) return built.nodes;
    let x = failNode.position.x, y = failNode.position.y; let at = failNode.parentId;
    while (at) { const par = built.nodes.find((n) => n.id === at); if (!par) break; x += par.position.x; y += par.position.y; at = par.parentId; }
    const line = run.failure.line;
    const data: StopData = { src: run.screen, why: run.failure.text, line, onScript: () => onScriptNow.current(line), onRetry: canRetry ? () => onRetryNow.current?.() : null };
    return [...built.nodes, { id: "stopcard", type: "stop", position: { x, y: y + (failNode.height ?? 80) + 28 }, data, width: 260, style: { width: 260 }, draggable: false, selectable: false, zIndex: 20 }];
  }, [built, failNode, run, canRetry]);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>(allNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  useEffect(() => { setNodes(allNodes); }, [allNodes, setNodes]);
  useEffect(() => {
    setEdges(built.edges.map((e) => ({ ...e, markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: (e.data as EdgeData).walked ? "var(--color-ok)" : "var(--edge)" } })));
  }, [built, setEdges]);
  // Fit once the first board is drawn, and when another script opens.
  const fitted = useRef<string | null>(null);
  const lastCount = useRef(-1);
  useEffect(() => {
    const wasEmpty = lastCount.current === 0; lastCount.current = built.count;
    if (fitted.current === p.storeKey && wasEmpty && built.count > 0) { requestAnimationFrame(() => opening()); return; }
    if (fitted.current === p.storeKey || !built.nodes.length) return;
    fitted.current = p.storeKey;
    requestAnimationFrame(() => opening());
  }, [built, p.storeKey, rf]);

  /** The first view: everything when it fits at 75% or more; else the start at the left, at 75% (Main.dc.html). */
  const opening = () => {
    const box = wrap.current?.getBoundingClientRect();
    const start = rf.getInternalNode("start");
    if (!box || !start) { void rf.fitView({ padding: 0.12, maxZoom: 1 }); return; }
    const ns = rf.getNodes().filter((n) => !n.parentId);
    const maxX = Math.max(...ns.map((n) => n.position.x + (n.width ?? 0))), minY = Math.min(...ns.map((n) => n.position.y)), maxY = Math.max(...ns.map((n) => n.position.y + (n.height ?? 0)));
    const fit = Math.min((box.width - 80) / Math.max(1, maxX), (box.height - 160) / Math.max(1, maxY - minY));
    if (fit >= 0.75) { void rf.fitView({ padding: 0.12, maxZoom: 1 }); return; }
    const z = 0.75;
    const sy = start.internals.positionAbsolute.y + 18;
    void rf.setViewport({ x: 40 - start.internals.positionAbsolute.x * z, y: box.height / 2 - sy * z, zoom: z });
  };

  // ---- changes, each a few lines of the text
  const write = useCallback((next: string, select?: number) => {
    if (readOnly) { setSaid(p.lock ?? "先去脚本修好写法"); return; }
    if (next === p.text) return;
    p.onText(next);
    if (select !== undefined) setSelected(select || null);
  }, [readOnly, p]);
  const stmtOf = (line: number | null) => line ? shown.byLine.get(line) ?? null : null;
  /** ⌘Z / ⇧⌘Z: the script editor's history; what it leaves counts as the board's change (saved by itself). */
  const undo = (back: boolean) => { const after = history(p.editorRoot, back); if (after !== null) p.onBoardText(after); };
  const del = (line: number) => {
    const why = removeProblem(shown, line);
    if (why) { setSaid(why); return; }
    write(remove(p.text, line)); setSelected(null); setDrawer(false);
    wrap.current?.focus({ preventScroll: true });
    setSaid("已删除 · ⌘Z 撤销");
  };
  const copy = (line: number) => { const r = duplicate(p.text, line); if (r.line) { write(r.text, r.line); setSaid("已复制"); } };
  const removeBranch = (b: NonNullable<EdgeData["branch"]>) => {
    const s = stmtOf(b.line); if (!s) return;
    if (b.which === "no" && s.else) { write(remove(p.text, s.else.line)); return; }
    if (b.which === "yes" && s.children.length) { write(splice(p.text, s.children[0].line, s.children.at(-1)!.end, [])); return; }
    if (b.which === "case" && b.caseLine) del(b.caseLine);
  };
  const fold = (line: number) => { const a = anchors.get(line); if (!a) return;
    setFoldAnchors((was) => { const n = new Set(was); if (n.has(a)) n.delete(a); else n.add(a); writeFolds(p.storeKey, [...n]); return n; }); };

  const inLoop = (place: Place): boolean => {
    let s = place.kind === "after" ? stmtOf(place.line)?.parent ?? null : place.kind === "first" ? stmtOf(place.parent) : null;
    while (s) { if (s.kind === "repeat") return true; s = s.parent; }
    return false;
  };
  const makeCtx = (place: Place): MakeCtx => ({ full: `0,0,${reference[0]},${reference[1]}`, page: p.names.pages[0] ?? null, template: p.names.templates[0] ?? null,
    snippet: p.names.snippets[0] ?? null, inLoop: inLoop(place) });
  const put = (place: Place, lines: string[]) => {
    const r = insert(p.text, place, lines);
    if (!r.line) { setSaid("这里放不了"); return; }
    write(r.text, r.line); setDrawer(true); setMenu(null);
    setTimeout(() => centerOn(r.line), 120);
  };
  const choose = (item: Item, place: Place) => {
    const made = item.make(makeCtx(place));
    if (made === "field") { setMenu((m) => m ? { ...m, field: true } : { place, x: 60, y: 60, compact: false, from: null, field: true }); return; }
    put(place, made);
  };
  // A setting just made in 新建配置项 reaches the draft a moment later: its branches are written once it is there.
  const [pending, setPending] = useState<{ id: string; place: Place } | null>(null);
  useEffect(() => { if (pending && p.fields.some((x) => String(x.id) === pending.id)) { const { id, place } = pending; setPending(null); bySetting(id, place); } }, [p.fields, pending]); // eslint-disable-line react-hooks/exhaustive-deps
  const bySetting = (id: string, place: Place) => {
    const f = p.fields.find((x) => String(x.id) === id);
    if (!f) { setPending({ id, place }); setMenu(null); setSaid("等配置项存好…"); return; }
    const vals = f ? valuesOf(f).map((v) => /[\s@#"]/.test(v.word) ? `"${v.word}"` : v.word) : [];
    put(place, [`按设置 ${id}`, ...(vals.length ? vals : ["开", "关"]).map((v) => `  ${v}`), ...(f?.widget === "SWITCH" ? [] : ["  其他"])]);
  };
  /** Where 添加 puts a line when nothing says: after the chosen card, else at the end. */
  const defaultPlace = (): Place => {
    const s = stmtOf(selected);
    if (s) return s.kind === "else" ? { kind: "first", parent: s.parent!.line, branch: "else" } : s.kind === "case" ? { kind: "first", parent: s.line, branch: "children" } : { kind: "after", line: s.line };
    const last = shown.roots.at(-1);
    return last ? { kind: "after", line: last.line } : { kind: "top" };
  };
  const openMenu = (place: Place, e: { clientX: number; clientY: number } | null, compact = false, from: Kind | null = null) => {
    const r = wrap.current?.getBoundingClientRect();
    const x = e && r ? Math.min(Math.max(8, e.clientX - r.left + 12), r.width - 276) : 16;
    const y = e && r ? Math.min(Math.max(8, e.clientY - r.top - 20), r.height - 300) : 56;
    setMenu({ place, x, y, compact, from });
  };

  const failLine = p.run?.failure?.line ?? null;
  const failStmt = failLine ? stmtAt(shown, failLine) : null;
  // ---- the board's own api for its cards
  const api: BoardApi = useMemo(() => ({
    readOnly, selected,
    plus: (place, e, from) => openMenu(place, e, false, from ? stmtOf(from)?.kind ?? null : null),
    fold,
    tool: (what, line) => { if (what === "copy") copy(line); else if (what === "delete") del(line); else { setSelected(line); setDrawer(true); } },
    removeBranch,
    thumb: (t) => <Thumb t={t} sample={sample} reference={reference} game={p.game} />,
    middles, hoverEdge, setHoverEdge,
  }), [readOnly, selected, sample, reference, hoverEdge, p.text, shown]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- the drawer goes into the right column
  const sel = stmtOf(selected);
  const drawerOpen = drawer && !!sel && sel.kind !== "else";
  useEffect(() => { p.onDrawer(drawerOpen); }, [drawerOpen]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => p.onDrawer(false), []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (selected && !shown.byLine.has(selected)) { setSelected(null); setDrawer(false); } }, [shown, selected]);

  // ---- 去这一句 (a trial's row, a problem): the card of that line in the middle, chosen
  useEffect(() => {
    if (!p.goTo) return;
    const s = stmtAt(shown, p.goTo.line);
    p.onJumped();
    if (!s) return;
    const line = s.kind === "else" ? s.parent!.line : s.line;
    setSelected(line);
    centerOn(line);
  }, [p.goTo]); // eslint-disable-line react-hooks/exhaustive-deps
  const centerOn = (line: number) => requestAnimationFrame(() => {
    const n = rf.getInternalNode(`L${line}`);
    if (!n) return;
    const pos = n.internals.positionAbsolute;
    rf.setCenter(pos.x + (n.measured.width ?? n.width ?? 0) / 2, pos.y + (n.measured.height ?? n.height ?? 0) / 2, { zoom: Math.max(zoom, 0.8), duration: 300 });
  });

  // A trial that stopped: its card (and the stop card under it) in view. A setting chosen in 配置项: the first card reading it.
  const failKey = p.run && !p.run.busy && p.run.failure ? `${p.run.failure.line}/${p.run.secs}` : null;
  useEffect(() => { if (failKey && failStmt && !hideRun) centerOn(failStmt.kind === "else" ? failStmt.parent!.line : failStmt.line); }, [failKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const first = hot ? [...hot].sort((a, b) => a - b)[0] : undefined; const s = first ? stmtAt(shown, first) : null; if (s) centerOn(s.line); }, [hotField]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- dragging a card onto a line moves it there; an item from 添加 dropped on a line goes in there
  const nearest = (x: number, y: number, skip: string | null): EdgeData | null => {
    let best: { d: number; e: Edge } | null = null;
    for (const e of edges) {
      if (skip && (e.source === skip || e.target === skip || e.source.startsWith(`${skip}:`) || e.target.startsWith(`${skip}:`))) continue;
      const m = middles.get(e.id); if (!m) continue;
      const d = Math.hypot(m.x - x, m.y - y);
      if (d < 56 && (!best || d < best.d)) best = { d, e };
    }
    return best ? best.e.data as EdgeData : null;
  };
  const onNodeDragStop = (_: unknown, node: Node) => {
    const line = (node.data as StmtData).line;
    const internal = rf.getInternalNode(node.id);
    if (line && internal && !readOnly) {
      const pos = internal.internals.positionAbsolute;
      const hit = nearest(pos.x + (node.width ?? 0) / 2, pos.y + (node.height ?? 0) / 2, node.id);
      const s = stmtOf(line);
      if (hit && s && s.kind !== "case") {
        const r = move(p.text, line, hit.place);
        if (r.line) { write(r.text, r.line); setSaid("已移到线上"); return; }
        setSaid("放不进它自己里面");
      }
    }
    setNodes(allNodes);
  };
  const onDrop = (e: DragEvent) => {
    const id = e.dataTransfer.getData("application/x-hgb-item");
    const item = ITEMS.find((x) => x.id === id); if (!item) return;
    e.preventDefault();
    const at = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    const hit = nearest(at.x, at.y, null);
    if (!hit) { setSaid("拖到线上才插得进去"); return; }
    choose(item, hit.place);
  };

  // ---- dragging a line out of an exit into empty space: the short menu there
  const from = useRef<OnConnectStartParams | null>(null);
  const onConnectEnd = (e: globalThis.MouseEvent | TouchEvent, state: FinalConnectionState) => {
    const start = from.current; from.current = null;
    if (!start?.nodeId || state.isValid || readOnly) return;
    const pt = "changedTouches" in e ? e.changedTouches[0] : e;
    if (!(e.target as HTMLElement)?.classList?.contains("react-flow__pane")) return;
    const nd = nodes.find((n) => n.id === start.nodeId);
    const line = (nd?.data as StmtData | undefined)?.line;
    const h = start.handleId ?? "out";
    const place: Place = start.nodeId === "start" ? { kind: "top" } : !line ? { kind: "top" }
      : h === "yes" ? { kind: "first", parent: line, branch: "children" } : h === "no" ? { kind: "first", parent: line, branch: "else" }
      : h.startsWith("c") ? { kind: "first", parent: Number(h.slice(1)), branch: "children" } : { kind: "after", line };
    openMenu(place, { clientX: pt.clientX, clientY: pt.clientY }, true, stmtOf(line ?? null)?.kind ?? null);
  };

  // ---- keys (States.dc.html)
  const tidy = () => { setNodes(allNodes); requestAnimationFrame(() => rf.fitView({ padding: 0.12, maxZoom: 1, minZoom: 0.3, duration: 250 })); };
  const moveSel = (dx: number, dy: number) => {
    const cards = rf.getNodes().filter((n) => (n.data as StmtData).line && n.type !== "stop");
    const pos = (n: Node) => { const i = rf.getInternalNode(n.id); const a = i?.internals.positionAbsolute ?? n.position; return { x: a.x + (n.width ?? 0) / 2, y: a.y + (n.height ?? 0) / 2 }; };
    const cur = cards.find((n) => (n.data as StmtData).line === selected && n.type !== "fold");
    if (!cur) { const first = cards.find((n) => n.type === "stmt" || n.type === "loop"); if (first) { setSelected((first.data as StmtData).line); centerOn((first.data as StmtData).line); } return; }
    const a = pos(cur);
    let best: { s: number; n: Node } | null = null;
    for (const n of cards) {
      if (n === cur || n.type === "fold" || n.type === "slot") continue;
      const b = pos(n); const along = (b.x - a.x) * dx + (b.y - a.y) * dy; if (along <= 4) continue;
      const across = Math.abs((b.x - a.x) * dy) + Math.abs((b.y - a.y) * dx);
      const score = along + across * 2.5;
      if (!best || score < best.s) best = { s: score, n };
    }
    if (best) { const l = (best.n.data as StmtData).line; setSelected(l); centerOn(l); }
  };
  const onKey = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement;
    const typing = !!t.closest("input, textarea, select, [contenteditable=true]");
    const inDrawer = !!p.drawerHost && p.drawerHost.contains(t);
    const mod = e.metaKey || e.ctrlKey;
    if (e.key === "Escape") { if (e.defaultPrevented) return; if (menu) setMenu(null); else if (drawer) setDrawer(false); else if (panel) setPanel(false); else setSelected(null); e.preventDefault(); return; }
    if (typing || inDrawer) return;
    // Only on the board itself (its container, a card, the pane): not on its buttons, menus or the 配置项 panel.
    const onBoard = t === wrap.current || (!!t.closest(".react-flow") && !t.closest("button, a, [role=option], [role=dialog]"));
    if (!onBoard) return;
    const k = e.key.toLowerCase();
    if (mod && k === "s") { e.preventDefault(); p.onSave(); return; }
    if (mod && k === "z") { e.preventDefault(); if (e.shiftKey) undo(false); else undo(true); return; }
    if (mod && k === "y") { e.preventDefault(); undo(false); return; }
    if (mod && k === "d") { e.preventDefault(); if (selected) copy(selected); return; }
    if (mod) return;
    if ((e.key === "Delete" || e.key === "Backspace") && selected) { e.preventDefault(); const edge = edges.find((x) => x.selected); if (edge && (edge.data as EdgeData).branch) removeBranch((edge.data as EdgeData).branch!); else del(selected); return; }
    if ((e.key === "Delete" || e.key === "Backspace")) { const edge = edges.find((x) => x.selected); if (edge && (edge.data as EdgeData).branch) { e.preventDefault(); removeBranch((edge.data as EdgeData).branch!); } return; }
    if (k === "a" && !e.shiftKey) { e.preventDefault(); if (!readOnly) openMenu(defaultPlace(), null); return; }
    if (e.key === "Enter" && selected) { e.preventDefault(); setDrawer(true); return; }
    if (e.key === "ArrowRight") { e.preventDefault(); moveSel(1, 0); return; }
    if (e.key === "ArrowLeft") { e.preventDefault(); moveSel(-1, 0); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); moveSel(0, 1); return; }
    if (e.key === "ArrowUp") { e.preventDefault(); moveSel(0, -1); return; }
    if (e.shiftKey && (e.key === "!" || e.code === "Digit1")) { e.preventDefault(); rf.fitView({ padding: 0.12, maxZoom: 1, minZoom: 0.3, duration: 250 }); return; }
    if (e.shiftKey && k === "l") { e.preventDefault(); tidy(); return; }
    if ((e.key === "[" || e.key === "]") && selected) {
      const s = stmtOf(selected); if (!s || !(LOOPS.has(s.kind) || s.children.length || s.else)) return;
      e.preventDefault(); const isFolded = folds.has(selected);
      if ((e.key === "[") !== isFolded) fold(selected);
    }
  };

  const onNodeClick = (e: MouseEvent, n: Node) => {
    const d = n.data as StmtData;
    if (!d.line || n.type === "fold" || n.type === "stop") return;
    e.stopPropagation();
    setSelected(d.line); setDrawer(true); setMenu(null);
    wrap.current?.focus({ preventScroll: true });
  };
  const onNodeDoubleClick = (_: MouseEvent, n: Node) => {
    const d = n.data as StmtData;
    if (d.kind === "use") { const name = /^用\s+(\S+)/.exec(d.text)?.[1]; if (name) p.onSnippet(name); }
  };

  const banner: ReactNode = doc.error ? <div className={c.banner} data-tone="bad" role="alert">
      <span className={c.bannerText}><b>第 {doc.error.line} 行写法不对</b> · 画板暂时画不出来，下面是上次能画出的样子，只读</span>
      <button type="button" className={c.btn} onClick={() => p.onScript(doc.error!.line)}>去脚本修</button></div>
    : p.lock ? <div className={c.banner} data-tone="warn" role="status"><span className={c.bannerText}>{p.lock}</span></div>
    : p.run?.busy ? <div className={c.banner} role="status"><span className={c.bannerText}>试跑中 · 走过 {p.run.steps} 句 · {p.run.secs} 秒</span></div>
    : p.run?.failure && !hideRun ? <div className={c.banner} data-tone="bad" role="status">
      <span className={c.bannerText}><b>试跑停在 {failStmt ? `${failStmt.word} · ` : ""}第 {p.run.failure.line} 行</b> · {p.run.secs} 秒</span>
      {p.onRetry && <button type="button" className={c.btn} onClick={p.onRetry}>再试一次</button>}
      <button type="button" className={`${c.btn} ${c.ghost}`} onClick={() => setHideRun(true)}>隐藏轨迹</button></div>
    : p.run ? <div className={c.banner} role="status">
      <span className={c.bannerText}>{hideRun ? "试跑轨迹已隐藏" : `回放 · 走过 ${p.run.steps} 句 · 共 ${p.run.secs} 秒${p.run.passed ? " · 通过" : ""}`}</span>
      <button type="button" className={`${c.btn} ${c.ghost}`} onClick={() => setHideRun(!hideRun)}>{hideRun ? "显示轨迹" : "隐藏轨迹"}</button></div>
    : null;

  const empty = !doc.error && doc.roots.length === 0;
  const lines = edges.length;
  return (
    <Board.Provider value={api}>
      <div ref={wrap} className={c.wrap} tabIndex={0} onKeyDown={onKey} aria-label="画板" onDragOver={(e) => { if (e.dataTransfer.types.includes("application/x-hgb-item")) e.preventDefault(); }} onDrop={onDrop}>
        <ReactFlow className={c.flow} nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes}
          onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
          onNodeClick={onNodeClick} onNodeDoubleClick={onNodeDoubleClick} onPaneClick={() => { setSelected(null); setMenu(null); setDrawer(false); }}
          onEdgeMouseEnter={(_, e) => setHoverEdge(e.id)} onEdgeMouseLeave={() => setHoverEdge(null)}
          onConnectStart={(_, params) => { from.current = params; }} onConnectEnd={onConnectEnd} isValidConnection={() => false}
          onNodeDragStop={onNodeDragStop} nodesDraggable={!readOnly} nodesConnectable={!readOnly} deleteKeyCode={null} selectionKeyCode={null} multiSelectionKeyCode={null}
          panOnScroll zoomActivationKeyCode="Meta" minZoom={0.2} maxZoom={1.6} proOptions={{ hideAttribution: true }} disableKeyboardA11y>
          <Background variant={BackgroundVariant.Dots} gap={20} size={1.4} color="var(--dot)" />
          <MiniMap pannable zoomable position="bottom-right" style={{ width: 168, height: 96 }} nodeBorderRadius={4} ariaLabel="小地图"
            nodeColor={(n) => n.type === "loop" ? "transparent" : (n.data as StmtData).run?.tone === "bad" ? "var(--color-danger)" : "var(--color-line)"}
            nodeStrokeColor={(n) => n.type === "loop" ? "var(--edge)" : "transparent"} maskColor="color-mix(in srgb, var(--color-bg) 55%, transparent)" />
        </ReactFlow>

        <div className={`${c.float} ${c.addBar}`}>
          <button type="button" className={`${c.btn} ${c.pri}`} disabled={readOnly} aria-expanded={!!menu && !menu.compact} title="添加（A）"
            onClick={() => menu && !menu.compact ? setMenu(null) : openMenu(defaultPlace(), null)}>＋ 添加</button>
          {p.taskId && <button type="button" className={c.btn} data-on={panel} onClick={() => { setPanel(!panel); if (panel) setHotField(null); }}>配置项 · {p.fields.length}</button>}
          <span className={c.muted}>{built.count} 个节点 · {lines} 条线</span>
        </div>

        {banner}

        {panel && p.taskId && <div className={`${c.float} ${c.cfgPanel}`}>
          <ConfigPanel taskId={p.taskId} selected={hotField} onSelect={setHotField} onClose={() => { setPanel(false); setHotField(null); }} embedded />
        </div>}

        {empty && <div className={`${c.float} ${c.empty}`}>
          <b>这一步还是空的</b>
          <span className={c.muted}>从「开始」的 + 接第一句，或用常见开头：</span>
          <div className={c.starters}>{STARTERS.map((st) => <button key={st.label} type="button" className={`${c.btn} ${c.starter}`} disabled={readOnly}
            onClick={() => put({ kind: "top" }, st.make(makeCtx({ kind: "top" })))}>{st.label}</button>)}</div>
        </div>}

        <div className={`${c.float} ${c.controls}`}>
          <button type="button" className={`${c.btn} ${c.ghost}`} aria-label="缩小" onClick={() => rf.zoomOut({ duration: 150 })}>−</button>
          <span className={c.zoom}>{Math.round(zoom * 100)}%</span>
          <button type="button" className={`${c.btn} ${c.ghost}`} aria-label="放大" onClick={() => rf.zoomIn({ duration: 150 })}>+</button>
          <span className={c.sep} />
          <button type="button" className={`${c.btn} ${c.ghost}`} title="适应全部 ⇧1" onClick={() => rf.fitView({ padding: 0.12, maxZoom: 1, minZoom: 0.3, duration: 250 })}>适应</button>
          <button type="button" className={`${c.btn} ${c.ghost}`} title="整理 ⇧L" onClick={tidy}>整理</button>
          <span className={c.sep} />
          <button type="button" className={`${c.btn} ${c.ghost}`} aria-label="撤销" title="撤销 ⌘Z" disabled={readOnly} onClick={() => undo(true)}>↶</button>
          <button type="button" className={`${c.btn} ${c.ghost}`} aria-label="重做" title="重做 ⇧⌘Z" disabled={readOnly} onClick={() => undo(false)}>↷</button>
        </div>

        {menu && <AddMenu menu={menu} fields={p.fields} taskId={p.taskId} stepId={p.stepId} makeCtx={makeCtx(menu.place)} onClose={() => setMenu(null)}
          onChoose={(item) => choose(item, menu.place)} onField={(id) => bySetting(id, menu.place)} onAll={() => setMenu({ ...menu, compact: false })} />}
        {said && <div className={c.say} role="status">{said}</div>}
      </div>
      {drawerOpen && sel && p.drawerHost && createPortal(
        <Drawer key={sel.line} doc={shown} stmt={sel} ctx={ctx} fields={p.fields} taskId={p.taskId} stepId={p.stepId} names={p.names} game={p.game} reference={reference}
          readOnly={readOnly} issue={issues.get(sel.line) ?? null} saved={p.saved}
          setCode={(line, code) => write(setCode(p.text, line, code))}
          edit={(op) => { if (op.kind === "remove") del(op.line); else put(op.place, op.lines); }}
          onAdd={(place) => openMenu(place, null)} onFold={fold} folded={folds.has(sel.line)}
          onClose={() => { setDrawer(false); wrap.current?.focus({ preventScroll: true }); }} onScript={(l) => p.onScript(l)} onSnippet={p.onSnippet}
          onDelete={() => del(sel.line)} />, p.drawerHost)}
    </Board.Provider>
  );
}

/** A card's small picture: the newest phone picture with the region framed, and the template it looks for. */
function Thumb({ t, sample, reference, game }: { t: { template?: string; region?: number[] }; sample: Sample | null; reference: [number, number]; game: string }) {
  const r = t.region && sample ? toPicture(t.region, [sample.width, sample.height], reference) : null;
  const w = sample ? Math.round(40 * sample.width / sample.height) : 0;
  return <>
    {t.region && sample ? <span className={c.shot} style={{ width: w }}>
      <img src={dev.sampleImage(sample.id)} alt="" loading="lazy" />
      {r && <i style={{ left: `${r[0] / sample.width * 100}%`, top: `${r[1] / sample.height * 100}%`, width: `${Math.max(4, r[2] / sample.width * 100)}%`, height: `${Math.max(8, r[3] / sample.height * 100)}%` }} />}
    </span> : !t.template && <span className={c.shot} data-empty>没有画面</span>}
    {t.template && <span className={c.tpl}><img src={dev.templateImage(game, t.template)} alt={t.template} loading="lazy" onError={(e) => { e.currentTarget.style.display = "none"; }} /></span>}
  </>;
}

/** 添加: the whole menu (search, groups) or, where a line was dragged out, a short one with what usually comes next. */
function AddMenu({ menu, fields, taskId, stepId, makeCtx, onClose, onChoose, onField, onAll }: { menu: Menu; fields: Obj[]; taskId?: string; stepId?: string; makeCtx: MakeCtx;
  onClose: () => void; onChoose: (item: Item) => void; onField: (id: string) => void; onAll: () => void }) {
  const [q, setQ] = useState("");
  const [focus, setFocus] = useState(0);
  const [creating, setCreating] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); }, [menu.compact, menu.field]);
  const usable = ITEMS.filter((i) => !i.when || i.when(makeCtx)).filter((i) => i.id !== "setting" || !!taskId);
  const list = menu.compact && !q ? suggest(menu.from).map((id) => usable.find((i) => i.id === id)).filter((x): x is Item => !!x)
    : usable.filter((i) => !q.trim() || `${i.label}${i.hint}${i.kind}`.includes(q.trim()));
  useEffect(() => setFocus(0), [q]);
  const choices = fields.filter((x) => x.widget === "SWITCH" || ((x.widget === "SINGLE_CHOICE" || x.widget === "MULTI_CHOICE") && Array.isArray(x.options) && x.options.length));
  const keys = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setFocus((f) => Math.min(list.length - 1, f + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setFocus((f) => Math.max(0, f - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); const it = list[focus]; if (it) onChoose(it); }
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onClose(); }
  };
  if (menu.field) return <div className={c.menu} style={{ left: menu.x, top: menu.y }} role="dialog" aria-label="按哪个配置项分" onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } }}>
    <div className={c.menuGroup}>按哪个配置项分</div>
    <div className={c.menuList}>
      {choices.map((f) => <button key={String(f.id)} type="button" className={c.item} onClick={() => onField(String(f.id))}>
        <span className={c.ic} data-group="if">⚙</span>{str(f.label) ?? String(f.id)}<small>{f.widget === "SWITCH" ? "开 / 关" : `${(f.options as unknown[]).length} 种`}</small></button>)}
      {!choices.length && <div className={c.menuFoot}>还没有开关或单选的配置项</div>}
      <button type="button" className={c.item} onClick={() => setCreating(true)}><span className={c.ic} data-group="act">＋</span>新建配置项</button>
    </div>
    {creating && taskId && <NewConfigDialog taskId={taskId} stepId={stepId} kinds={["switch", "choice"]} preset={{ widget: "SINGLE_CHOICE" }} place="按配置项分"
      onDone={(id) => { setCreating(false); if (id) onField(id); }} />}
  </div>;
  let last = "";
  return <div className={c.menu} style={{ left: menu.x, top: menu.y }} role="dialog" aria-label="添加节点" onKeyDown={keys}>
    <input ref={input} className={c.search} placeholder="搜节点，如「点」「等」" value={q} onChange={(e) => setQ(e.target.value)} aria-label="搜节点" />
    <div className={c.menuList} role="listbox" aria-label="节点">
      {list.map((it, i) => {
        const head = !menu.compact && !q && it.menu !== last ? MENUS.find(([id]) => id === it.menu)?.[1] : null;
        last = it.menu;
        return <div key={it.id}>{head && <div className={c.menuGroup}>{head}</div>}
          <button type="button" role="option" aria-selected={i === focus} className={c.item} draggable={!menu.compact}
            onDragStart={(e) => { e.dataTransfer.setData("application/x-hgb-item", it.id); e.dataTransfer.effectAllowed = "copy"; }}
            onMouseEnter={() => setFocus(i)} onClick={() => onChoose(it)}>
            <span className={c.ic} data-group={it.group}>{it.icon}</span>{it.label}<small>{it.hint}</small></button></div>;
      })}
      {!list.length && <div className={c.menuFoot}>没有「{q}」</div>}
      {menu.compact && !q && <button type="button" className={`${c.item} ${c.all}`} onClick={onAll}>全部节点 ›</button>}
    </div>
    <div className={c.menuFoot}>{menu.compact ? "接在拖出来的那个出口后面" : "↑↓ 选择，回车加入，Esc 关闭；可拖到线上"}</div>
  </div>;
}

export { runText };
export type { Run };
/** Every statement line of [text] (for the trial's marks). */
export const statementLines = (text: string) => allStmts(read(text)).map((s) => s.line);

/** One step back (or forward) in the script editor's history: the same ⌘Z the script view has. */
function history(root: HTMLElement | null, back: boolean): string | null {
  const el = root?.querySelector<HTMLElement>(".cm-editor");
  const view = el ? EditorView.findFromDOM(el) : null;
  if (!view || !(back ? cmUndo(view) : cmRedo(view))) return null;
  return view.state.doc.toString();
}
