/** The board's cards and lines (Nodes.dc.html, Edges.dc.html): React Flow custom nodes and one custom edge. */
import { createContext, useContext, useEffect, useState, type MouseEvent, type ReactNode } from "react";
import { BaseEdge, EdgeLabelRenderer, getBezierPath, Handle, Position, type EdgeProps, type NodeProps } from "@xyflow/react";
import type { EdgeData, FoldData, GroupData, Look, Run, SlotData, StmtData } from "./graph";
import type { Place } from "./script";
import c from "./Canvas.module.css";

export interface BoardApi {
  readOnly: boolean;
  selected: number | null;
  /** Opens 添加 at a place, beside the point clicked. */
  plus: (place: Place, e: MouseEvent, from?: number) => void;
  fold: (line: number) => void;
  tool: (what: "copy" | "edit" | "delete", line: number) => void;
  removeBranch: (b: NonNullable<EdgeData["branch"]>) => void;
  thumb: (t: NonNullable<Look["thumb"]>) => ReactNode;
  /** Each line's middle, for dropping a card onto it. */
  middles: Map<string, { x: number; y: number }>;
  hoverEdge: string | null; setHoverEdge: (id: string | null) => void;
}
export const Board = createContext<BoardApi | null>(null);
const useBoard = () => useContext(Board)!;

/** A trial's result said short: 「✓ 0.8 秒」「✕ 卡住」「进行中」. */
export function runText(r: Run | null): string | null {
  if (!r) return null;
  if (r.tone === "running") return "进行中";
  const t = r.ms >= 100 ? `${(r.ms / 1000).toFixed(1)} 秒` : "";
  return r.tone === "bad" ? "✕ 卡住" : `✓ ${t}${r.times > 1 ? ` · ${r.times} 次` : ""}`.trim();
}
const exitTop = (i: number, n: number) => n <= 1 ? "50%" : n === 2 ? (i === 0 ? "34%" : "74%") : `${((i + 1) / (n + 1)) * 100}%`;

function Body({ look, kind }: { look: Look; kind: string }) {
  const board = useBoard();
  return <div className={c.bd}>
    {look.body.slice(0, 2).map((b, i) => <div key={i} className={c.text} title={b}>{b}</div>)}
    {look.chips.length > 0 && <div className={c.chips}>{look.chips.map((ch) => <span key={ch.field} className={c.chip} title={`配置项 ${ch.field}`}>⚙ {ch.label} · {ch.value}</span>)}</div>}
    {look.sub && kind !== "use" && <div className={c.sub}>{look.sub}</div>}
    {look.sub && kind === "use" && <div className={c.sub}>{look.sub}</div>}
    {look.thumb && <div className={c.thumbs}>{board.thumb(look.thumb)}</div>}
  </div>;
}

export function StmtNode({ data, selected }: NodeProps) {
  const d = data as StmtData;
  const board = useBoard();
  const [hover, setHover] = useState(false);
  const lk = d.look;
  const rt = runText(d.run);
  const exitPlace = (id: string): Place => id === "yes" ? { kind: "first", parent: d.line, branch: "children" }
    : id === "no" ? { kind: "first", parent: d.line, branch: "else" }
    : id.startsWith("c") ? { kind: "first", parent: Number(id.slice(1)), branch: "children" } : { kind: "after", line: d.line };
  return (
    <div className={c.node} data-group={lk.group} data-kind={d.kind} data-sel={selected || board.selected === d.line} data-dim={d.dim} data-hot={d.hot}
      data-run={d.run?.tone} data-issue={d.issue ? (d.issue.warning ? "warning" : "error") : undefined}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} title={d.kind === "raw" ? `原样：${d.text}\n这一句画板认不出，去脚本改` : undefined}>
      <Handle type="target" position={Position.Left} id="in" className={c.in} isConnectable={false} />
      {d.foldable && <button type="button" className={c.tog} aria-label={d.folded ? "展开子节点" : "折叠子节点"} onClick={(e) => { e.stopPropagation(); board.fold(d.line); }}>{d.folded ? "+" : "−"}</button>}
      {hover && !board.readOnly && <div className={c.tools} onClick={(e) => e.stopPropagation()}>
        <button type="button" title="复制 ⌘D" aria-label="复制" onClick={() => board.tool("copy", d.line)}>⧉</button>
        <button type="button" title="设置 回车" aria-label="设置" onClick={() => board.tool("edit", d.line)}>⚙</button>
        <button type="button" title="删除 Delete" aria-label="删除" data-danger onClick={() => board.tool("delete", d.line)}>✕</button>
      </div>}
      <div className={c.hd}><span className={c.ic} aria-hidden="true">{lk.icon}</span><span className={c.title}>{lk.title}</span>
        <span className={c.right} data-run={d.run?.tone} title={rt ?? lk.right ?? undefined}>{rt ?? lk.right}</span></div>
      <Body look={lk} kind={d.kind} />
      {d.exits.length > 2 && d.exits.map((e, i) => <span key={e.id} className={c.caseName} style={{ top: exitTop(i, d.exits.length) }}>{e.label}</span>)}
      {d.exits.map((e, i) => <span key={e.id}>
        <Handle type="source" position={Position.Right} id={e.id} className={c.out} data-tone={e.tone} style={{ top: exitTop(i, d.exits.length) }} isConnectable={!board.readOnly} />
        {hover && !board.readOnly && <button type="button" className={c.exitPlus} style={{ top: exitTop(i, d.exits.length) }} aria-label={`在${e.label || "后面"}接一句`}
          onClick={(ev) => { ev.stopPropagation(); board.plus(exitPlace(e.id), ev, d.line); }}>+</button>}
      </span>)}
      {d.issue && <span className={c.badge} data-warning={d.issue.warning || undefined} title={d.issue.reason}>{d.issue.warning ? "提醒" : "1 错"} · {d.issue.reason}</span>}
    </div>
  );
}

