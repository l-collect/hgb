import { useEffect, useState } from "react";
import { navigate, usePath, useQuery } from "../../router";
import { dev, sampleNow, type DriftWarning, type Sample, type Template } from "./api";
import { devPaths, failure, useDev } from "./context";
import { useDevice } from "./wb";
import w from "./Wb.module.css";
import m from "./Samples.module.css";

/** A drift warning's kind in words (as 任务's 漂移预警 lists them). */
export const DRIFT: Record<string, string> = { image: "小图", absentImage: "反面图", color: "取色差", text: "文字", redundantImage: "辅助图", redundantColor: "辅助色" };
const IMAGE = new Set(["image", "absentImage", "redundantImage"]);
/** Why it warned, short: 「相似度 0.83，要 ≥0.80」. */
export function driftReason(d: Pick<DriftWarning, "kind" | "observed" | "threshold">): string {
  const need = d.threshold.replace(/^≥/, "≥ ").replace(/^≤/, "≤ ").replace(/^</, "< ");
  if (IMAGE.has(d.kind)) return `相似度 ${d.observed}，要 ${need}`;
  if (d.kind === "color" || d.kind === "redundantColor") return `${d.observed.replace(/^色差/, "色差 ")}，容差 ${need}`;
  if (d.kind === "text") return `识别 ${d.observed}，要 ${need}`;
  return `${d.observed}（阈值 ${d.threshold}）`;
}
/** The address that opens 素材 on a drift warning: `?drift=<state>:<kind>:<subject>`. */
export const driftLink = (d: Pick<DriftWarning, "state" | "kind" | "subject">) => `${devPaths.assets}?drift=${encodeURIComponent(`${d.state}:${d.kind}:${d.subject}`)}`;
export function parseDrift(raw: string | null): { state: string; kind: string; subject: string } | null {
  if (!raw) return null;
  const [state, kind, ...rest] = raw.split(":");
  return state && kind && rest.length ? { state, kind, subject: rest.join(":") } : null;
}

/** What 素材 shows for a drift warning: which list, which template is picked, which samples are lit, which tool is open. */
export interface DriftFocus { tab: "samples" | "templates" | "colors"; template?: string | null; samples?: string[]; tool?: "template" | null; key: string }

/** The template a warning names (its id, or the id without its @theme), when there is one. */
export const templateOf = (subject: string, templates: Template[]) => templates.find((t) => t.id === subject) ?? templates.find((t) => t.id.split("@")[0] === subject);

/**
 * 漂移 on top of 素材: what drifted, and the way through it in order: ① 采一张新的 → ② 对比 (old and new side by side) →
 * ③ 替换模板 (image kinds: cut it again on the new sample, same name) or 加入样本 (text, colours: the new sample kept, named
 * for the page) → 清掉这条预警.
 */
