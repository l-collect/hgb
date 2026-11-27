import { useEffect, useMemo, useState } from "react";
import type { DevFrame, JudgeCell, Sample, SampleText } from "./api";
import { toPicture, type Size } from "./coords";
import { FrameView } from "./FrameReplay";
import { halfInside, textMatches } from "./textMatch";
import s from "./SpotPanels.module.css";

/**
 * The script editor's popovers beside 选图 and 在画面上选 (UI v8, 脚本编辑器浮层稿): what a `"字"@区域` reads on a
 * sample, what a page a line names is and where it leads, and what the screen was where the last trial failed.
 */

/** What 文字条件 and 页面引用 need from the workspace. */
export interface SpotHost {
  reference: Size;
  /** The game's samples, newest first. */
  samples: () => Promise<Sample[]>;
  sampleSrc: (id: string) => string;
  /** Reads every text on a sample on the server, as the phone does. */
  recognize: (id: string) => Promise<Sample>;
  /** A named region's numbers (`@弹窗按钮区`), null when there is none. */
  region: (name: string) => number[] | null;
  page: (id: string) => PageInfo | null;
  /** The sample a template was cut from, when known. */
  templateSample: (name: string) => string | null;
  /** Judges one page on one sample on the server: "server" when it cannot read screens, "phone" when only the phone can judge this page. */
  judge: (page: string, sample: string) => Promise<JudgeCell | "server" | "phone">;
  openPage: (id: string) => void;
}
/** A page as 页面引用 shows it: how it is recognized, one line per condition, and the pages it leads to. */
export interface PageInfo { id: string; name: string; conditions: string[]; templates: string[]; to: { id: string; name: string }[] }

/** What 失败行现场 needs: the failed trial, its frames at the failing action, and what can be done from there. */
export interface FailHost {
  /** 「14:22」. */
  time: string;
  why: string;
  frames: () => Promise<DevFrame[]>;
  rerun: () => void;
  /** Keeps the screen where the trial stopped as a sample; null when it has none. */
  keep: (() => Promise<unknown>) | null;
  replay: () => void;
}

const CLOSE = <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>;
const SWAP = <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 3h6.5M6.5 1l2 2-2 2M10 9H3.5M5.5 7l-2 2 2 2" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>;
const GO = <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 6h7.5M6.5 3l3 3-3 3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>;
const TICK = <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 5.2l2 2 4-4.4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>;
const CROSS = <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M2.5 2.5l5 5M7.5 2.5l-5 5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>;
const HOME = <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><path d="M3 8l6-5 6 5v7H3z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /><path d="M7.5 15v-4h3v4" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>;
const PREV = <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M7.5 2L3.5 6l4 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>;
const NEXT = <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M4.5 2l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>;

const pct = (r: number[], w: number, h: number) => ({ left: `${r[0] / w * 100}%`, top: `${r[1] / h * 100}%`, width: `${r[2] / w * 100}%`, height: `${r[3] / h * 100}%` });
/**
 * Where a region written in reference numbers lies on a sample, as the engine places it (ScreenLayout): scaled by
 * height, then docked as the anchor says; with no anchor and another width, each of centre, left and right.
 */
function placesOf(ref: number[], sample: Sample, reference: Size, anchor: string | null): number[][] {
  const r = toPicture(ref, [sample.width, sample.height], reference);
  const dW = sample.width - reference[0] * (sample.height / reference[1]);
  const shifts = anchor === "左" ? [0] : anchor === "中" ? [dW / 2] : anchor === "右" ? [dW] : Math.abs(dW) < 1 ? [0] : [dW / 2, 0, dW];
  return shifts.map((d) => [Math.round(r[0] + d), r[1], r[2], r[3]]);
}
const failText = (e: unknown) => e instanceof Error && e.message ? e.message : "没成功，稍后再试";
const plain = (t: string) => t.replace(/\s+/g, "");

/** The game's samples, read once per open panel. */
function useSamples(host: SpotHost) {
  const [list, setList] = useState<Sample[] | null>(null);
  useEffect(() => { let live = true; host.samples().then((x) => { if (live) setList(x); }, () => { if (live) setList([]); }); return () => { live = false; }; }, [host]);
  return [list, setList] as const;
}

