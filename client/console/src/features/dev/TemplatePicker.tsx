import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { Sample } from "./api";
import { pixelsOf } from "./colors";
import { toPicture, toReference, useReference } from "./coords";
import { ScreenPick } from "./ScreenPick";
import s from "./Picker.module.css";
import w from "./Wb.module.css";

/** A template the library has, by the name a script writes (variants grouped), with the pages that use it. */
export interface PickerTemplate { name: string; src: string; meta: string; pages: string[] }
/** What the script editor's 选图 needs from the workspace. */
export interface PickerHost {
  templates: PickerTemplate[];
  pages: string[];
  /** The newest picture of the phone (a sample, in the numbers a script writes); null when there is none. */
  sample: () => Promise<Sample | null>;
  sampleSrc: (id: string) => string;
  /** Cuts [rect] of [sample] as template [name] into the draft; its id, or throws with why. */
  cut: (sample: Sample, rect: number[], name: string) => Promise<string>;
}
/** The `图 name@region` the cursor is on. */
export interface PickTarget { line: number; name: string; region: number[] | null; threshold: string | null }

const DEFAULT_THRESHOLD = "0.85";
/** A template's search region: its box with some room around it, inside the picture (as 素材 and 画面 write it). */
export const padded = (rect: number[], width: number, height: number) => {
  const x = Math.max(0, rect[0] - 24), y = Math.max(0, rect[1] - 24);
  return [x, y, Math.min(width - x, rect[2] + 48), Math.min(height - y, rect[3] + 48)];
};

/**
 * 选图: the line's picture and where it looks, tried on the newest phone picture; a new region drawn there; any other
 * picture of the library chosen from a grid (search, by page, arrows and Enter), or a new one cut from that picture.
 */
