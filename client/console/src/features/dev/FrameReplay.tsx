import { useEffect, useState } from "react";
import { dev, type DevFrame, type DevRun, type Obj } from "./api";
import { arr, objs, str } from "./model";
import s from "./Workspace.module.css";

/**
 * 试跑逐帧回放 (automation-architecture-v2 §6): up to the latest 30 judgement/tap rounds of a trial, each drawn with its
 * candidate regions (green = pass, red = miss), colour points and the tap.
 */
export function useFrames(run: DevRun | null): DevFrame[] {
  const [frames, setFrames] = useState<DevFrame[]>([]);
  const id = run?.id; const count = run?.frameCount ?? 0;
  useEffect(() => {
    let live = true;
    if (!id || !count) { setFrames([]); return; }
    dev.runFrames(id).then((list) => { if (live) setFrames(list); }).catch(() => { if (live) setFrames([]); });
    return () => { live = false; };
  }, [id, count]);
  return frames;
}

const summary = (c: Obj): string => {
  const kind = str(c.kind) ?? "";
  if (kind === "image" || kind === "absentImage") return `${kind === "absentImage" ? "无" : ""}图 ${str(c.expect) ?? ""}${typeof c.score === "number" ? ` ${c.score.toFixed(2)}` : ""}`;
  if (kind === "color" || kind === "absentColor") return `${kind === "absentColor" ? "无" : ""}色 ${c.points ?? 0} 点${typeof c.worst === "number" ? ` 差 ${c.worst}≤${c.tolerance ?? 24}` : ""}`;
  return `${kind === "absentText" ? "无" : ""}「${str(c.expect) ?? ""}」${typeof c.count === "number" ? ` ${c.count} 处字` : ""}`;
};

/** One round: its picture with what was looked for and where it tapped, and the conditions one per line. */
export function FrameView({ frame: f }: { frame: DevFrame }) {
  const refW = f.referenceWidth || 2400;
  const refH = f.referenceHeight || 1080;
  const fw = f.frameWidth || refW;
  const fh = f.frameHeight || refH;
  const conds = objs(f.conditions).filter((c) => !String(c.state ?? "").startsWith("interruption:"));
  const box = (r: number[], w: number, h: number) => ({ left: `${(r[0] / w) * 100}%`, top: `${(r[1] / h) * 100}%`, width: `${(r[2] / w) * 100}%`, height: `${(r[3] / h) * 100}%` });
  return <>
    {f.thumb && (
      <div className={s.screen}>
        <img src={`data:image/jpeg;base64,${f.thumb}`} alt="这一轮的画面" />
        {conds.map((c, i) => {
          const within = arr(c.within).map(Number);
          if (within.length === 4) return <span key={`r${i}`} className={s.box} data-pass={c.pass === true ? "true" : undefined} style={box(within, refW, refH)} />;
          return arr(c.at).map((pt, j) => {
            const xy = arr(pt).map(Number);
            return xy.length === 2 ? <span key={`c${i}-${j}`} className={s.point} data-pass={c.pass === true ? "true" : undefined}
              style={{ left: `${(xy[0] / refW) * 100}%`, top: `${(xy[1] / refH) * 100}%` }} /> : null;
          });
        })}
        {f.tapRegion?.length === 4 && <span className={s.box} data-kind="tap" style={box(f.tapRegion, fw, fh)} />}
        {f.tap?.length === 2 && <span className={s.tap} title={`点 (${Math.round(f.tap[0])}, ${Math.round(f.tap[1])})`}
          style={{ left: `${(f.tap[0] / fw) * 100}%`, top: `${(f.tap[1] / fh) * 100}%` }} />}
      </div>
    )}
    {conds.length > 0 && <div className={s.conds}>
      {conds.slice(0, 8).map((c, i) => <div key={i} data-pass={c.pass === true ? "true" : c.pass === false ? "false" : undefined}>{c.pass === true ? "✓" : c.pass === false ? "✗" : "·"} {summary(c)}</div>)}
    </div>}
  </>;
}