/** 文字条件: the line's region on a sample, the texts read there, and whether the quoted text is among them. */
export function TextPanel({ line, text, region, whole, absent = false, host, onReplace, onEditRegion, onClose }: { line: number; text: string;
  /** The line wants the text not there (`没有 "字"@区域`): reading it is what fails. */
  absent?: boolean;
  /** The region's numbers or name as the line writes it. */
  region: string; whole: boolean; host: SpotHost; onReplace: (text: string) => void; onEditRegion: (() => void) | null; onClose: () => void }) {
  const [samples, setSamples] = useSamples(host);
  const [pick, setPick] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  // `@右:100,200,300,400` / `@左:弹窗按钮区`: the anchor says where a sample of another width puts the region.
  const anchor = /^([左中右]):/.exec(region)?.[1] ?? null;
  const ref = useMemo(() => {
    const bare = region.replace(/^[左中右]:/, "");
    const nums = bare.split(/[,，]/).map((x) => Number(x.trim()));
    return nums.length === 4 && nums.every(Number.isFinite) ? nums : host.region(bare);
  }, [region, host]);
  const seen = (t: SampleText) => whole ? plain(t.text) === plain(text) : textMatches(t.text, text);
  const sample = useMemo(() => {
    if (!samples?.length) return null;
    const chosen = samples.find((x) => x.id === pick);
    if (chosen) return chosen;
    // A sample where the text is seen in the region, else anywhere, else the newest.
    const inRegion = (x: Sample) => ref ? placesOf(ref, x, host.reference, anchor).some((r) => x.texts.some((t) => t.box.length === 4 && halfInside(t.box, r) && seen(t))) : false;
    return samples.find(inRegion) ?? samples.find((x) => x.texts.some(seen)) ?? samples[0];
  }, [samples, pick, ref, text, whole]); // eslint-disable-line react-hooks/exhaustive-deps
  // Where the engine may put the region on this sample (one place, or each docking when the width differs and no
  // anchor says): drawn at the one that reads the text, else the first; read in all of them.
  const places = sample && ref ? placesOf(ref, sample, host.reference, anchor) : [];
  const px = places.find((r) => sample!.texts.some((t) => t.box.length === 4 && halfInside(t.box, r) && seen(t))) ?? places[0] ?? null;
  const inside = sample && px ? sample.texts.filter((t) => t.box.length === 4 && halfInside(t.box, px)) : [];
  const near = sample && px ? sample.texts.filter((t) => t.box.length === 4 && !halfInside(t.box, px))
    .map((t) => ({ t, d: Math.hypot(t.box[0] + t.box[2] / 2 - (px[0] + px[2] / 2), t.box[1] + t.box[3] / 2 - (px[1] + px[3] / 2)) }))
    .sort((a, b) => a.d - b.d).slice(0, 2).map((x) => x.t) : [];
  const found = inside.some(seen);
  // A text with a quote mark in it would end the quoted text early: not offered.
  const words = Array.from(new Set(inside.map((t) => t.text.trim()).filter((t) => t && !/["“”]/.test(t))));
  const tryIt = async () => {
    if (!sample) return;
    setBusy(true); setSaid(null);
    try { const read = await host.recognize(sample.id); setSamples((all) => all?.map((x) => x.id === read.id ? read : x) ?? all); }
    catch (error) { setSaid(failText(error)); }
    finally { setBusy(false); }
  };
  return <div className={s.pop} role="dialog" aria-label={`第 ${line} 行的文字`} tabIndex={-1} onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); onClose(); } }}>
    <div className={s.head}>
      <b>第 {line} 行</b><span className={s.grow} />
      {samples && samples.length > 1 && <select className={s.select} aria-label="样本" value={sample?.id ?? ""} onChange={(e) => setPick(e.target.value)}>
        {samples.map((x) => <option key={x.id} value={x.id}>样本 · {x.name}</option>)}
      </select>}
      <button type="button" className={s.x} aria-label="关闭" onClick={onClose}>{CLOSE}</button>
    </div>
    {samples === null ? <div className={s.empty}>读取样本…</div>
      : !sample ? <div className={s.empty}>还没有样本 · 去素材采一张</div>
      : <>
        <div className={s.shot}>
          <img src={host.sampleSrc(sample.id)} alt={sample.name} />
          {px && <span className={s.region} style={pct(px, sample.width, sample.height)} />}
          {inside.map((t, i) => <span key={`i${i}`} className={s.read} style={pct(t.box, sample.width, sample.height)} title={t.text} />)}
          {near.map((t, i) => <span key={`o${i}`} className={s.read} data-out style={pct(t.box, sample.width, sample.height)} title={t.text} />)}
        </div>
        <div className={s.row}>
          {!ref ? <span className={`${s.status} ${s.danger}`}>认不出区域「{region}」</span>
            : !sample.recognized && !sample.texts.length ? <span className={s.muted}>这张还没读过字</span>
            : found ? <span className={`${s.status} ${absent ? s.danger : s.ok}`}>读到「{text}」</span>
            : <><span className={`${s.status} ${absent ? s.ok : s.danger}`}>没读到「{text}」</span><span className={s.muted}>· 区域里读到 {inside.length} 处</span></>}
          {said && <span className={s.danger}>{said}</span>}
        </div>
        {(words.length > 0 || near.length > 0) && <div className={s.chips}>
          <span className={s.cap}>读到</span>
          {words.map((w) => <button key={w} type="button" className={s.chip} title="换进引号" disabled={w === text} onClick={() => onReplace(w)}>{SWAP}{w}</button>)}
          {near.map((t, i) => <button key={`n${i}`} type="button" className={s.chip} disabled title="在区域外">{t.text}</button>)}
        </div>}
      </>}
    <div className={s.btns}>
      <button type="button" className={`${s.btn} ${s.primary}`} disabled={!sample || busy} onClick={() => void tryIt()}>{busy ? "读字中…" : "在画面上试一下"}</button>
      {onEditRegion && <button type="button" className={s.btn} onClick={onEditRegion}>改区域</button>}
    </div>
  </div>;
}

