/**
 * 设置抽屉 (Drawer.dc.html): the chosen card's settings in plain words, each change written back into its line at once
 * (the same text the script view edits). Pictures and places are chosen with 选图 and 在画面上框, never typed as numbers.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Obj } from "../api";
import { dev, type Sample } from "../api";
import { atText, toPicture, type Size } from "../coords";
import { objs, str } from "../model";
import { newestSample, ScreenPick } from "../ScreenPick";
import type { ScriptNames } from "../ScriptEditor";
import { braceFit, readsAsNumber, slotOf, spanOf, valuesOf, type Slot } from "../settingUse";
import { TemplatePicker } from "../TemplatePicker";
import { NewConfigDialog } from "../config/NewConfigDialog";
import { numberPreset } from "../config/fields";
import { look, type LookCtx, YES_NO } from "./graph";
import { argOf, imageOf, limitOf, quotedOf, regionOf, secondsOf, setArg, setImage, setLimit, setQuoted, setRegion, setSeconds, setThreshold, splitLine, tokens,
  type Doc, type Place, type Stmt } from "./script";
import c from "./Canvas.module.css";
import ps from "../Picker.module.css";

export interface DrawerProps {
  doc: Doc; stmt: Stmt; ctx: LookCtx;
  /** Puts [code] as line [line]'s statement (indentation and comment kept). */
  setCode: (line: number, code: string) => void;
  /** Replaces the whole text (adding or taking away case lines). */
  edit: (op: { kind: "remove"; line: number } | { kind: "insert"; place: Place; lines: string[] }) => void;
  onAdd: (place: Place) => void;
  onFold: (line: number) => void; folded: boolean;
  onClose: () => void; onScript: (line: number) => void; onSnippet: (name: string) => void;
  fields: Obj[]; taskId?: string; stepId?: string; names: ScriptNames; game: string; reference: Size;
  readOnly: boolean; issue: { reason: string; warning: boolean } | null;
  onDelete: () => void;
  saved: string;
}