export function TemplatePicker({ at, host, onChoose, onRegion, onClose }: { at: PickTarget; host: PickerHost;
  onChoose: (name: string, region?: number[]) => void; onRegion: (region: number[]) => void; onClose: () => void }) {
  const [sample, setSample] = useState<Sample | null | undefined>(undefined);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState("");
  const [focus, setFocus] = useState(0);
  const [mode, setMode] = useState<"look" | "region" | "cut">("look");
  const [rect, setRect] = useState<number[] | null>(null);
  const [name, setName] = useState("");
  const [said, setSaid] = useState<[string, boolean] | null>(null);
  const [busy, setBusy] = useState(false);
  const grid = useRef<HTMLDivElement>(null);
  const reference = useReference();
  // The line's region in the picture's pixels (the script writes reference numbers).
  const region = sample && at.region ? toPicture(at.region, [sample.width, sample.height], reference).map(Math.round) : null;
  const box = useRef<HTMLDivElement>(null);
  const start = useRef<[number, number] | null>(null);
  useEffect(() => { let live = true; host.sample().then((x) => { if (live) setSample(x); }, () => { if (live) setSample(null); }); return () => { live = false; }; }, [host]);
  useEffect(() => { setSaid(null); }, [at.name, at.region?.join(",")]);

  const mine = host.templates.find((t) => t.name === at.name);
  const shown = useMemo(() => host.templates.filter((t) => (!page || t.pages.includes(page)) && (!query.trim() || t.name.toLowerCase().includes(query.trim().toLowerCase()))), [host.templates, page, query]);
  const cells = shown.length + 1; // the last: 裁一张新的
  useEffect(() => { setFocus((f) => Math.min(f, cells - 1)); }, [cells]);
  const choose = (i: number) => { if (i === shown.length) { setMode("cut"); setRect(null); setSaid(null); } else onChoose(shown[i].name); };
  const keys = (e: KeyboardEvent<HTMLDivElement>) => {
    const move: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 4, ArrowUp: -4 };
    if (e.key in move) { e.preventDefault(); setFocus((f) => Math.max(0, Math.min(cells - 1, f + move[e.key]))); }
    else if (e.key === "Enter") { e.preventDefault(); choose(focus); }
  };
  useEffect(() => { (grid.current?.children[focus] as HTMLElement | undefined)?.scrollIntoView?.({ block: "nearest" }); }, [focus]);

  // Drawing a box on the picture: a new region, or the part to cut.
  const scale = () => sample ? (box.current?.clientWidth ?? sample.width) / sample.width : 1;
  const pointAt = (e: PointerEvent<HTMLDivElement>): [number, number] => {
    const r = box.current!.getBoundingClientRect();
    return [Math.round((e.clientX - r.left) / scale()), Math.round((e.clientY - r.top) / scale())];
  };
  const down = (e: PointerEvent<HTMLDivElement>) => { if (mode === "look") return; e.currentTarget.setPointerCapture(e.pointerId); start.current = pointAt(e); setRect(null); };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    if (!start.current) return;
    const [x, y] = pointAt(e); const [sx, sy] = start.current;
    setRect([Math.min(x, sx), Math.min(y, sy), Math.abs(x - sx), Math.abs(y - sy)]);
  };
  const up = () => { start.current = null; setRect((r) => r && (r[2] < 4 || r[3] < 4) ? null : r); };

  const tryIt = async () => {
    if (!sample || !mine) return;
    setBusy(true); setSaid(null);
    try {
      const got = await matchOn(host.sampleSrc(sample.id), mine.src, region);
      const need = Number(at.threshold ?? DEFAULT_THRESHOLD);
      setSaid([got >= need ? `认得到 · 相似度 ${got.toFixed(2)}` : `认不到 · 最高 ${got.toFixed(2)}，要 ${need}`, got >= need]);
    } catch { setSaid(["没算成：图读不出来", false]); }
    setBusy(false);
  };
  const cut = async () => {
    if (!sample || !rect || !name.trim()) return;
    setBusy(true); setSaid(null);
    try { const id = await host.cut(sample, rect, name.trim()); onChoose(id.split("@")[0], toReference(padded(rect, sample.width, sample.height), [sample.width, sample.height], reference)); }
    catch (error) { setSaid([error instanceof Error ? error.message : "没裁成", false]); }
    setBusy(false);
  };
  const pct = (r: number[]) => sample ? { left: `${r[0] / sample.width * 100}%`, top: `${r[1] / sample.height * 100}%`, width: `${r[2] / sample.width * 100}%`, height: `${r[3] / sample.height * 100}%` } : {};

  // 改区域: the shared picker on the same picture, starting from the line's region.
  if (mode === "region") return <ScreenPick autoFocus point={false} value={at.region} title={`第 ${at.line} 行 · 改区域`}
    onDone={(v) => { onRegion(v); setMode("look"); }} onCancel={() => setMode("look")} />;
  return (
    <div className={s.picker} role="dialog" aria-label="选图" onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onClose(); } }}>
      <div className={s.head}>
        <b>第 {at.line} 行的图</b><span className={w.muted}>· 阈值 {at.threshold ?? `${DEFAULT_THRESHOLD}（默认）`}</span>
        <span className={s.grow} />
        <button type="button" className={s.close} aria-label="关闭" onClick={onClose}>×</button>
      </div>
      <div className={s.pair}>
        <div className={s.mine}>
          {mine ? <img src={mine.src} alt={mine.name} /> : <span className={w.muted}>{at.name ? `没有「${at.name}」` : "还没选图"}</span>}
          <span className={s.caption}>{mine ? `${mine.name} · ${mine.meta}` : ""}</span>
        </div>
        <div className={s.screen}>
          {sample === undefined ? <span className={w.muted}>读取画面…</span> : sample === null ? <span className={w.muted}>还没有手机画面 · 去素材采一张</span> : <>
            <div ref={box} className={s.canvas} data-draw={mode !== "look" || undefined} onPointerDown={down} onPointerMove={move} onPointerUp={up}>
              <img src={host.sampleSrc(sample.id)} alt={sample.name} draggable={false} />
              {region && mode === "look" && <span className={s.box} style={pct(region)} />}
              {rect && <span className={s.box} data-kind="new" style={pct(rect)} />}
            </div>
            <span className={s.caption}>{mode === "cut" ? "框出要裁的图" : sample.name}</span>
          </>}
        </div>
      </div>
      <div className={s.row}>
        {mode === "look" ? <>
          <button type="button" className={`${w.btn} ${w.sm}`} disabled={!sample || !mine || busy} onClick={() => void tryIt()}>{busy ? "试中…" : "在画面上试一下"}</button>
          <button type="button" className={`${w.btn} ${w.sm}`} disabled={!sample} onClick={() => { setMode("region"); setRect(null); setSaid(null); }}>改区域</button>
        </> : <>
          <input aria-label="新图的名字" className={`${w.input} ${s.grow}`} placeholder="名字，如 mail-icon" value={name} onChange={(e) => setName(e.target.value)} />
          <button type="button" className={`${w.btn} ${w.sm} ${w.primary}`} disabled={!rect || !name.trim() || busy} onClick={() => void cut()}>{busy ? "裁剪中…" : "裁好填回"}</button>
          <button type="button" className={`${w.btn} ${w.sm}`} onClick={() => { setMode("look"); setRect(null); }}>取消</button>
        </>}
      </div>
      {said && <span className={said[1] ? `${w.muted} ${w.okText}` : w.message} role="status">{said[0]}</span>}
      {mode === "look" && said?.[0].startsWith("认") && <span className={`${w.muted} ${s.note}`}>网页估算，以手机为准</span>}
      <div className={s.filters}>
        <input aria-label="搜索图" className={`${w.input} ${s.grow}`} placeholder="搜索图名" value={query} onChange={(e) => { setQuery(e.target.value); setFocus(0); }} />
        <select aria-label="按页面" className={s.select} value={page} onChange={(e) => { setPage(e.target.value); setFocus(0); }}>
          <option value="">全部页面</option>
          {host.pages.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>
      <div ref={grid} className={s.grid} role="listbox" aria-label="图库" tabIndex={0} aria-activedescendant={`pick-${focus}`} onKeyDown={keys}>
        {shown.map((t, i) => <button key={t.name} id={`pick-${i}`} type="button" role="option" aria-selected={t.name === at.name} data-focus={i === focus || undefined}
          className={s.cell} title={t.name} tabIndex={-1} onClick={() => choose(i)} onMouseEnter={() => setFocus(i)}>
          <img src={t.src} alt="" loading="lazy" /><span>{t.name}</span></button>)}
        <button id={`pick-${shown.length}`} type="button" role="option" aria-selected={false} data-focus={focus === shown.length || undefined} className={`${s.cell} ${s.newCell}`}
          tabIndex={-1} disabled={!sample} onClick={() => choose(shown.length)} onMouseEnter={() => setFocus(shown.length)}><b>＋</b><span>裁一张新的</span></button>
      </div>
    </div>
  );
}

