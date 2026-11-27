/**
 * The board drawn from the script's statements: one card per statement, a dashed box around a loop's lines, a branch's
 * cases as its exits; laid out left to right by dagre each time (no position is kept: whoever opens it sees the same).
 */
import dagre, { graphlib } from "@dagrejs/dagre";
import type { Edge, Node } from "@xyflow/react";
import { BLOCKS, CASES, GROUP, LOOPS, limitOf, imageOf, quotedOf, argOf, secondsOf, splitLine, tokens, type Doc, type Group, type Kind, type Place, type Stmt } from "./script";

/** A setting read on a line: shown 「⚙ 名称 · 测试值」. */
export interface Chip { field: string; label: string; value: string }
export interface Look {
  icon: string; title: string; group: Group;
  /** Up to two lines. */
  body: string[];
  sub: string | null;
  /** The one key value top right (a threshold, a count): replaced by the trial's result after one. */
  right: string | null;
  chips: Chip[];
  thumb: { template?: string; region?: number[] } | null;
}
export interface Exit { id: string; label: string; tone: "yes" | "no" | "case" }
export interface Run { tone: "ok" | "bad" | "running"; ms: number; times: number }
export interface StmtData extends Record<string, unknown> {
  line: number; kind: Kind; look: Look; exits: Exit[]; text: string;
  foldable: boolean; folded: boolean;
  run: Run | null; dim: boolean; hot: boolean;
  issue: { reason: string; warning: boolean } | null;
}
export interface GroupData extends Record<string, unknown> { line: number; kind: Kind; look: Look; folded: boolean; run: Run | null; hot: boolean; dim: boolean; count: number; issue: { reason: string; warning: boolean } | null }
export interface FoldData extends Record<string, unknown> { line: number; label: string; count: number; branch: string }
export interface SlotData extends Record<string, unknown> { label: string; place: Place }
export interface EdgeData extends Record<string, unknown> {
  label: string; tone: "yes" | "no" | "case" | "plain" | "break";
  /** Where a statement goes when one is put on this line. */
  place: Place;
  /** A branch this line starts: taking the line away takes the branch away. */
  branch: { line: number; which: "yes" | "no" | "case"; caseLine?: number } | null;
  walked: boolean;
}

export interface LookCtx {
  label: (field: string) => string | undefined;
  test: (field: string) => string | undefined;
  /** Setting reads by line. */
  reads: Map<number, string[]>;
  regions: Record<string, number[]>;
  snippetLines: (name: string) => number | undefined;
}

const ICON: Partial<Record<Kind, string>> = {
  go: "→", wait: "⏱", pause: "⌛", longWait: "⌛", launch: "▶", tap: "☝", drag: "↔", scan: "▦", quiz: "?", reset: "↺",
  ifSee: "◇", ifNot: "◇", ifHas: "◇", ifRed: "◇", ifColor: "◇", cases: "⑂", setting: "⑂", repeat: "⟳", until: "⟳", each: "⟳",
  exit: "⤴", use: "⧉", result: "⚑", stop: "■", report: "⇪", raw: "…",
};
const TITLE: Partial<Record<Kind, string>> = {
  go: "去", wait: "等", pause: "等一会", longWait: "长等待", launch: "启动游戏", drag: "拖", scan: "扫描网格", quiz: "答题", reset: "清零",
  ifSee: "如果看到", ifNot: "如果没看到", ifHas: "如果有", ifRed: "如果红点", ifColor: "如果颜色", cases: "分情况", setting: "按配置项分",
  repeat: "反复", until: "直到", each: "逐个", exit: "跳出", use: "片段", result: "结果", stop: "停下", report: "上报", raw: "原样",
};
/** The two exits of a yes/no, said the way the line reads. */
export const YES_NO: Partial<Record<Kind, [string, string]>> = {
  ifSee: ["看到", "没看到"], ifNot: ["没看到", "看到"], ifHas: ["有", "没有"], ifRed: ["有红点", "没有"], ifColor: ["够多", "不够"],
};