export function Drawer(p: DrawerProps) {
  const { stmt: s, doc } = p;
  const raw = doc.lines[s.line - 1] ?? "";
  const { code } = splitLine(raw);
  const lk = look(s, raw, p.ctx);
  const put = (next: string) => { if (!p.readOnly && next !== code) p.setCode(s.line, next); };
  const word = s.word;
  const title = s.kind === "case" ? (s.parent?.kind === "setting" ? "按配置项分 · 一个值" : "一种情况") : lk.title;
  const full = `0,0,${p.reference[0]},${p.reference[1]}`;

  let body: ReactNode;
  switch (s.kind) {
    case "tap": case "wait": case "ifSee": case "ifNot": case "ifHas":
      body = <>
        <Target code={code} put={put} p={p} full={full} tap={s.kind === "tap"} />
        {s.kind !== "ifHas" && <NumberSlot label={s.kind === "tap" ? "找不到时最多等" : "最多等"} unit="秒" code={code} put={put} word={word} p={p} optional />}
        {s.kind === "tap" && <NumberSlot label="最多点几次" unit="次" code={code} put={put} word={word} p={p} optional />}
        {YES_NO[s.kind] && <Else s={s} p={p} />}
      </>;
      break;
    case "pause": case "longWait": {
      const v = secondsOf(code)?.value ?? "";
      body = s.kind === "pause"
        ? <NumberField label="等多久" value={v} unit="秒" slot={slotOf("等待", "秒")} p={p} onChange={(x) => put(setSeconds(code, x ?? "1"))} />
        : <NumberField label="放宽到" value={v} unit="秒" slot={null} p={p} onChange={(x) => put(setSeconds(code, x ?? "300"))} hint="10–3600 秒；长等待的时长要写死" />;
      break;
    }
    case "go": {
      const a = argOf(code)?.value ?? "";
      body = <>
        <div className={c.fl}><label>去哪个页面</label>
          <select className={c.select} value={a} disabled={p.readOnly} onChange={(e) => put(setArg(code, e.target.value))}>
            {!p.names.pages.includes(a) && <option value={a}>{a || "—"}</option>}
            {p.names.pages.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
          <span className={c.hint}>按页面图走最短的路过去</span></div>
        <NumberSlot label="最多走几步" unit="步" code={code} put={put} word={word} p={p} optional />
      </>;
      break;
    }
    case "repeat":
      body = <><NumberSlot label="重复多少次" unit="次" code={code} put={put} word={word} p={p} />
        <span className={c.hint}>用「跳出」提前结束；做满次数后接着往下走。</span>
        <button type="button" className={c.btn} onClick={() => p.onFold(s.line)}>{p.folded ? "在画板上展开这一组" : "在画板上折叠这一组"}</button></>;
      break;
    case "until":
      body = <><Cond label="直到看到" code={code} put={put} p={p} />
        <NumberSlot label="最多做几次" unit="次" code={code} put={put} word={word} p={p} /></>;
      break;
    case "each": {
      const m = /^逐个\s+(\S+)\s+在\s+(\S+)$/.exec(code);
      body = <>
        <TextField label="名字" value={m?.[1] ?? ""} p={p} onCommit={(x) => put(`逐个 ${x || "名"} 在 ${m?.[2] ?? "甲,乙"}`)} hint="下面的行里写 {名字}，每一遍换成一个值" />
        <TextField label="每个值（逗号分开）" value={m?.[2] ?? ""} p={p} onCommit={(x) => put(`逐个 ${m?.[1] ?? "名"} 在 ${x.replace(/\s+/g, "") || "甲,乙"}`)} />
      </>;
      break;
    }
    case "cases":
      body = <><Cases s={s} p={p} full={full} /><NumberSlot label="最多等" unit="秒" code={code} put={put} word={word} p={p} optional /></>;
      break;
    case "setting":
      body = <SettingCases s={s} p={p} code={code} put={put} />;
      break;
    case "case":
      body = <><TextField label={s.parent?.kind === "setting" ? "值" : "情况名"} value={s.word} p={p} onCommit={(x) => put(code.replace(s.word, x || s.word))} />
        {s.parent?.kind === "cases" && <TextField label="条件" value={code.slice(s.word.length).trim()} p={p} onCommit={(x) => put(`${s.word} ${x}`.trim())} mono />}
        <span className={c.hint}>{s.children.length ? `下面 ${s.children.length} 句` : "这一支还是空的：选它时什么也不做"}</span>
        <button type="button" className={c.btn} disabled={p.readOnly} onClick={() => p.onAdd({ kind: "first", parent: s.line, branch: "children" })}>＋ 在这一支里接一句</button></>;
      break;
    case "use": {
      const a = argOf(code)?.value ?? "";
      body = <div className={c.fl}><label>用哪个片段</label>
        <select className={c.select} value={a} disabled={p.readOnly} onChange={(e) => put(setArg(code, e.target.value))}>
          {!p.names.snippets.includes(a) && <option value={a}>{a || "—"}</option>}
          {p.names.snippets.map((x) => <option key={x} value={x}>{x}</option>)}
        </select>
        <button type="button" className={c.link} style={{ alignSelf: "flex-start" }} onClick={() => p.onSnippet(a)}>打开片段 ›</button></div>;
      break;
    }
    case "result": case "stop":
      body = <TextField label={s.kind === "result" ? "写什么结果" : "停下的原因"} value={quotedOf(code)?.value ?? ""} p={p} onCommit={(x) => put(quotedOf(code) ? setQuoted(code, x) : `${word} "${x}"`)} />;
      break;
    case "report": case "reset":
      body = <TextField label={s.kind === "report" ? "事件名" : "计数名"} value={argOf(code)?.value ?? ""} p={p} onCommit={(x) => put(setArg(code, x || "名"))} />;
      break;
    case "raw":
      body = <div className={c.warn}>这一句画板认不出，原样保留。要改请去脚本。</div>;
      break;
    default:
      body = null;
  }

  return (
    <aside className={c.drawer} aria-label={`${title} 设置`} onKeyDown={(e) => { if (e.key === "Escape" && !e.defaultPrevented) { e.preventDefault(); p.onClose(); } }}>
      <div className={c.dh}>
        <span className={c.ic} data-group={lk.group}>{lk.icon}</span>
        <b>{title}</b>
        <button type="button" className={c.toLine} onClick={() => p.onScript(s.line)}>脚本第 {s.line} 行 ›</button>
        <button type="button" className={c.x} aria-label="关闭" title="关闭 Esc" onClick={p.onClose}>✕</button>
      </div>
      <div className={c.db}>
        {p.issue && <div className={p.issue.warning ? c.warn : c.err}>{p.issue.warning ? "提醒 · " : ""}{p.issue.reason}</div>}
        {body}
        <RawLine code={code} p={p} put={put} readOnly={p.readOnly || s.kind === "raw"} />
      </div>
      <div className={c.df}>
        {!p.readOnly && s.kind !== "else" && <button type="button" className={c.btn} onClick={p.onDelete}>删除这一句</button>}
        <span style={{ flex: 1 }} />
        <span className={c.muted}>{p.readOnly ? "只读" : p.saved}</span>
      </div>
    </aside>
  );
}

/** The line as written (without indentation): for whatever the fields above do not cover. */
/** What was typed but not yet written back is written when the field goes away (another card chosen, 脚本 opened, ⌘E). */
function useCommitOnLeave(pending: boolean, commit: () => void) {
  const live = useRef({ pending, commit }); live.current = { pending, commit };
  useEffect(() => () => { if (live.current.pending) live.current.commit(); }, []);
}
function RawLine({ code, put, readOnly }: { code: string; p: DrawerProps; put: (x: string) => void; readOnly: boolean }) {
  const [v, setV] = useState(code);
  useEffect(() => setV(code), [code]);
  useCommitOnLeave(!readOnly && !!v.trim() && v !== code, () => put(v.trim()));
  return <div className={c.fl}><label>这一句</label>
    <input className={`${c.input} ${c.mono}`} value={v} readOnly={readOnly} spellCheck={false} aria-label="这一句的原文"
      onChange={(e) => setV(e.target.value)} onBlur={() => { if (v.trim() && v !== code) put(v.trim()); }}
      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLInputElement).blur(); } if (e.key === "Escape" && v !== code) { setV(code); e.preventDefault(); } }} />
    {!readOnly && <span className={c.hint}>回车写回；缩进和注释不用管</span>}
  </div>;
}