/** 页面引用: the page a line names, how it is recognized, where it leads; judged on a sample on demand. */
export function PagePanel({ line, page, host, onClose }: { line: number; page: string; host: SpotHost; onClose: () => void }) {
  const info = host.page(page);
  const [samples] = useSamples(host);
  const [verdict, setVerdict] = useState<JudgeCell | "server" | "phone" | null>(null);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const sample = useMemo(() => {
    if (!samples?.length) return null;
    const origin = info?.templates.map(host.templateSample).find((x) => !!x);
    return samples.find((x) => x.id === origin) ?? samples[0];
  }, [samples, info, host]);
  const judge = async () => {
    if (!sample) return;
    setBusy(true); setSaid(null);
    try { setVerdict(await host.judge(page, sample.id)); }
    catch (error) { setSaid(failText(error)); }
    finally { setBusy(false); }
  };
  const shown = info?.to.slice(0, 5) ?? [];
  const more = (info?.to.length ?? 0) - shown.length;
  return <div className={s.pop} role="dialog" aria-label={`第 ${line} 行的页面`} tabIndex={-1} onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); onClose(); } }}>
    <div className={s.head}>
      <span className={s.tile} data-tone="page">{HOME}</span>
      <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
        <b>{info?.name ?? page}</b><span className={`${s.muted} ${s.mono}`} style={{ fontSize: 12 }}>{page}</span>
      </div>
      <span className={s.grow} />
      <button type="button" className={s.x} aria-label="关闭" onClick={onClose}>{CLOSE}</button>
    </div>
    {!info ? <div className={s.empty}>页面库里没有「{page}」</div> : <>
      <div className={s.pair}>
        <div className={s.thumb}>
          {sample ? <div className={s.shot}><img src={host.sampleSrc(sample.id)} alt={sample.name} /></div>
            : <div className={s.empty}>{samples === null ? "读取样本…" : "还没有样本"}</div>}
        </div>
        <div className={s.conds}>
          <span className={s.cap}>怎么认</span>
          {info.conditions.length ? info.conditions.map((c, i) => <div key={i} className={s.cond}><span className={s.bullet}>·</span><span>{c}</span></div>)
            : <div className={`${s.cond} ${s.muted}`}>还没写怎么认</div>}
        </div>
      </div>
      {verdict !== null && <div className={s.row}>
        {verdict === "server" ? <span className={s.muted}>服务器读不了画面，去「页面」里用手机认</span>
          : verdict === "phone" || verdict.unknown ? <span className={s.muted}>这一页要用手机认{verdict !== "phone" && verdict.why ? ` · ${verdict.why}` : ""}，去「页面」里试</span>
          : <><span className={s.tile} data-size="sm" data-tone={verdict.holds ? "ok" : "bad"}>{verdict.holds ? TICK : CROSS}</span>
            <span className={verdict.holds ? s.ok : s.danger} style={{ fontWeight: 500 }}>{verdict.holds ? `这张是${info.name}` : `这张不是${info.name}`}</span>
            {typeof verdict.score === "number" && <span className={`${s.muted} ${s.num}`}>{verdict.score.toFixed(2)}</span>}
            {verdict.why && <span className={s.muted}>· {verdict.why}</span>}</>}
      </div>}
      {said && <div className={`${s.row} ${s.danger}`}>{said}</div>}
      {shown.length > 0 && <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <span className={s.cap}>能去</span>
        <div className={s.chips}>
          {shown.map((p) => <button key={p.id} type="button" className={s.chip} onClick={() => host.openPage(p.id)}>{p.name}{GO}</button>)}
          {more > 0 && <button type="button" className={s.chip} style={{ color: "var(--color-muted)" }} onClick={() => host.openPage(page)}>+{more}</button>}
        </div>
      </div>}
    </>}
    <div className={s.btns}>
      <button type="button" className={`${s.btn} ${s.primary}`} disabled={!info || !sample || busy} onClick={() => void judge()}>{busy ? "认画面中…" : "在画面上认一下"}</button>
      <span className={s.grow} />
      {info && <button type="button" className={`${s.btn} ${s.text}`} onClick={() => host.openPage(page)}>在「页面」里打开</button>}
    </div>
  </div>;
}

