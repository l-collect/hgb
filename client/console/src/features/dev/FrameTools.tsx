import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { Stepper } from "../../components/ui";
import { Link } from "../../router";
import { dev, type Sample, type Template } from "./api";
import { colorAt, colorLine, pixelsOf, validSetName, type ColorPick } from "./colors";
import { devPaths, failure, useDev } from "./context";
import { isObj, nodeDigest, resources, target } from "./model";
import w from "./Wb.module.css";
import s from "./Workspace.module.css";

type Tool = "region" | "template" | "color";
const TOOLS: [Tool, string][] = [["region", "框区域"], ["template", "裁模板"], ["color", "取色"]];
const overlaps = (a: number[], b: number[]) => a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3];
const pct = (r: number[], sm: { width: number; height: number }) => ({ left: `${r[0] / sm.width * 100}%`, top: `${r[1] / sm.height * 100}%`, width: `${r[2] / sm.width * 100}%`, height: `${r[3] / sm.height * 100}%` });
/** A template's search region: its box with some room around it, inside the sample (as 素材 writes it). */
const padded = (rect: number[], sm: { width: number; height: number }) => {
  const x = Math.max(0, rect[0] - 24), y = Math.max(0, rect[1] - 24);
  return [x, y, Math.min(sm.width - x, rect[2] + 48), Math.min(sm.height - y, rect[3] + 48)];
};

/**
 * 框区域 / 裁模板 / 取色 / 存样本 on a picture of the phone (where a trial stopped, or the live screen). The picture is
 * kept as a sample first (made height 1080, bars cut, as every sample), so the numbers are the ones 素材 gives; the
 * condition made goes 插到 the line, or is copied.
 */