function TextField({ label, value, onCommit, p, hint, mono }: { label: string; value: string; onCommit: (v: string) => void; p: DrawerProps; hint?: string; mono?: boolean }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  useCommitOnLeave(!p.readOnly && v !== value, () => onCommit(v.trim()));
  return <div className={c.fl}><label>{label}</label>
    <input className={`${c.input} ${mono ? c.mono : ""}`} value={v} readOnly={p.readOnly} onChange={(e) => setV(e.target.value)}
      onBlur={() => { if (v !== value) onCommit(v.trim()); }} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
    {hint && <span className={c.hint}>{hint}</span>}
  </div>;
}

/** What a 点 / 等 / 如果… looks for: a picture (选图) or a text, where (在画面上框), and how alike a picture has to be. */
function Target({ code, put, p, full, tap }: { code: string; put: (x: string) => void; p: DrawerProps; full: string; tap: boolean }) {
  const toks = tokens(code);
  const im = imageOf(code);
  const q = !im ? quotedOf(code) : null;
  const simple = !!im || !!q;
  const [picking, setPicking] = useState<"image" | "region" | null>(null);
  const region = regionOf(code);
  const nums = region ? region.value.split(/[,，]/).map(Number) : null;
  const box = nums && nums.length === 4 && nums.every(Number.isFinite) ? nums : null;
  const switchTo = (to: "图" | "文字") => {
    if (to === "图" && q) { const t = toks.find((x) => x.quoted)!; put(code.slice(0, t.from) + `图 ${p.names.templates[0] ?? "图名"}@${t.at ?? full}` + code.slice(t.to)); }
    if (to === "文字" && im) { const i = toks.findIndex((x) => !x.quoted && x.text === "图"); const n = toks[i + 1]; put(code.slice(0, toks[i].from) + `"文字"@${n.at ?? full}` + code.slice(im.threshold ? im.thTo : n.to)); }
  };
  if (!simple) return <Cond label={tap ? "点什么" : "条件"} code={code} put={put} p={p} />;
  return <>
    <div className={c.fl}><label>{tap ? "点什么" : "看什么"}</label>
      <div className={c.segs} role="group" aria-label="点什么">
        <button type="button" aria-pressed={!!im} disabled={p.readOnly} onClick={() => switchTo("图")}>图</button>
        <button type="button" aria-pressed={!!q} disabled={p.readOnly} onClick={() => switchTo("文字")}>文字</button>
      </div></div>
    {im && <div className={c.fl}><label>图</label>
      <div className={c.field}><span className={c.tplBig}>{im.name && <img src={dev.templateImage(p.game, im.name)} alt="" onError={(e) => { e.currentTarget.style.display = "none"; }} />}</span>
        <b style={{ flex: 1, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis" }}>{im.name}</b>
        <button type="button" className={c.link} disabled={p.readOnly || !p.names.picker} onClick={() => setPicking(picking === "image" ? null : "image")}>换</button></div>
      {picking === "image" && p.names.picker && <div className={`${ps.shell} ${c.pickIn}`} data-panel>
        <TemplatePicker at={{ line: p.stmt.line, name: im.name, region: box, threshold: im.threshold }} host={p.names.picker} onClose={() => setPicking(null)}
          onChoose={(name, r) => { let next = setImage(code, name); if (r) next = regionOf(next) ? setRegion(next, atText(r)) : next; put(next); setPicking(null); }}
          onRegion={(r) => { put(setRegion(code, atText(r))); setPicking(null); }} /></div>}
    </div>}
    {q && <TextField label="文字" value={q.value} p={p} onCommit={(x) => put(setQuoted(code, x || "文字"))} />}
    <div className={c.fl}><div className={c.lbl}>在哪找<button type="button" className={c.link} disabled={p.readOnly} onClick={() => setPicking(picking === "region" ? null : "region")}>在画面上框</button></div>
      <Where box={box} game={p.game} reference={p.reference} />
      <code className={c.mono}>@{region?.value ?? "—"}</code>
      {picking === "region" && <div className={`${ps.shell} ${c.pickIn}`} data-panel>
        <ScreenPick autoFocus point={false} value={box} title={`第 ${p.stmt.line} 行 · 区域`} onCancel={() => setPicking(null)}
          onDone={(v) => { put(region ? setRegion(code, atText(v)) : addRegion(code, atText(v))); setPicking(null); }} /></div>}
    </div>
    {im && <Threshold value={im.threshold} onChange={(v) => put(setThreshold(code, v))} readOnly={p.readOnly} />}
  </>;
}

function Threshold({ value, onChange, readOnly }: { value: string | null; onChange: (v: string | null) => void; readOnly: boolean }) {
  const n = value ? Number(value) : 0.85;
  return <div className={c.fl}><label>像到多少算看到 <span style={{ marginLeft: "auto", color: "var(--color-ink)" }}>{n.toFixed(2)}{value ? "" : "（默认）"}</span></label>
    <input type="range" min={0.5} max={1} step={0.01} value={n} disabled={readOnly} aria-label="像到多少算看到" onChange={(e) => onChange(Number(e.target.value).toFixed(2))} style={{ accentColor: "var(--color-primary)" }} />
  </div>;
}

/** [code] with `@region` written right after what it looks for (the quoted text, or the picture's name), when it had none. */
function addRegion(code: string, value: string): string {
  const toks = tokens(code);
  const i = toks.findIndex((t) => !t.quoted && t.at === null && t.text === "图");
  const t = i >= 0 ? toks[i + 1] : toks.find((x) => x.quoted);
  return t && t.at === null ? code.slice(0, t.to) + "@" + value + code.slice(t.to) : code;
}

/** The newest picture with the region on it. */
function Where({ box, game, reference }: { box: number[] | null; game: string; reference: Size }) {
  const [sample, setSample] = useState<Sample | null | undefined>(undefined);
  useEffect(() => { let live = true; newestSample(game).then((x) => { if (live) setSample(x); }, () => { if (live) setSample(null); }); return () => { live = false; }; }, [game]);
  if (!sample) return <div className={c.screen} style={{ height: 80, display: "grid", placeItems: "center" }}><span style={{ position: "static", color: "var(--color-faint)", textShadow: "none" }}>{sample === null ? "没有画面" : "…"}</span></div>;
  const r = box ? toPicture(box, [sample.width, sample.height], reference) : null;
  return <div className={c.screen}><img src={dev.sampleImage(sample.id)} alt="最近画面" />
    {r && <i style={{ left: `${r[0] / sample.width * 100}%`, top: `${r[1] / sample.height * 100}%`, width: `${r[2] / sample.width * 100}%`, height: `${r[3] / sample.height * 100}%` }} />}
    <span>最近画面 · {new Date(sample.createdAt).toTimeString().slice(0, 5)}</span></div>;
}

/** A condition as written: for what the simple fields do not cover (色, 页, 且, 或 …). */
function Cond({ label, code, put, p }: { label: string; code: string; put: (x: string) => void; p: DrawerProps }) {
  const toks = tokens(code);
  const head = toks[0];
  const lims = ["秒", "次"].map((u) => limitOf(code, u)).filter(Boolean);
  const end = lims.length ? Math.min(...lims.map((l) => l!.from)) : code.length;
  const cond = code.slice(head ? head.to : 0, end).trim();
  return <TextField label={label} value={cond} p={p} mono onCommit={(x) => put(`${code.slice(0, head ? head.to : 0)} ${x}${end < code.length ? " " + code.slice(end).trim() : ""}`.replace(/\s+$/, ""))}
    hint="条件用「且」连；文字写在引号里，后面跟 @区域" />;
}

/** 没看到时: go on below, or do something else first (a 否则 block). */
function Else({ s, p }: { s: Stmt; p: DrawerProps }) {
  const [yes, no] = YES_NO[s.kind]!;
  return <div className={c.fl}><label>{no}时</label>
    <span className={c.hint}>{s.else ? `另做 ${s.else.children.length} 句，再往下走` : `直接往下走（「${yes}」那一支做完也往下走）`}</span>
    <div className={c.row}>
      <button type="button" className={c.btn} disabled={p.readOnly} onClick={() => p.onAdd({ kind: "first", parent: s.line, branch: "else" })}>＋ {no}时做什么</button>
      {s.else && <button type="button" className={c.btn} disabled={p.readOnly} onClick={() => p.edit({ kind: "remove", line: s.else!.line })}>去掉这一支</button>}
    </div></div>;
}

/** A number in a place a setting may be read (`最多 {x}秒`): fixed, or 读配置项. */
function NumberSlot({ label, unit, code, put, word, p, optional }: { label: string; unit: string; code: string; put: (x: string) => void; word: string; p: DrawerProps; optional?: boolean }) {
  const l = limitOf(code, unit);
  const slot = slotOf(word === "如果有" ? "等" : word, unit);
  return <NumberField label={label} value={l?.value ?? ""} unit={unit} slot={unit === "步" ? null : slot} p={p} optional={optional}
    onChange={(v) => put(setLimit(code, unit, v))} />;
}

function NumberField({ label, value, unit, slot, p, onChange, optional, hint }: { label: string; value: string; unit: string; slot: Slot | null; p: DrawerProps;
  onChange: (v: string | null) => void; optional?: boolean; hint?: string }) {
  const reads = value.startsWith("{");
  const ref = reads ? /^\{([^{}|]+)(?:\|([^{}]*))?\}$/.exec(value) : null;
  const [creating, setCreating] = useState(false);
  const canRead = !!slot && !!p.taskId;
  const numbers = p.fields.filter(readsAsNumber);
  const n = reads || value === "" ? null : Number(value);
  const step = slot?.integer || unit === "步" ? 1 : n !== null && !Number.isInteger(n) ? 0.5 : 1;
  const bump = (d: number) => { const base = n ?? (slot?.integer ? 1 : 1); const next = Math.max(slot?.integer ? 1 : step, Math.round((base + d) * 10) / 10); onChange(String(next)); };
  const [typed, setTyped] = useState(value);
  useEffect(() => setTyped(value), [value]);
  useCommitOnLeave(!p.readOnly && typed !== value && typed.trim() !== "", () => onChange(typed.trim()));
  const choose = (id: string) => {
    const f = p.fields.find((x) => String(x.id) === id);
    const fit = f && slot ? braceFit(f, slot) : null;
    onChange(`{${id}${fit?.needDefault ? `|${fit.needDefault}` : ""}}`);
  };
  return <div className={c.fl}><label>{label}</label>
    {canRead && <div className={c.segs} role="group" aria-label={`${label}：固定或读配置项`}>
      <button type="button" aria-pressed={!reads} disabled={p.readOnly} onClick={() => reads && onChange(ref?.[2] || String(spanOf(p.fields.find((x) => String(x.id) === ref?.[1]) ?? {})?.[0] ?? (unit === "次" ? 3 : 2)))}>固定</button>
      <button type="button" aria-pressed={reads} disabled={p.readOnly} onClick={() => { if (!reads) { const first = numbers.find((f) => braceFit(f, slot).ok); if (first) choose(String(first.id)); else setCreating(true); } }}>读配置项</button>
      {optional && <button type="button" aria-pressed={value === ""} disabled={p.readOnly} onClick={() => onChange(null)}>不写</button>}
    </div>}
    {!reads && (value !== "" || !optional) && <div className={c.row}>
      <span className={c.stepper}>
        <button type="button" aria-label="减" disabled={p.readOnly} onClick={() => bump(-step)}>−</button>
        <input value={typed} inputMode="decimal" aria-label={label} readOnly={p.readOnly} onChange={(e) => setTyped(e.target.value)}
          onBlur={() => { if (typed !== value) onChange(typed.trim() === "" ? (optional ? null : value) : typed.trim()); }} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
        <span className={c.unit}>{unit}</span>
        <button type="button" aria-label="加" disabled={p.readOnly} onClick={() => bump(step)}>+</button>
      </span>
      {optional && !canRead && value !== "" && <button type="button" className={c.link} disabled={p.readOnly} onClick={() => onChange(null)}>不写</button>}
    </div>}
    {!reads && value === "" && optional && <span className={c.hint}>{canRead ? "不写：用引擎的默认" : <button type="button" className={c.link} disabled={p.readOnly} onClick={() => onChange(unit === "次" ? "3" : "5")}>＋ 写上</button>}</span>}
    {reads && ref && <>
      <div className={c.row}>
        <select className={c.select} style={{ flex: 1 }} value={ref[1]} disabled={p.readOnly} aria-label="读哪个配置项" onChange={(e) => e.target.value === "__new" ? setCreating(true) : choose(e.target.value)}>
          {!numbers.some((f) => String(f.id) === ref[1]) && <option value={ref[1]}>{ref[1]}（找不到）</option>}
          {numbers.map((f) => { const fit = slot ? braceFit(f, slot) : { ok: true, short: "" }; const sp = spanOf(f);
            return <option key={String(f.id)} value={String(f.id)} disabled={!fit.ok}>{str(f.label) ?? String(f.id)}{sp ? ` · ${sp[0]}–${sp[1]}${str(f.unit) ? ` ${str(f.unit)}` : ""}` : ""}{fit.ok ? "" : `（${fit.short}）`}</option>; })}
          <option value="__new">＋ 新建配置项</option>
        </select>
      </div>
      <span className={c.hint}>玩家在任务参数里设；试跑用测试值 {p.ctx.test(ref[1]) ?? "—"}{ref[2] ? ` · 没设时 ${ref[2]}` : ""}</span>
    </>}
    {hint && <span className={c.hint}>{hint}</span>}
    {creating && p.taskId && <NewConfigDialog taskId={p.taskId} stepId={p.stepId} kinds={["number"]} place={`第 ${p.stmt.line} 行 · ${label}`}
      preset={{ label: "", widget: "NUMBER", recommended: n ?? undefined, ...numberPreset(slot, n, unit) }}
      onDone={(id) => { setCreating(false); if (id) onChange(`{${id}}`); }} />}
  </div>;
}

/** 分情况: each case's name and condition, one more, one fewer. */
function Cases({ s, p, full }: { s: Stmt; p: DrawerProps; full: string }) {
  return <div className={c.fl}><label>情况（每种一条支路）</label>
    {s.children.map((k) => <div key={k.line} className={c.caseRow}>
      <span className={c.mono} style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={k.text}>{k.word} <span className={c.muted}>{k.children.length} 句</span></span>
      <button type="button" className={c.link} onClick={() => p.onScript(k.line)}>改</button>
      <button type="button" className={c.link} disabled={p.readOnly || s.children.length < 2} onClick={() => p.edit({ kind: "remove", line: k.line })}>删</button>
    </div>)}
    <button type="button" className={c.btn} disabled={p.readOnly} onClick={() => p.edit({ kind: "insert", place: s.children.length ? { kind: "after", line: s.children[s.children.length - 1].line } : { kind: "first", parent: s.line, branch: "children" }, lines: [`情况${s.children.length + 1} "文字"@${full}`] })}>＋ 加一种情况</button>
  </div>;
}

/** 按配置项分: which setting, and a branch per value (missing ones offered). */
function SettingCases({ s, p, code, put }: { s: Stmt; p: DrawerProps; code: string; put: (x: string) => void }) {
  const fid = argOf(code)?.value ?? "";
  const f = p.fields.find((x) => String(x.id) === fid);
  const choices = p.fields.filter((x) => x.widget === "SWITCH" || ((x.widget === "SINGLE_CHOICE" || x.widget === "MULTI_CHOICE") && objs(x.options).length));
  const vals = f ? valuesOf(f) : [];
  const written = s.children.map((k) => k.word.replace(/^["“]|["”]$/g, ""));
  const missing = vals.filter((v) => !written.includes(v.word));
  const other = written.includes("其他");
  const [creating, setCreating] = useState(false);
  // A value goes next to the values (before 其他 / 没有值, which catch the rest); 其他 goes last.
  const addValue = (w: string) => {
    const before = w === "其他" ? s.children : s.children.filter((k) => !/^(其他|没有值)$/.test(k.word));
    const last = before.at(-1);
    p.edit({ kind: "insert", place: last ? { kind: "after", line: last.line } : { kind: "first", parent: s.line, branch: "children" }, lines: [w] });
  };
  return <>
    <div className={c.fl}><label>按哪个配置项分</label>
      <select className={c.select} value={fid} disabled={p.readOnly} onChange={(e) => e.target.value === "__new" ? setCreating(true) : put(setArg(code, e.target.value))}>
        {!f && <option value={fid}>{fid}（找不到）</option>}
        {choices.map((x) => <option key={String(x.id)} value={String(x.id)}>{str(x.label) ?? String(x.id)}</option>)}
        {p.taskId && <option value="__new">＋ 新建配置项</option>}
      </select></div>
    <div className={c.fl}><label>情况</label>
      {s.children.map((k) => { const v = vals.find((x) => x.word === k.word.replace(/^["“]|["”]$/g, ""));
        return <div key={k.line} className={c.caseRow}>
          <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}><b className={c.mono}>{k.word}</b>{v && v.label !== v.word ? <span className={c.muted}> · {v.label}</span> : null}
            <span className={c.muted}> · {k.children.length ? `${k.children.length} 句` : "空"}</span></span>
          <button type="button" className={c.link} disabled={p.readOnly} onClick={() => p.onAdd({ kind: "first", parent: k.line, branch: "children" })}>接一句</button>
          <button type="button" className={c.link} disabled={p.readOnly || s.children.length < 2} onClick={() => p.edit({ kind: "remove", line: k.line })}>删</button>
        </div>; })}
      {missing.length > 0 && !other && <div className={c.warn}>提醒 · {missing.map((m) => `「${m.label}」`).join("")} 没写分支，选它时什么也不做</div>}
      {missing.length > 0 && <div className={c.row}>{missing.slice(0, 6).map((m) => <button key={m.word} type="button" className={c.btn} disabled={p.readOnly} onClick={() => addValue(/[\s@#"]/.test(m.word) ? `"${m.word}"` : m.word)}>＋ {m.label}</button>)}</div>}
      {!other && <button type="button" className={c.btn} disabled={p.readOnly} onClick={() => addValue("其他")}>＋ 其他（可空）</button>}
      <span className={c.hint}>每种情况在画板上是一条支路</span>
    </div>
    {creating && p.taskId && <NewConfigDialog taskId={p.taskId} stepId={p.stepId} kinds={["switch", "choice"]} place={`第 ${s.line} 行 · 按配置项分`} preset={{ widget: "SINGLE_CHOICE" }}
      onDone={(id) => { setCreating(false); if (id) put(setArg(code, id)); }} />}
  </>;
}