/** A condition said short: `"进攻"@区域 且 没看到 图 x@…` → 「进攻 且 没看到 x」. */
export function condText(code: string): string {
  return tokens(code).map((t) => t.quoted ? t.text : t.text).filter((w) => w && w !== "图").join(" ").replace(/\s+/g, " ").trim();
}
const nums = (s: string | null | undefined) => {
  if (!s) return null;
  const v = s.replace(/^[左中右]:/, "").split(/[,，]/).map((x) => Number(x.trim()));
  return v.length === 4 && v.every(Number.isFinite) ? v : null;
};

/** What a statement's card says. */
export function look(s: Stmt, raw: string, ctx: LookCtx): Look {
  const { code } = splitLine(raw);
  const rest = code.slice(s.word.length).trim();
  const g = GROUP[s.kind];
  const chips: Chip[] = (ctx.reads.get(s.line) ?? []).map((f) => ({ field: f, label: ctx.label(f) ?? f, value: ctx.test(f) ?? "—" }));
  const sec = limitOf(code, "秒"), times = limitOf(code, "次"), hops = limitOf(code, "步");
  const plainNum = (l: { value: string } | null, unit: string) => l && !l.value.startsWith("{") ? `${l.value} ${unit}` : null;
  const withoutLimits = (c: string) => { let x = c; for (const u of ["秒", "次", "步"]) { const l = limitOf(x, u); if (l) x = (x.slice(0, l.from) + x.slice(l.to)).trim(); } return x; };
  const region = (() => { const t = tokens(code).find((x) => x.at !== null); if (!t) return null; return nums(t.at) ?? ctx.regions[t.at!.replace(/^[左中右]:/, "")] ?? null; })();
  const im = imageOf(code);
  const base: Look = { icon: ICON[s.kind] ?? "·", title: TITLE[s.kind] ?? s.word, group: g, body: [], sub: null, right: null, chips, thumb: null };
  switch (s.kind) {
    case "go": return { ...base, body: [argOf(code)?.value ?? "—"], sub: plainNum(hops, "步") ? `最多 ${plainNum(hops, "步")}` : null };
    case "wait": return { ...base, body: [condText(withoutLimits(rest)) || "—"], sub: plainNum(sec, "秒") ? `最多 ${plainNum(sec, "秒")}` : null, thumb: im ? { template: im.name, region: region ?? undefined } : region ? { region } : null };
    case "pause": case "longWait": { const v = secondsOf(code)?.value ?? rest; return { ...base, body: [v.startsWith("{") ? "" : `${v} 秒`].filter(Boolean), sub: s.kind === "longWait" ? "放宽看门狗" : null }; }
    case "launch": return { ...base, body: ["启动并等到前台"] };
    case "tap": {
      const target = withoutLimits(rest).replace(/\s+计\s+\S+/, "");
      return { ...base, title: s.word, body: [condText(target) || "—"], right: im?.threshold ? `像到 ${im.threshold}` : plainNum(times, "次") ? `最多 ${plainNum(times, "次")}` : null,
        sub: plainNum(sec, "秒") ? `最多等 ${plainNum(sec, "秒")}` : null, thumb: im ? { template: im.name, region: region ?? undefined } : region ? { region } : null };
    }
    case "drag": return { ...base, body: [condText(rest)], thumb: region ? { region } : null };
    case "scan": return { ...base, body: [rest.split(":")[0].trim()], right: `${s.children.length} 种` };
    case "quiz": case "reset": case "report": return { ...base, body: [condText(rest) || "—"] };
    case "ifSee": case "ifNot": case "ifHas": case "ifRed": case "ifColor":
      return { ...base, body: [condText(withoutLimits(rest)) || (s.kind === "ifRed" ? "红点" : "—")], right: im?.threshold ? `像到 ${im.threshold}` : null,
        sub: plainNum(sec, "秒") ? `最多等 ${plainNum(sec, "秒")}` : null, thumb: im ? { template: im.name, region: region ?? undefined } : region ? { region } : null };
    case "cases": return { ...base, right: `${s.children.length} 种`, body: s.children.slice(0, 2).map((c) => c.word), sub: plainNum(sec, "秒") ? `最多等 ${plainNum(sec, "秒")}` : null };
    case "setting": {
      const f = argOf(code)?.value ?? "";
      return { ...base, right: `${s.children.length} 种`, body: [], chips: [{ field: f, label: ctx.label(f) ?? f, value: ctx.test(f) ?? "—" }] };
    }
    case "repeat": return { ...base, body: [times && !times.value.startsWith("{") ? `最多 ${times.value} 次` : "最多"], right: null };
    case "until": return { ...base, body: [condText(withoutLimits(rest))], sub: times && !times.value.startsWith("{") ? `最多 ${times.value} 次` : null };
    case "each": return { ...base, body: [rest] };
    case "exit": return { ...base, body: ["跳出反复"] };
    case "use": { const n = argOf(code)?.value ?? ""; const c = ctx.snippetLines(n); return { ...base, body: [n], right: c ? `${c} 句` : null, sub: "双击进入片段" }; }
    case "result": case "stop": return { ...base, body: [quotedOf(code)?.value ?? rest] };
    default: return { ...base, body: [code] };
  }
}