export function FrameTools({ picture, makeSample, line, onInsert, assets }: {
  /** What is shown until a tool is picked. */
  picture: ReactNode;
  makeSample: () => Promise<Sample>;
  /** The line a condition goes after (the failed line or the cursor's); null: only 复制. */
  line: number | null; onInsert: (text: string, after: number) => void;
  /** 素材 with this line to come back to. */
  assets: string;
}) {
  const { game, apply, me } = useDev();
  const [sample, setSample] = useState<Sample | null>(null);
  const [tool, setTool] = useState<Tool | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [said, setSaid] = useState<[string, boolean] | null>(null);
  const [rect, setRect] = useState<number[] | null>(null);
  const [picks, setPicks] = useState<ColorPick[]>([]);
  const [tolerance, setTolerance] = useState(24);
  const [groupName, setGroupName] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [confirmed, setConfirmed] = useState<string[]>([]);
  const [reason, setReason] = useState("");
  const [made, setMade] = useState<Template | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const start = useRef<[number, number] | null>(null);
  useEffect(() => { setRect(null); setPicks([]); setMade(null); setConfirmed([]); setGroupName(null); }, [tool]);

  const ensure = async (): Promise<Sample | null> => {
    if (sample) return sample;
    setBusy("keep"); setSaid(null);
    try { const made = await makeSample(); setSample(made); return made; }
    catch (error) { setSaid([failure(error), false]); return null; }
    finally { setBusy(null); }
  };
  const pick = async (t: Tool) => {
    if (tool === t) { setTool(null); return; }
    const got = await ensure(); if (!got) return;
    setTool(t);
    // Region and template want the words on the picture: read on the server when it can.
    if (t !== "color" && !got.recognized && me?.serverRecognizer) {
      setBusy("read");
      try { setSample(await dev.recognizeSample(got.id)); } catch { /* boxes work without words */ }
      setBusy(null);
    }
  };
  const keep = async () => { const got = await ensure(); if (got) setSaid(["已存样本", true]); };
  const copy = (text: string) => { void navigator.clipboard?.writeText(text); setSaid(["已复制", true]); };

  const scale = () => sample ? (box.current?.clientWidth ?? sample.width) / sample.width : 1;
  const at = (e: PointerEvent<HTMLDivElement>): [number, number] => {
    const r = box.current!.getBoundingClientRect();
    return [Math.round((e.clientX - r.left) / scale()), Math.round((e.clientY - r.top) / scale())];
  };
  const down = (e: PointerEvent<HTMLDivElement>) => {
    if (!sample || !tool) return;
    if (tool === "color") {
      const [x, y] = at(e);
      const near = picks.findIndex((p) => Math.abs(p.x - x) <= 4 && Math.abs(p.y - y) <= 4);
      if (near >= 0) { setPicks(picks.filter((_, k) => k !== near)); return; }
      if (picks.length >= 32) return;
      void pixelsOf(dev.sampleImage(sample.id)).then((px) => {
        const cx = Math.min(x, px.width - 1), cy = Math.min(y, px.height - 1);
        const hex = colorAt(px, cx, cy);
        if (hex) setPicks((all) => [...all, { x: cx, y: cy, hex }]);
      }).catch((error) => setSaid([failure(error), false]));
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId); start.current = at(e); setRect(null); setMade(null);
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    if (!start.current) return;
    const [x, y] = at(e); const [sx, sy] = start.current;
    setRect([Math.min(x, sx), Math.min(y, sy), Math.abs(x - sx), Math.abs(y - sy)]);
  };
  const up = () => { start.current = null; setRect((r) => r && (r[2] < 4 || r[3] < 4) ? null : r); };

  const inside = sample && rect ? [...new Set(sample.texts.filter((t) => overlaps(t.box, rect)).map((t) => t.text))] : [];
  const cut = async () => {
    if (!sample || !rect || !name.trim()) return;
    setBusy("cut"); setSaid(null);
    try {
      const t = await dev.cut(game, { id: name.trim(), sample: sample.id, rect, confirmedTexts: confirmed, reason: reason.trim() || undefined });
      setMade(t);
      // A template is cut to be used: it goes into the draft's resources at once.
      const entry = { id: t.id, assetName: t.assetName, bytes: t.bytes, sha256: t.sha256 };
      const problem = await apply(async (b) => {
        const old = resources(b).find((r) => r.id === t.id);
        return [old ? { op: "put", path: `resources:${t.id}`, expect: await nodeDigest(old), value: entry } : { op: "insert", path: "", field: "resources", value: entry }];
      });
      if (problem) setSaid([problem, false]);
    } catch (error) { setSaid([failure(error), false]); }
    setBusy(null);
  };
  /** Keeps the points as a named set in the game's library, relative to their top-left (as 素材 does). */
  const saveSet = async (named: string) => {
    if (!validSetName(named)) { setSaid(["组名不能有空格、@、#、逗号或引号", false]); return; }
    const x0 = Math.min(...picks.map((p) => p.x)), y0 = Math.min(...picks.map((p) => p.y));
    let kept = false;
    const problem = await apply(async (b) => {
      const now = target(b, game); if (!now) return [];
      const library = isObj(now.library) ? now.library : {};
      const old = isObj(library.colors) ? library.colors : {};
      if (named in old && !confirm(`已有取色组 ${named}，替换它？`)) { kept = true; return []; }
      const colors = { ...old, [named]: picks.map((p) => `${p.x - x0},${p.y - y0}#${p.hex}`) };
      return [{ op: "put", path: `targets:${game}`, expect: await nodeDigest(now), value: { ...now, library: { ...library, colors } } }];
    });
    if (kept) return;
    setGroupName(null);
    setSaid(problem ? [problem, false] : [`已存为 ${named} · 写 色 ${named}@${x0},${y0} 容差 ${tolerance}`, true]);
  };

  const result: { head: string; text: string } | null = !sample || !tool ? null
    : tool === "color" ? (picks.length ? { head: `取色 · ${picks.length} 点 · 容差 ${tolerance}`, text: colorLine(picks, tolerance) } : null)
    : !rect ? null
    : tool === "region" ? { head: inside.length ? `框区域 · 读到「${inside.join("」「")}」` : "框区域", text: `"${inside[0] ?? "文字"}"@${rect.join(",")}` }
    : made ? { head: `模板 ${made.id} · ${made.width}×${made.height}`, text: `图 ${made.id.split("@")[0]}@${padded(rect, sample).join(",")}` } : null;

  return (
    <div className={s.tools}>
      {sample && tool ? (
        <div ref={box} className={s.canvas} onPointerDown={down} onPointerMove={move} onPointerUp={up}>
          <img src={dev.sampleImage(sample.id)} alt={sample.name} draggable={false} />
          {rect && <span className={s.box} data-kind="pick" style={pct(rect, sample)} />}
          {tool === "color" && picks.map((p, i) => <span key={i} className={s.pick} style={{ left: `${p.x / sample.width * 100}%`, top: `${p.y / sample.height * 100}%` }} />)}
        </div>
      ) : picture}
      <div className={s.toolRow}>
        {TOOLS.map(([id, label]) => <button key={id} type="button" className={`${w.btn} ${w.sm}`} aria-pressed={tool === id} disabled={!!busy} onClick={() => void pick(id)}>{label}</button>)}
        <button type="button" className={`${w.btn} ${w.sm}`} disabled={!!busy} onClick={() => void keep()}>{busy === "keep" ? "存中…" : sample ? "已存样本" : "存样本"}</button>
      </div>
      {sample && tool && !result && <span className={w.muted}>{busy === "read" ? "识别文字…" : tool === "color" ? "点 3–6 个颜色稳定的点" : "在图上拖一个框"}</span>}
      {sample && tool === "template" && rect && !made && (
        <div className={s.result}>
          <span className={w.muted}>[{rect.join(", ")}]</span>
          <input aria-label="模板名" className={w.input} value={name} onChange={(e) => setName(e.target.value)} placeholder="模板名，如 mail-icon" />
          {(rect[2] > 64 || rect[3] > 64) && <input aria-label="超 64×64 的理由" className={w.input} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="超 64×64 的理由" />}
          {inside.length > 0 && <div className={s.checks}>确认是游戏里的字：{inside.map((t) => <label key={t}><input type="checkbox" checked={confirmed.includes(t)}
            onChange={(e) => setConfirmed(e.target.checked ? [...confirmed, t] : confirmed.filter((x) => x !== t))} />{t}</label>)}</div>}
          <button type="button" className={`${w.btn} ${w.primary} ${w.sm}`} disabled={!name.trim() || busy === "cut"} onClick={() => void cut()}>{busy === "cut" ? "裁剪中…" : "存为模板"}</button>
        </div>
      )}
      {sample && tool === "color" && <div className={s.line}><span className={w.muted}>容差</span><Stepper label="容差" value={tolerance} min={0} max={255} onChange={(v) => setTolerance(v ?? 24)} /></div>}
      {result && (
        <div className={s.result}>
          <span className={w.muted}>{result.head}</span>
          <code className={s.code}>{result.text}</code>
          <div className={s.toolRow}>
            {line !== null && <button type="button" className={`${w.btn} ${w.primary} ${w.sm} ${s.grow}`} onClick={() => onInsert(result.text, line)}>插到 L{line + 1}</button>}
            {tool === "color" && <button type="button" className={`${w.btn} ${w.sm}`} onClick={() => setGroupName(groupName === null ? "" : null)}>存为组</button>}
            <button type="button" className={`${w.btn} ${w.sm}`} onClick={() => copy(result.text)}>复制</button>
          </div>
          {groupName !== null && <div className={s.toolRow}>
            <input autoFocus aria-label="组名" className={`${w.input} ${s.grow}`} value={groupName} onChange={(e) => setGroupName(e.target.value)} placeholder="组名，如 破字印章" />
            <button type="button" className={`${w.btn} ${w.sm}`} disabled={!groupName.trim()} onClick={() => void saveSet(groupName.trim())}>存</button>
          </div>}
        </div>
      )}
      {said && <span className={said[1] ? `${w.muted} ${w.okText}` : w.message}>{said[0]}{said[1] && sample && said[0] === "已存样本" ? <> · <Link to={devPaths.asset(sample.id) + assets}>去素材 ›</Link></> : null}</span>}
    </div>
  );
}