/** Grey values of an image's pixels. */
function grey(px: ImageData, x0: number, y0: number, w: number, h: number): Float32Array {
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = ((y0 + y) * px.width + (x0 + x)) * 4;
    out[y * w + x] = px.data[i] * 0.299 + px.data[i + 1] * 0.587 + px.data[i + 2] * 0.114;
  }
  return out;
}
/**
 * The best normalised correlation of the template inside [region] of the picture (the whole picture without one): an
 * estimate in the page, not the phone's matcher (which also merges theme variants and masks).
 */
async function matchOn(pictureSrc: string, templateSrc: string, region: number[] | null): Promise<number> {
  const [pic, tpl] = await Promise.all([pixelsOf(pictureSrc), pixelsOf(templateSrc)]);
  // Whole pixels: a region scaled from another reference height is fractional, and ImageData is read by whole indices.
  const r = region?.map(Math.round);
  const [rx, ry, rw, rh] = r ? [Math.max(0, r[0]), Math.max(0, r[1]), Math.min(r[2], pic.width - Math.max(0, r[0])), Math.min(r[3], pic.height - Math.max(0, r[1]))]
    : [0, 0, pic.width, pic.height];
  const tw = tpl.width, th = tpl.height;
  if (rw < tw || rh < th) return 0;
  const T = grey(tpl, 0, 0, tw, th), R = grey(pic, rx, ry, rw, rh);
  // Fewer positions and pixels on large searches, to stay well under a second.
  const positions = (rw - tw + 1) * (rh - th + 1);
  const step = Math.max(1, Math.floor(Math.sqrt(positions * tw * th / 4e7)));
  const ps = Math.max(1, Math.floor(step / 2) || 1);
  let mean = 0, n = 0;
  for (let y = 0; y < th; y += ps) for (let x = 0; x < tw; x += ps) { mean += T[y * tw + x]; n++; }
  mean /= n;
  let tv = 0;
  for (let y = 0; y < th; y += ps) for (let x = 0; x < tw; x += ps) { const d = T[y * tw + x] - mean; tv += d * d; }
  let best = -1;
  for (let oy = 0; oy + th <= rh; oy += step) for (let ox = 0; ox + tw <= rw; ox += step) {
    let sum = 0;
    for (let y = 0; y < th; y += ps) for (let x = 0; x < tw; x += ps) sum += R[(oy + y) * rw + ox + x];
    const m = sum / n;
    let cross = 0, rv = 0;
    for (let y = 0; y < th; y += ps) for (let x = 0; x < tw; x += ps) {
      const a = R[(oy + y) * rw + ox + x] - m, b = T[y * tw + x] - mean;
      cross += a * b; rv += a * a;
    }
    const score = tv && rv ? cross / Math.sqrt(tv * rv) : 0;
    if (score > best) best = score;
  }
  return Math.max(0, best);
}