export function DriftGuide({ drift, onFocus }: { drift: { state: string; kind: string; subject: string }; onFocus: (focus: DriftFocus) => void }) {
  const { game } = useDev();
  const phone = useDevice();
  const query = useQuery();
  const path = usePath();
  const [warning, setWarning] = useState<DriftWarning | null | undefined>(undefined);
  const [samples, setSamples] = useState<Sample[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [fresh, setFresh] = useState<Sample | null>(null);
  const [sentAt, setSentAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [control, setControl] = useState<AbortController | null>(null);
  const [comparing, setComparing] = useState(false);
  const [kept, setKept] = useState(false);
  const [said, setSaid] = useState<[string, boolean] | null>(null);
  const key = `${drift.state}:${drift.kind}:${drift.subject}`;
  useEffect(() => {
    let live = true;
    dev.driftWarnings(game).then((all) => { if (live) setWarning(all.find((x) => x.state === drift.state && x.kind === drift.kind && x.subject === drift.subject) ?? null); }, () => { if (live) setWarning(null); });
    Promise.all([dev.samples(game), dev.templates(game)]).then(([s, t]) => { if (live) { setSamples(s); setTemplates(t); } }, () => undefined);
    return () => { live = false; };
  }, [game, key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (sentAt === null) return; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, [sentAt]);
  useEffect(() => () => control?.abort(), [control]);

  const image = IMAGE.has(drift.kind);
  const tpl = image ? templateOf(drift.subject, templates) : undefined;
  const source = tpl?.sample ? samples.find((x) => x.id === tpl.sample) : undefined;
  const withText = drift.kind === "text" ? samples.filter((x) => x.texts.some((t) => t.text.includes(drift.subject))).map((x) => x.id) : [];
  // The old picture to hold the new one against: the template (and the sample it was cut from), or a sample with the text, or the newest before.
  const older = samples.filter((x) => x.id !== fresh?.id);
  const oldSample = source ?? (withText.length ? older.find((x) => withText.includes(x.id)) : older[0]);
  useEffect(() => {
    onFocus(image ? { tab: "templates", template: tpl?.id ?? null, key }
      : drift.kind === "text" ? { tab: "samples", samples: withText, key }
      : { tab: "colors", key });
  }, [key, tpl?.id, withText.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  const take = async () => {
    if (!phone?.online) { setSaid(["当前手机不在线", false]); return; }
    const mine = new AbortController(); setControl(mine); setSaid(null); setSentAt(null);
    try {
      const made = await sampleNow(game, phone.id, mine.signal, () => { setSentAt(Date.now()); setNow(Date.now()); }, `漂移 ${drift.state}`);
      setFresh(made); setComparing(true); setSamples(await dev.samples(game));
    } catch (error) { if (!mine.signal.aborted) setSaid([error instanceof Error && !(error as { status?: number }).status ? error.message : failure(error), false]); }
    finally { setControl(null); setSentAt(null); }
  };
  const cancel = () => { control?.abort(); setSaid(["已取消", true]); };
  /** ③ for an image: the new sample open with 裁模板, to cut it again under the same name. */
  const recut = () => {
    if (!fresh) return;
    onFocus({ tab: "samples", tool: "template", key: `${key}:cut` });
    navigate(`${devPaths.asset(fresh.id)}?${query.toString()}`);
    setSaid([`在图上框出它，模板名写 ${tpl?.id ?? drift.subject}（同名就是替换）`, true]);
  };
  /** ③ for text and colours: the new sample kept, named for the page, so 页面 judges it from now on. */
  const keep = async () => {
    if (!fresh) return;
    try { await dev.changeSample(fresh.id, { name: `${drift.state} · 漂移后` }); setKept(true); setSaid(["已加入样本", true]); }
    catch (error) { setSaid([failure(error), false]); }
  };
  const clear = async () => {
    try {
      await dev.clearDriftWarnings(game, drift);
      const q = new URLSearchParams(query.toString()); q.delete("drift");
      navigate(path + (q.toString() ? `?${q}` : ""), { replace: true });
    } catch (error) { setSaid([failure(error), false]); }
  };
  const step = !fresh ? 1 : !(kept || said?.[0].startsWith("在图上框出")) ? (comparing ? 3 : 2) : 4;
  const crop = (sample: Sample, rect: number[] | undefined, label: string) => {
    if (!rect || rect[3] <= 0) return <figure className={m.driftPic}><img src={dev.sampleImage(sample.id)} alt={label} /><figcaption className={w.muted}>{label}</figcaption></figure>;
    const k = Math.min(120 / rect[3], 220 / Math.max(1, rect[2]));
    return <figure className={m.driftPic}>
      <div className={m.driftCrop} style={{ width: rect[2] * k, height: rect[3] * k }}>
        <img src={dev.sampleImage(sample.id)} alt={label} style={{ left: -rect[0] * k, top: -rect[1] * k, width: sample.width * k }} /></div>
      <figcaption className={w.muted}>{label}</figcaption></figure>;
  };
  return (
    <section className={`${w.card} ${m.drift}`} aria-label="漂移引导">
      <div className={m.driftHead}>
        <b>漂移：{drift.state} {DRIFT[drift.kind] ?? drift.kind} {warning ? `${warning.observed}（阈值 ${warning.threshold}）` : ""}</b>
        <span className={w.muted}>{drift.subject}{warning === null ? " · 这条预警已经没了" : ""}</span>
      </div>
      {image && !tpl && templates.length > 0 && <span className={w.muted}>模板里没有 {drift.subject}，下面是全部模板</span>}
      <div className={m.driftSteps}>
        <button type="button" className={`${w.btn} ${w.sm} ${step === 1 ? w.primary : ""}`} disabled={!!control} onClick={() => void take()}>
          ① {control ? "采一张…" : fresh ? "再采一张" : "采一张新的"}</button>
        <button type="button" className={`${w.btn} ${w.sm} ${step === 2 ? w.primary : ""}`} disabled={!fresh} aria-pressed={comparing} onClick={() => setComparing(!comparing)}>② 对比</button>
        {image ? <button type="button" className={`${w.btn} ${w.sm} ${step === 3 ? w.primary : ""}`} disabled={!fresh} onClick={recut}>③ 替换模板</button>
          : <button type="button" className={`${w.btn} ${w.sm} ${step === 3 ? w.primary : ""}`} disabled={!fresh || kept} onClick={() => void keep()}>③ {kept ? "已加入样本" : "加入样本"}</button>}
        <button type="button" className={`${w.btn} ${w.sm} ${step === 4 ? w.primary : ""}`} onClick={() => void clear()}>清掉这条预警</button>
      </div>
      {control && <div className={m.driftLine}><span className={w.muted}>{sentAt === null ? "正在请手机采一张…" : `已发到手机 · ${Math.max(0, Math.round((now - sentAt) / 1000))} 秒`}</span>
        <button type="button" className={`${w.btn} ${w.sm}`} onClick={cancel}>取消</button></div>}
      {comparing && fresh && <div className={m.driftCompare}>
        {image && tpl ? <>
          <figure className={m.driftPic}><img className={m.driftTpl} src={dev.templateImage(game, tpl.id)} alt="旧模板" /><figcaption className={w.muted}>旧模板 {tpl.id}</figcaption></figure>
          {crop(fresh, tpl.rect, "新画面同一处")}
        </> : <>
          {oldSample ? <figure className={m.driftPic}><img src={dev.sampleImage(oldSample.id)} alt="旧样本" /><figcaption className={w.muted}>旧：{oldSample.name}</figcaption></figure>
            : <span className={w.muted}>没有旧样本可比</span>}
          <figure className={m.driftPic}><img src={dev.sampleImage(fresh.id)} alt="新样本" /><figcaption className={w.muted}>新：{fresh.name}</figcaption></figure>
        </>}
      </div>}
      {said && <span className={said[1] ? `${w.muted} ${w.okText}` : w.message} role="status">{said[0]}</span>}
    </section>
  );
}