// ---- sizes (kept in step with Canvas.module.css)

export const W = 176, W_IF = 188, HEAD = 30, LINE = 20, SUB = 18, THUMB = 46, PAD = 12;
export function sizeOf(lk: Look, kind: Kind): [number, number] {
  const w = GROUP[kind] === "if" ? W_IF : W;
  if (kind === "exit") return [120, 34];
  const lines = Math.min(2, lk.body.length) + (lk.chips.length && kind !== "setting" ? 0 : 0);
  const chipLine = lk.chips.length ? LINE + 2 : 0;
  const caseLines = kind === "cases" || kind === "setting" || kind === "scan" ? 0 : 0;
  return [w, HEAD + Math.max(1, lines) * LINE + chipLine + caseLines + (lk.sub ? SUB : 0) + (lk.thumb ? THUMB : 0) + PAD];
}

// ---- the graph

export interface BuildIn {
  doc: Doc; ctx: LookCtx;
  /** Statement lines folded (a branch's children, or a loop into one card). */
  folded: Set<number>;
  run: Map<number, Run>;
  /** Consecutive statement lines the trial went through ("a>b"). */
  walked: Set<string>;
  issues: Map<number, { reason: string; warning: boolean }>;
  /** Lines to mark (a setting chosen in 配置项): the others go pale. */
  hot: Set<number> | null;
}
export interface BuildOut { nodes: Node[]; edges: Edge[]; count: number; lines: number }

interface Out { source: string; handle: string; label: string; tone: EdgeData["tone"]; place: Place; branch: EdgeData["branch"] }
interface Scope { id: string | null; g: graphlib.Graph; nodes: Node[] }
const GROUP_HEAD = 26, GROUP_PAD = 18;