/** 失败行现场: the frames where the last trial failed on this line, stepped through, and what to do next. */
export function FailPanel({ line, host, onClose }: { line: number; host: FailHost; onClose: () => void }) {
  const [frames, setFrames] = useState<DevFrame[] | null>(null);
  const [at, setAt] = useState(-1);
  const [kept, setKept] = useState<"busy" | "done" | string | null>(null);
  useEffect(() => {
    let live = true;
    // Read again (frames uploaded later): the frame being looked at stays, the last one the first time.
    host.frames().then((x) => { if (live) { setFrames(x); setAt((was) => was >= 0 && was < x.length ? was : Math.max(0, x.length - 1)); } }, () => { if (live) setFrames([]); });
    return () => { live = false; };
  }, [host]);
  const frame = frames?.[at < 0 ? frames.length - 1 : at];
  const since = frame && frames ? (frame.atMs - frames[0].atMs) / 1000 : 0;
  const keep = async () => {
    if (!host.keep) return;
    setKept("busy");
    try { await host.keep(); setKept("done"); } catch (error) { setKept(failText(error)); }
  };
  return <div className={s.pop} role="dialog" aria-label={`第 ${line} 行上次试跑的画面`} tabIndex={-1} onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); onClose(); } }}>
    <div className={s.head}>
      <span className={s.tile} data-tone="bad">{CROSS}</span>
      <b>上次试跑 · {host.time}</b><span className={`${s.status} ${s.danger}`}>失败</span>
      <span className={s.grow} />
      <button type="button" className={s.x} aria-label="关闭" onClick={onClose}>{CLOSE}</button>
    </div>
    {frames === null ? <div className={s.empty}>读取画面…</div>
      : !frame ? <div className={s.empty}>这次试跑没留下画面</div>
      : <>
        <div className={s.frame}><FrameView frame={frame} /></div>
        {frames.length > 1 && <div className={s.row} style={{ flexWrap: "nowrap", gap: 10 }}>
          <button type="button" className={s.x} aria-label="上一帧" disabled={at === 0} onClick={() => setAt(at - 1)}>{PREV}</button>
          <span className={s.steps}>{frames.map((_, i) => <i key={i} data-on={i === at ? "" : undefined} />)}</span>
          <span className={`${s.muted} ${s.num}`}>{at + 1} / {frames.length} · {since.toFixed(1)} 秒</span>
          <button type="button" className={s.x} aria-label="下一帧" disabled={at === frames.length - 1} onClick={() => setAt(at + 1)}>{NEXT}</button>
        </div>}
      </>}
    {host.why && <span className={s.danger} style={{ fontWeight: 500, fontSize: 14 }}>{host.why}</span>}
    {kept && kept !== "busy" && kept !== "done" && <span className={s.danger}>{kept}</span>}
    <div className={s.btns}>
      <button type="button" className={`${s.btn} ${s.primary}`} onClick={host.rerun}>重跑这一步</button>
      {host.keep && <button type="button" className={s.btn} disabled={kept === "busy" || kept === "done"} onClick={() => void keep()}>{kept === "done" ? "已存样本" : kept === "busy" ? "存样本中…" : "存成样本"}</button>}
      <span className={s.grow} />
      <button type="button" className={`${s.btn} ${s.text}`} onClick={host.replay}>完整回放</button>
    </div>
  </div>;
}