export function LoopNode({ data, selected }: NodeProps) {
  const d = data as GroupData;
  const board = useBoard();
  const lk = d.look;
  const count = lk.chips.length ? <span className={c.chip}>⚙ {lk.chips[0].label} · {lk.chips[0].value}</span> : null;
  const head = d.kind === "repeat" ? <>反复 {count ?? lk.body[0]}{count ? " 次" : ""}</>
    : d.kind === "until" ? <>直到 {lk.body[0]} {count ? <>最多 {count} 次</> : lk.sub}</> : <>逐个 {lk.body[0]}</>;
  const rt = runText(d.run);
  if (d.folded) return (
    <div className={c.loopCard} data-group="loop" data-sel={selected || board.selected === d.line} data-hot={d.hot} data-dim={d.dim} data-run={d.run?.tone}>
      <Handle type="target" position={Position.Left} id="in" className={c.in} isConnectable={false} />
      <button type="button" className={c.tog} aria-label="展开" onClick={(e) => { e.stopPropagation(); board.fold(d.line); }}>+</button>
      <b style={{ fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{head}</b>
      <span className={c.muted}>⊞ {d.count} 个节点{rt ? ` · ${rt}` : ""}</span>
      <Handle type="source" position={Position.Right} id="out" className={c.out} isConnectable={!board.readOnly} />
    </div>
  );
  return (
    <div className={c.loop} data-sel={selected || board.selected === d.line} data-hot={d.hot} data-run={d.run?.tone}>
      <Handle type="target" position={Position.Left} id="in" className={`${c.in} ${c.hidden}`} isConnectable={false} />
      <div className={c.loopHd}>
        <button type="button" className={c.tog} aria-label="折叠反复" onClick={(e) => { e.stopPropagation(); board.fold(d.line); }}>−</button>
        <span>{head}</span>{rt && <span className={c.loopRun}>{rt}</span>}
      </div>
      {d.issue && <span className={c.badge} data-warning={d.issue.warning || undefined} style={{ top: 12, left: 14 }} title={d.issue.reason}>{d.issue.warning ? "提醒" : "1 错"} · {d.issue.reason}</span>}
      <Handle type="source" position={Position.Right} id="out" className={`${c.out} ${c.hidden}`} isConnectable={false} />
    </div>
  );
}

export function StartNode({ data }: NodeProps) {
  const board = useBoard();
  const [hover, setHover] = useState(false);
  return <div className={c.start} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>开始
    <Handle type="source" position={Position.Right} id="out" className={c.out} isConnectable={!board.readOnly} />
    {(hover || (data as { empty?: boolean }).empty) && !board.readOnly && <button type="button" className={c.exitPlus} style={{ top: "50%" }} aria-label="接第一句"
      onClick={(e) => { e.stopPropagation(); board.plus({ kind: "top" }, e); }}>+</button>}
  </div>;
}

export function PillNode({ data, selected }: NodeProps) {
  const d = data as StmtData;
  const board = useBoard();
  return <div className={c.pill} data-sel={selected || board.selected === d.line}>
    <Handle type="target" position={Position.Left} id="in" className={c.in} isConnectable={false} />{d.look.body[0]}
    <Handle type="source" position={Position.Right} id="out" className={`${c.out} ${c.hidden}`} isConnectable={false} />
  </div>;
}

export function FoldNode({ data }: NodeProps) {
  const d = data as FoldData;
  const board = useBoard();
  return <div className={c.fold} role="button" tabIndex={-1} onClick={(e) => { e.stopPropagation(); board.fold(d.line); }} title="点开">
    <Handle type="target" position={Position.Left} id="in" className={c.in} isConnectable={false} />⊞ {d.label} · {d.count} 个节点
    <Handle type="source" position={Position.Right} id="out" className={`${c.out} ${c.hidden}`} isConnectable={false} />
  </div>;
}

export function SlotNode({ data }: NodeProps) {
  const d = data as SlotData;
  const board = useBoard();
  return <div className={c.slot} role="button" tabIndex={-1} onClick={(e) => { e.stopPropagation(); if (!board.readOnly) board.plus(d.place, e); }}>
    <Handle type="target" position={Position.Left} id="in" className={c.in} isConnectable={false} />{d.label}
    <Handle type="source" position={Position.Right} id="out" className={`${c.out} ${c.hidden}`} isConnectable={false} />
  </div>;
}

export interface StopData extends Record<string, unknown> { src: string | null; why: string; line: number; onScript: () => void; onRetry: (() => void) | null }
export function StopNode({ data }: NodeProps) {
  const d = data as StopData;
  return <div className={`${c.stop} nodrag nopan`} onClick={(e) => e.stopPropagation()}>
    <b>停在这里 · 第 {d.line} 行</b>
    {d.src && <div className={c.stopShot}><img src={d.src} alt="停下时的画面" onError={(e) => { (e.currentTarget.parentElement as HTMLElement).style.display = "none"; }} /></div>}
    {d.why && <div className={c.stopWhy}>{d.why}</div>}
    <div className={c.row}>
      <button type="button" className={`${c.btn} ${c.pri}`} onClick={d.onScript}>去改这一句</button>
      {d.onRetry && <button type="button" className={c.btn} onClick={d.onRetry}>再试一次</button>}
    </div>
  </div>;
}

export function FlowEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, selected, markerEnd }: EdgeProps) {
  const d = data as EdgeData;
  const board = useBoard();
  const [path, labelX, labelY] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, curvature: 0.3 });
  useEffect(() => { board.middles.set(id, { x: labelX, y: labelY }); return () => { board.middles.delete(id); }; }, [id, labelX, labelY, board.middles]);
  const hover = board.hoverEdge === id;
  const style = { stroke: d.walked ? "var(--color-ok)" : selected ? "var(--color-primary)" : "var(--edge)", strokeWidth: d.walked || selected ? 2.6 : 2,
    strokeDasharray: d.tone === "break" ? "6 5" : undefined, opacity: d.walked === false && board.hoverEdge === "__run" ? .5 : 1 };
  const labelAt = { x: sourceX + 14, y: sourceY - 10 };
  return <>
    <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} interactionWidth={18} />
    <EdgeLabelRenderer>
      {d.label && <div className={`${c.edgeLabel} nodrag nopan`} data-tone={d.tone === "no" ? "no" : undefined}
        style={{ transform: `translate(0, -50%) translate(${labelAt.x}px, ${labelAt.y}px)` }}>{d.label}</div>}
      {!board.readOnly && (hover || selected) && <div style={{ position: "absolute", transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`, pointerEvents: "all", display: "flex", gap: 4 }}
        className="nodrag nopan" onMouseEnter={() => board.setHoverEdge(id)} onMouseLeave={() => board.setHoverEdge(null)}>
        {!selected && <button type="button" className={c.edgeBtn} style={{ position: "static" }} aria-label="在这里插入" title="在这里插入" onClick={(e) => { e.stopPropagation(); board.plus(d.place, e); }}>+</button>}
        {selected && d.branch && <button type="button" className={c.edgeBtn} style={{ position: "static" }} data-danger aria-label="删掉这条支路" title="删掉这条支路（Delete）"
          onClick={(e) => { e.stopPropagation(); board.removeBranch(d.branch!); }}>✕</button>}
        {selected && !d.branch && <button type="button" className={c.edgeBtn} style={{ position: "static" }} aria-label="在这里插入" title="在这里插入" onClick={(e) => { e.stopPropagation(); board.plus(d.place, e); }}>+</button>}
      </div>}
    </EdgeLabelRenderer>
  </>;
}

export const nodeTypes = { stmt: StmtNode, loop: LoopNode, start: StartNode, pill: PillNode, fold: FoldNode, slot: SlotNode, stop: StopNode };
export const edgeTypes = { flow: FlowEdge };