export function build({ doc, ctx, folded, run, walked, issues, hot }: BuildIn): BuildOut {
  const nodes: Node[] = []; const edges: Edge[] = [];
  // One compound graph for the whole board: a loop's box is a cluster around its cards, so cards after a loop are
  // ranked by the lines they follow, not pushed past the whole box.
  const G = graph();
  const clusters = new Set<string>();
  /** Where each node sits: its scope (the loop box it is in), for the layout. */
  const scopeOf = new Map<string, string | null>();
  let count = 0;
  const lineOf = (n: string) => Number(n.replace(/^L/, "").split(":")[0]) || 0;

  const connect = (sc: Scope, outs: Out[], target: string) => {
    for (const o of outs) {
      const key = `${o.source}|${o.handle}|${target}`;
      const walkedHere = walked.has(`${lineOf(o.source)}>${lineOf(target)}`);
      edges.push({ id: key, source: o.source, sourceHandle: o.handle, target, targetHandle: "in", type: "flow",
        data: { label: o.label, tone: o.tone, place: o.place, branch: o.branch, walked: walkedHere } satisfies EdgeData });
      if (!clusters.has(o.source) && !clusters.has(target) && o.source !== target) G.setEdge(o.source, target, { weight: o.tone === "yes" || o.tone === "plain" ? 2 : 1 });
    }
    void sc;
  };
  const add = (sc: Scope, node: Node, w: number, h: number) => {
    node.width = w; node.height = h;
    node.style = { ...(node.style ?? {}), width: w, height: h };
    if (sc.id) { node.parentId = sc.id; node.extent = undefined; }
    scopeOf.set(node.id, sc.id);
    sc.nodes.push(node); nodes.push(node);
    G.setNode(node.id, { width: w, height: h });
    if (sc.id) G.setParent(node.id, sc.id);
  };
  const runOf = (s: Stmt) => run.get(s.line) ?? null;
  const dimOf = (s: Stmt) => !!hot && !hot.has(s.line);
  const hotOf = (s: Stmt) => !!hot && hot.has(s.line);
  const countIn = (list: Stmt[]): number => list.reduce((n, s) => n + (s.kind === "case" ? 0 : 1) + countIn(s.children) + (s.else ? countIn(s.else.children) : 0), 0);

  /** The statements of one block, joined to [entries]; what leaves its end, and the 跳出 that leave the loop around it. */
  const seq = (sc: Scope, list: Stmt[], entries: Out[]): { outs: Out[]; breaks: Out[] } => {
    let outs = entries; const breaks: Out[] = [];
    for (const s of list) {
      const r = stmt(sc, s, outs);
      outs = r.outs; breaks.push(...r.breaks);
    }
    return { outs, breaks };
  };
  const plainOut = (id: string, s: Stmt): Out => ({ source: id, handle: "out", label: "", tone: "plain", place: { kind: "after", line: s.line }, branch: null });

  const stmt = (sc: Scope, s: Stmt, entries: Out[]): { outs: Out[]; breaks: Out[] } => {
    count++;
    const lk = look(s, doc.lines[s.line - 1], ctx);
    const issue = issues.get(s.line) ?? null;
    if (LOOPS.has(s.kind)) return loop(sc, s, lk, entries, issue);
    const isFold = folded.has(s.line) && (BLOCKS.has(s.kind) || CASES.has(s.kind));
    const exits: Exit[] = [];
    const yn = YES_NO[s.kind];
    if (yn) exits.push({ id: "yes", label: yn[0], tone: "yes" }, { id: "no", label: yn[1], tone: "no" });
    if (CASES.has(s.kind)) s.children.forEach((c, i) => exits.push({ id: `c${c.line}`, label: caseLabel(s, c, ctx), tone: i === s.children.length - 1 && /^(其他|无|没有值)$/.test(c.word) ? "no" : "case" }));
    const terminal = s.kind === "stop" || s.kind === "exit";
    if (!exits.length && !terminal) exits.push({ id: "out", label: "", tone: "yes" });
    const id = s.id;
    const [w, h0] = sizeOf(lk, s.kind);
    const h = Math.max(h0, exits.length > 2 ? 24 + exits.length * 22 : h0);
    const data: StmtData = { line: s.line, kind: s.kind, look: lk, exits, text: s.text, foldable: BLOCKS.has(s.kind) || CASES.has(s.kind), folded: isFold,
      run: runOf(s), dim: dimOf(s), hot: hotOf(s), issue };
    add(sc, { id, type: s.kind === "exit" ? "pill" : "stmt", position: { x: 0, y: 0 }, data }, w, h);
    connect(sc, entries, id);
    if (s.kind === "exit") return { outs: [], breaks: [{ source: id, handle: "out", label: "跳出", tone: "break", place: { kind: "after", line: s.line }, branch: null }] };
    if (s.kind === "stop") return { outs: [], breaks: [] };
    if (!yn && !CASES.has(s.kind)) return { outs: [plainOut(id, s)], breaks: [] };

    // A branch: each way out, its lines (or, folded, one ⊞ card for them).
    const outs: Out[] = []; const breaks: Out[] = [];
    const ways: { handle: string; label: string; tone: Out["tone"]; list: Stmt[]; place: Place; branch: EdgeData["branch"]; empty: string | null }[] = [];
    if (yn) {
      ways.push({ handle: "yes", label: yn[0], tone: "yes", list: s.children, place: { kind: "first", parent: s.line, branch: "children" }, branch: { line: s.line, which: "yes" }, empty: `＋ ${yn[0]}时做什么` });
      ways.push({ handle: "no", label: yn[1], tone: "no", list: s.else?.children ?? [], place: { kind: "first", parent: s.line, branch: "else" }, branch: s.else ? { line: s.line, which: "no" } : null, empty: null });
    } else s.children.forEach((c, i) => ways.push({ handle: `c${c.line}`, label: exits[i].label, tone: exits[i].tone === "no" ? "no" : "case", list: c.children,
      place: { kind: "first", parent: c.line, branch: "children" }, branch: { line: s.line, which: "case", caseLine: c.line }, empty: null }));
    // dagre stacks what it meets later higher up: the last way first, so 是 / 看到 ends on top.
    for (const way of [...ways].reverse()) {
      const entry: Out = { source: id, handle: way.handle, label: way.label, tone: way.tone, place: way.place, branch: way.branch };
      if (isFold && way.list.length) {
        const fid = `${id}:fold:${way.handle}`;
        const n = countIn(way.list);
        add(sc, { id: fid, type: "fold", position: { x: 0, y: 0 }, draggable: false, data: { line: s.line, label: way.label, count: n, branch: way.handle } satisfies FoldData }, 150, 34);
        connect(sc, [entry], fid);
        outs.push({ source: fid, handle: "out", label: "", tone: "plain", place: way.place, branch: null });
        continue;
      }
      if (!way.list.length) {
        if (way.empty && !s.else && s.children.length === 0) {
          const sid = `${id}:slot:${way.handle}`;
          add(sc, { id: sid, type: "slot", position: { x: 0, y: 0 }, draggable: false, data: { label: way.empty, place: way.place } satisfies SlotData }, 150, 34);
          connect(sc, [entry], sid);
          outs.push({ source: sid, handle: "out", label: "", tone: "plain", place: way.place, branch: null });
        } else outs.push(entry);
        continue;
      }
      const r = seq(sc, way.list, [entry]);
      outs.push(...r.outs); breaks.push(...r.breaks);
    }
    return { outs, breaks };
  };

  const loop = (sc: Scope, s: Stmt, lk: Look, entries: Out[], issue: StmtData["issue"]): { outs: Out[]; breaks: Out[] } => {
    const id = s.id;
    const n = countIn(s.children);
    if (folded.has(s.line)) {
      const data: GroupData = { line: s.line, kind: s.kind, look: lk, folded: true, run: runOf(s), hot: hotOf(s), dim: dimOf(s), count: n, issue };
      add(sc, { id, type: "loop", position: { x: 0, y: 0 }, data }, 200, 64);
      connect(sc, entries, id);
      return { outs: [plainOut(id, s)], breaks: [] };
    }
    const data: GroupData = { line: s.line, kind: s.kind, look: lk, folded: false, run: runOf(s), hot: hotOf(s), dim: dimOf(s), count: n, issue };
    const group: Node = { id, type: "loop", position: { x: 0, y: 0 }, data, zIndex: -1 };
    // The box first (React Flow wants a parent before its children); dagre sizes it around its cards.
    add(sc, group, 200, 64);
    const inner: Scope = { id, g: G, nodes: [] };
    const first = s.children[0];
    // Into the loop: the line before goes to the first line inside.
    let r: { outs: Out[]; breaks: Out[] } = { outs: entries, breaks: [] };
    if (first) {
      clusters.add(id); G.setNode(id, {});
      r = seq(inner, s.children, []);
      // The way in: the line before → the first card inside (drawn), the box itself in the outer layout.
      const firstId = innerFirst(inner, first);
      for (const o of entries) {
        edges.push({ id: `${o.source}|${o.handle}|${firstId}`, source: o.source, sourceHandle: o.handle, target: firstId, targetHandle: "in", type: "flow",
          data: { label: o.label, tone: o.tone, place: o.place, branch: o.branch, walked: walked.has(`${lineOf(o.source)}>${lineOf(firstId)}`) } satisfies EdgeData });
        if (!clusters.has(o.source) && !clusters.has(firstId)) G.setEdge(o.source, firstId, { weight: 2 });
      }
    }
    // Out of the loop: whatever ends its lines, and its 跳出 (反复 only: the engine's 跳出 ends the nearest 反复).
    const after: Place = { kind: "after", line: s.line };
    const outs: Out[] = r.outs.map((o) => ({ ...o, place: after, branch: null }));
    const breaks = s.kind === "repeat" ? [] : r.breaks;
    if (s.kind === "repeat") outs.push(...r.breaks.map((b) => ({ ...b, place: after })));
    return { outs: outs.length ? outs : [plainOut(id, s)], breaks };
  };
  /** The id of the first card drawn for [s] in [sc]. */
  const innerFirst = (_sc: Scope, s: Stmt): string => LOOPS.has(s.kind) && !folded.has(s.line) && s.children[0] ? innerFirst(_sc, s.children[0]) : s.id;

  const top: Scope = { id: null, g: graph(), nodes: [] };
  const startNode: Node = { id: "start", type: "start", position: { x: 0, y: 0 }, data: { empty: doc.roots.length === 0 } };
  add(top, startNode, 84, 36);
  seq(top, doc.roots, [{ source: "start", handle: "out", label: "", tone: "plain", place: { kind: "top" }, branch: null }]);
  lay(G, nodes, clusters);
  // Parents before children, outermost first.
  const depth = (n: Node): number => n.parentId ? 1 + depth(nodes.find((x) => x.id === n.parentId)!) : 0;
  nodes.sort((a, b) => depth(a) - depth(b));
  return { nodes, edges: edges.filter((e) => nodes.some((n) => n.id === e.source) && nodes.some((n) => n.id === e.target)), count, lines: doc.lines.length };
}

