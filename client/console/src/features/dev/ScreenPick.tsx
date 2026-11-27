import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type WheelEvent } from "react";
import { dev, sampleNow, type Sample } from "./api";
import { failure, useDev } from "./context";
import { atText, sizesNote, toPicture, toReference, useReference, type Size } from "./coords";
import s from "./Picker.module.css";
import w from "./Wb.module.css";

/** The newest picture of the phone as a sample (the numbers a script writes), or null when there is none yet. */
export async function newestSample(game: string): Promise<Sample | null> {
  const all = await dev.samples(game);
  return [...all].sort((a, b) => b.createdAt - a.createdAt)[0] ?? null;
}

type Drag = { kind: "new" | "move" | "nw" | "ne" | "sw" | "se" | "point"; from: [number, number]; was: number[] };

/**
 * 在画面上选: a region (x,y,w,h) or a point (x,y) on the newest phone picture, drawn, moved, resized by its corners,
 * zoomed (wheel, − +) and nudged with the arrows (Shift: 10). [value] and what [onDone] gets are in the game's reference
 * numbers; the picture's own size and the reference are said in a corner. Esc and × leave without a change.
 */
export function ScreenPick({ point, value, onDone, onCancel, title, autoFocus = false }: { point: boolean; value: number[] | null; title?: string;
  /** Takes the keyboard when it opens (asked for, not opened by the cursor passing). */ autoFocus?: boolean;
  onDone: (value: number[]) => void; onCancel: () => void }) {
  const { game, device } = useDev();
  const reference = useReference();
  const [sample, setSample] = useState<Sample | null | undefined>(undefined);
  const [size, setSize] = useState<Size | null>(null);
  const [shape, setShape] = useState<number[] | null>(null);
  const [zoom, setZoom] = useState(1);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => { let live = true; newestSample(game).then((x) => { if (live) setSample(x); }, () => { if (live) setSample(null); }); return () => { live = false; }; }, [game]);
  useEffect(() => { if (autoFocus) root.current?.focus(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // The picture as it loaded (its own pixels), so the numbers never mix two sizes.
  const picture: Size | null = size;
  // The value in the picture's pixels, once the picture's size is known.
  useEffect(() => { if (picture && value && !shape) setShape(toPicture(value, picture, reference).map(Math.round)); }, [picture?.[0], picture?.[1]]); // eslint-disable-line react-hooks/exhaustive-deps
  // A new [value] (the line's numbers changed, or another spot) starts over from it, not from what was drawn before.
  const valueKey = value ? value.join(",") : "";
  const shownValue = useRef(valueKey);
  useEffect(() => {
    if (shownValue.current === valueKey) return;
    shownValue.current = valueKey;
    setShape(picture && value ? toPicture(value, picture, reference).map(Math.round) : null);
  }, [valueKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const out = shape && picture ? toReference(shape, picture, reference) : null;

  const look = async () => {
    if (!device) { setSaid("顶栏选一台手机"); return; }
    setBusy(true); setSaid(null);
    try { setSample(await sampleNow(game, device)); } catch (error) { setSaid(error instanceof Error && !(error as { status?: number }).status ? error.message : failure(error)); }
    setBusy(false);
  };
  const at = (e: PointerEvent): [number, number] => {
    const r = box.current!.getBoundingClientRect();
    const k = picture ? r.width / picture[0] : 1;
    return [Math.round((e.clientX - r.left) / k), Math.round((e.clientY - r.top) / k)];
  };
  const clamp = (xs: number[]): number[] => {
    if (!picture) return xs;
    if (point) return [Math.max(0, Math.min(picture[0], xs[0])), Math.max(0, Math.min(picture[1], xs[1]))];
    const [x, y, ww, hh] = xs;
    const nw = Math.max(1, Math.min(ww, picture[0])), nh = Math.max(1, Math.min(hh, picture[1]));
    return [Math.max(0, Math.min(picture[0] - nw, x)), Math.max(0, Math.min(picture[1] - nh, y)), nw, nh];
  };
  const down = (e: PointerEvent<HTMLElement>, kind?: Drag["kind"]) => {
    e.stopPropagation(); e.preventDefault();
    box.current?.setPointerCapture(e.pointerId);
    const p = at(e);
    const k: Drag["kind"] = kind ?? (point ? "point" : "new");
    drag.current = { kind: k, from: p, was: shape ?? [] };
    if (k === "point") setShape(clamp(p));
    if (k === "new") setShape([p[0], p[1], 1, 1]);
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current; if (!d) return;
    const [x, y] = at(e); const dx = x - d.from[0], dy = y - d.from[1];
    const [ox, oy, ow, oh] = d.was;
    if (d.kind === "point") setShape(clamp([x, y]));
    else if (d.kind === "new") setShape(clamp([Math.min(x, d.from[0]), Math.min(y, d.from[1]), Math.abs(dx), Math.abs(dy)]));
    else if (d.kind === "move") setShape(clamp([ox + dx, oy + dy, ow, oh]));
    else {
      const left = d.kind === "nw" || d.kind === "sw", top = d.kind === "nw" || d.kind === "ne";
      // The dragged corner stops at the picture's edge (clamp alone would shift the whole box instead).
      const x1 = left ? Math.max(0, Math.min(ox + dx, ox + ow - 1)) : ox, x2 = left ? ox + ow : Math.max(ox + 1, ox + ow + dx);
      const y1 = top ? Math.max(0, Math.min(oy + dy, oy + oh - 1)) : oy, y2 = top ? oy + oh : Math.max(oy + 1, oy + oh + dy);
      setShape(clamp([x1, y1, x2 - x1, y2 - y1]));
    }
  };
  const up = () => { drag.current = null; };
  const keys = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onCancel(); return; }
    if (e.key === "Enter" && out && (e.target as HTMLElement).tagName !== "BUTTON") { e.preventDefault(); onDone(out); return; }
    const by = e.shiftKey ? 10 : 1;
    const step: Record<string, [number, number]> = { ArrowLeft: [-by, 0], ArrowRight: [by, 0], ArrowUp: [0, -by], ArrowDown: [0, by] };
    if (e.key in step && shape) { e.preventDefault(); const [dx, dy] = step[e.key]; setShape(clamp(point ? [shape[0] + dx, shape[1] + dy] : [shape[0] + dx, shape[1] + dy, shape[2], shape[3]])); }
    if (e.key === "+" || e.key === "=") setZoom((z) => Math.min(6, z * 1.5));
    if (e.key === "-") setZoom((z) => Math.max(1, z / 1.5));
  };
  const wheel = (e: WheelEvent<HTMLDivElement>) => { if (!e.ctrlKey && !e.metaKey && !e.altKey) return; e.preventDefault(); setZoom((z) => Math.max(1, Math.min(6, z * (e.deltaY < 0 ? 1.25 : 0.8)))); };
  const pct = (xs: number[]) => picture ? { left: `${xs[0] / picture[0] * 100}%`, top: `${xs[1] / picture[1] * 100}%`,
    ...(xs.length === 4 ? { width: `${xs[2] / picture[0] * 100}%`, height: `${xs[3] / picture[1] * 100}%` } : {}) } : {};

  return (
    <div ref={root} className={s.pick} tabIndex={-1} onKeyDown={keys} role="dialog" aria-label={title ?? (point ? "在画面上点选" : "在画面上框选")}>
      <div className={s.head}>
        <b>{title ?? (point ? "在画面上点一下" : "在画面上框一个")}</b>
        <span className={s.grow} />
        <button type="button" className={s.zoomBtn} aria-label="缩小" disabled={zoom <= 1} onClick={() => setZoom((z) => Math.max(1, z / 1.5))}>−</button>
        <span className={s.zoomText}>{Math.round(zoom * 100)}%</span>
        <button type="button" className={s.zoomBtn} aria-label="放大" disabled={zoom >= 6} onClick={() => setZoom((z) => Math.min(6, z * 1.5))}>＋</button>
        <button type="button" className={s.close} aria-label="关闭" onClick={onCancel}>×</button>
      </div>
      {sample === undefined ? <span className={w.muted}>读取画面…</span>
        : sample === null ? <div className={s.row}><span className={w.muted}>还没有手机画面</span>
            <button type="button" className={`${w.btn} ${w.sm}`} disabled={busy} onClick={() => void look()}>{busy ? "采一张…" : "看一张"}</button>{said && <span className={w.message}>{said}</span>}</div>
        : <div className={s.viewport} onWheel={wheel}>
            <div ref={box} className={s.stage} style={{ width: `${zoom * 100}%` }} onPointerDown={(e) => down(e)} onPointerMove={move} onPointerUp={up}>
              <img src={dev.sampleImage(sample.id)} alt={sample.name} draggable={false} onLoad={(e) => setSize([e.currentTarget.naturalWidth, e.currentTarget.naturalHeight])} />
              {shape && !point && <span className={s.rect} style={pct(shape)} onPointerDown={(e) => down(e, "move")}>
                {(["nw", "ne", "sw", "se"] as const).map((c) => <i key={c} className={s.handle} data-corner={c} onPointerDown={(e) => down(e, c)} />)}</span>}
              {shape && point && <span className={s.cross} style={pct(shape)} onPointerDown={(e) => down(e, "point")} />}
              {picture && <span className={s.note}>{sizesNote(picture, reference)}</span>}
            </div>
          </div>}
      <div className={s.row}>
        <code className={s.readout}>{out ? `@${atText(out)}` : point ? "点一下画面" : "在画面上拖一个框"}</code>
        <span className={s.grow} />
        <button type="button" className={`${w.btn} ${w.sm}`} onClick={onCancel}>取消</button>
        <button type="button" className={`${w.btn} ${w.sm} ${w.primary}`} disabled={!out} onClick={() => out && onDone(out)}>确定</button>
      </div>
      <span className={`${w.muted} ${s.hint}`}>⌥↓ 进入 · 方向键微调 1 像素，Shift 10 像素 · ⌘/Ctrl＋滚轮缩放</span>
    </div>
  );
}

/** 「在画面上选」 beside a form's region (or point) field: the same picker in a dialog; what is chosen fills the field. */
export function PickOnScreen({ point = false, value, onPick }: { point?: boolean; value: number[] | null; onPick: (value: number[]) => void }) {
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (open) dialog.current?.showModal(); else dialog.current?.close(); }, [open]);
  return <>
    <button type="button" className={`${w.btn} ${w.sm}`} onClick={() => setOpen(true)}>在画面上选</button>
    <dialog ref={dialog} className={s.dialog} onCancel={(e) => { e.preventDefault(); setOpen(false); }}>
      {open && <ScreenPick point={point} value={value && value.length === (point ? 2 : 4) ? value : null}
        onDone={(v) => { onPick(v); setOpen(false); }} onCancel={() => setOpen(false)} />}
    </dialog>
  </>;
}