function graph() {
  const g = new graphlib.Graph({ multigraph: false, compound: true });
  g.setGraph({ rankdir: "LR", nodesep: 34, ranksep: 54, marginx: 0, marginy: 0 });
  g.setDefaultEdgeLabel(() => ({}));
  return g;
}
/** Lays out every card and box; React Flow positions (a box's cards relative to it), boxes grown for their heads. */
function lay(g: graphlib.Graph, nodes: Node[], clusters: Set<string>) {
  dagre.layout(g);
  const abs = new Map<string, { x: number; y: number; w: number; h: number }>();
  for (const n of nodes) {
    const p = g.node(n.id) as { x: number; y: number; width: number; height: number } | undefined;
    if (!p) continue;
    if (clusters.has(n.id)) {
      const w = p.width + GROUP_PAD * 2, h = p.height + GROUP_HEAD + GROUP_PAD / 2;
      abs.set(n.id, { x: p.x - p.width / 2 - GROUP_PAD, y: p.y - p.height / 2 - GROUP_HEAD, w, h });
      n.width = w; n.height = h; n.style = { ...(n.style ?? {}), width: w, height: h };
    } else abs.set(n.id, { x: p.x - (n.width ?? 0) / 2, y: p.y - (n.height ?? 0) / 2, w: n.width ?? 0, h: n.height ?? 0 });
  }
  for (const n of nodes) {
    const a = abs.get(n.id); if (!a) continue;
    const par = n.parentId ? abs.get(n.parentId) : undefined;
    n.position = par ? { x: a.x - par.x, y: a.y - par.y } : { x: a.x, y: a.y };
  }
}

/** A case's exit label: a 按设置 value with what the player sees, a 分情况 case by its name. */
function caseLabel(s: Stmt, c: Stmt, ctx: LookCtx): string {
  const v = c.word.replace(/^["“]|["”]$/g, "");
  if (s.kind === "setting") return v;
  void ctx;
  return v;
}
