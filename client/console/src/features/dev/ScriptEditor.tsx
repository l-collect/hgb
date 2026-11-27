import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { autocompletion, closeCompletion, type Completion, type CompletionContext } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { HighlightStyle, StreamLanguage, indentUnit, syntaxHighlighting } from "@codemirror/language";
import { lintGutter, setDiagnostics, type Diagnostic } from "@codemirror/lint";
import { EditorState, Prec, RangeSet, StateEffect, StateField, Transaction, type Range } from "@codemirror/state";
import { Decoration, EditorView, GutterMarker, WidgetType, closeHoverTooltips, gutter, highlightActiveLine, hoverTooltip, keymap, lineNumbers, type DecorationSet } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { Stepper, Switch, join } from "../../components/ui";
import { href as hrefOf, match, navigate, usePath } from "../../router";
import type { Json, Obj } from "./api";
import { DevContext } from "./context";
import { objs, str, tasks } from "./model";
import { inQuote, readsOf, slotOf, slotWhileTyping, stripComment, type SettingView, type Slot } from "./settingUse";
import { ConfigForm } from "./config/ConfigForm";
import { NewConfigDialog, type ConfigPreset } from "./config/NewConfigDialog";
import { fallbackValue, idProblem, isNumeric, labelForRole, numberPreset, rangeText, typeName, typeOf, valueText } from "./config/fields";
import { useFieldOps } from "./config/ops";
import { useTestValues } from "./config/testValues";
import { fieldUses, usesCount, usesText, withEdits } from "./config/uses";
import k from "./config/config.module.css";
import w2 from "./Wb.module.css";
import { atText } from "./coords";
import { ScreenPick } from "./ScreenPick";
import { TemplatePicker, type PickerHost } from "./TemplatePicker";
import ps from "./Picker.module.css";

/**
 * What the cursor is on that a picture answers: a `图 name@region` (选图), any other `@x,y[,w,h]` (在画面上选), or a
 * bare `@` where 在画面上框一个 was asked for. Offsets are the document's.
 */
type Spot =
  | { kind: "image"; key: string; line: number; anchor: number; nameFrom: number; nameTo: number; name: string; regionFrom: number | null; regionTo: number | null; region: number[] | null; threshold: string | null }
  | { kind: "at"; key: string; line: number; anchor: number; from: number; to: number; values: number[]; point: boolean; comma: string }
  | { kind: "insert"; key: string; line: number; anchor: number; point: boolean };
const NUMS = /@(-?\d+)([,，])\s*(-?\d+)(?:[,，]\s*(\d+)[,，]\s*(\d+))?/g;
/** The spot at [pos] of [state], when there is one (the 图 part only with [images]). */
function spotAt(state: EditorState, pos: number, images: boolean): Spot | null {
  const line = state.doc.lineAt(pos);
  const text = stripComment(line.text);
  const at = pos - line.from;
  if (at > text.length) return null;
  if (images) for (const m of text.matchAll(/图\s+([^\s@]*)(?:@(\S*))?/g)) {
    // Only a 图 of its own: not inside quoted text (「等 "藏宝图 已领取"」), and after the line's start, a space or a statement word.
    if (inQuote(text, m.index!)) continue;
    const lead = text.slice(0, m.index);
    if (lead && !/\s$/.test(lead) && !LEADING.has(lead.trim())) continue;
    const nameFrom = m.index! + /^图\s+/.exec(m[0])![0].length;
    const nameTo = nameFrom + m[1].length;
    const regionFrom = m[2] !== undefined ? nameTo + 1 : null, regionTo = regionFrom !== null ? regionFrom + m[2].length : null;
    if (at < nameFrom || at > (regionTo ?? nameTo)) continue;
    const nums = m[2]?.split(/[,，]/).map(Number);
    const after = text.slice(regionTo ?? nameTo);
    const threshold = /^\s+(0?\.\d+|1(?:\.0+)?)(?=\s|$)/.exec(after)?.[1] ?? null;
    return { kind: "image", key: `image:${line.number}:${m.index}`, line: line.number, anchor: line.from + nameFrom, nameFrom: line.from + nameFrom, nameTo: line.from + nameTo, name: m[1],
      regionFrom: regionFrom === null ? null : line.from + regionFrom, regionTo: regionTo === null ? null : line.from + regionTo,
      region: nums && nums.length === 4 && nums.every((n) => Number.isFinite(n)) ? nums : null, threshold };
  }
  for (const m of text.matchAll(NUMS)) {
    const from = m.index!, to = from + m[0].length;
    if (at < from || at > to) continue;
    const values = [m[1], m[3], m[4], m[5]].filter((x) => x !== undefined).map(Number);
    return { kind: "at", key: `at:${line.number}:${from}`, line: line.number, anchor: line.from + from, from: line.from + from, to: line.from + to, values, point: values.length === 2, comma: m[2] };
  }
  return null;
}
/** Whether an `@` written at [before] (the line up to it) is a point: right after 点, or a colour set's place. */
const pointBefore = (before: string) => /^\s*(点|点空白)\s*$/.test(before) || /色\s+\S+$/.test(before);

/** Words a line starts with (docs/design/task-script.md), with what each does, for completion. */
export const STATEMENTS: [string, string][] = [
  ["去", "按页面图最短路线去该页面"], ["等", "等到画面有这些"], ["点", "等它出现，找到，点它"], ["点空白", "点目标旁的空白处"], ["分情况", "等到其中一种，走那一支"],
  ["如果看到", "只有一个条件时"], ["如果没看到", "画面没有这个条件时"], ["如果有", "刚等到的画面上有没有（不再等）"], ["如果红点", "刚等到的画面上有没有红点"], ["如果颜色", "某块区域有多少这种颜色"], ["否则", "如果…不成立时"], ["按设置", "按这次的设置走"],
  ["拖", "从目标旁拖到另一处"], ["扫描网格", "一帧批量扫描 M×N 网格或列表"], ["逐个", "对每个值做一遍，{名} 换成值"], ["直到", "反复做，直到看到"], ["反复", "最多 N 次，用“跳出”提前结束"], ["跳出", "结束所在的“反复”"], ["清零", "清零某处的点击次数"], ["上报", "上报事件，让服务端排后续任务"], ["启动游戏", "启动并等游戏到前台"], ["用", "调用片段"], ["结果", "写一句结果"], ["停下", "写明原因停下"], ["长等待", "放宽本步无进展看门狗秒数"], ["等待", "干等几秒"],
];
const LEADING = new Set(STATEMENTS.map(([w]) => w));
const MODIFIERS = new Set(["且", "或", "没有", "没看到", "图", "色", "容差", "页", "偏", "大小", "步进", "格大小", "点偏", "锚", "命中格", "最多", "计", "最上", "最下", "最左", "最右", "整行", "空白", "开", "关", "其他", "没有值"]);

/** Colors each part of a line: its statement word, quoted text, @region, numbers, comments, and a case's name. */
const scriptLanguage = StreamLanguage.define<{ first: boolean; setting: boolean }>({
  startState: () => ({ first: true, setting: false }),
  token(stream, state) {
    if (stream.sol()) { state.first = true; state.setting = false; }
    if (stream.eatSpace()) return null;
    // A setting read: the name after 按设置, and {名} where a number goes.
    if (stream.match(/^\{[^{}\s]+\}/)) { state.first = false; return "propertyName"; }
    if (stream.peek() === "#") { stream.skipToEnd(); return "comment"; }
    const ch = stream.next()!;
    if (ch === "\"" || ch === "“") {
      const close = ch === "\"" ? "\"" : "”";
      while (!stream.eol() && stream.next() !== close) { /* to the closing quote */ }
      state.first = false; return "string";
    }
    if (ch === "@") { stream.eatWhile(/[^\s]/); return "atom"; }
    if (/[-0-9]/.test(ch) && /^-?[0-9]/.test(ch + (stream.peek() ?? ""))) {
      stream.eatWhile(/[0-9.,，秒次步-]/);
      // A colour point keeps its #: 1842,262#C83A2E
      stream.match(/^#[0-9A-Fa-f]{6}(?=\s|$)/);
      state.first = false; return "number";
    }
    stream.eatWhile(/[^\s@"“#]/);
    const word = stream.current();
    const wasFirst = state.first; state.first = false;
    if (state.setting) { state.setting = false; return "propertyName"; }
    if (wasFirst && word === "按设置") { state.setting = true; return "keyword"; }
    if (wasFirst && LEADING.has(word)) return "keyword";
    if (MODIFIERS.has(word)) return "operator";
    // The first word of a line that is no statement names a case (under 分情况) or a value (under 按设置).
    return wasFirst ? "labelName" : "variableName";
  },
});

// Colours come from the page (Workspace.module.css .script): dark mode has its own, lighter ones.
const highlight = HighlightStyle.define([
  { tag: tags.keyword, color: "var(--hl-keyword)", fontWeight: "600" },
  { tag: tags.string, color: "var(--hl-string)" },
  { tag: tags.atom, color: "var(--hl-region)" },
  { tag: tags.number, color: "var(--hl-number)" },
  { tag: tags.comment, color: "var(--hl-comment)", fontStyle: "italic" },
  { tag: tags.operator, color: "var(--hl-operator)" },
  { tag: tags.labelName, color: "var(--hl-label)", fontWeight: "600" },
  // A setting read ({x}, the name after 按设置): the 配置项 purple, as a small tag (the border comes from cfgField).
  { tag: tags.propertyName, color: "var(--color-nav-current)", fontWeight: "600", background: "var(--color-primary-soft)", borderRadius: "3px" },
]);

/** A setting offered after `{`: [bad] says why it does not suit this place (shown greyed), [needDefault] the `{x|n}` it needs. */
export interface BraceOption { id: string; label: string; detail: string; bad?: string; needDefault?: string | null }
/** A value line offered under `按设置 x`: what to write, and what the player sees. */
export interface ValueOption { word: string; label: string }
export interface ScriptNames { templates: string[]; regions: string[]; snippets: string[]; fields: string[]; pages: string[];
  /** Settings offered after `{`, judged for the line's statement ([head]) and what follows the cursor ([after]). */
  braces?: (head: string, after: string) => BraceOption[];
  /** The value lines a `按设置 x` can have; null when x is no setting. */
  values?: (field: string) => ValueOption[] | null;
  /** 选图's library and picture; given, the cursor on `图 …` opens it (and the template list yields to it). */
  picker?: PickerHost | null;
  /** Set by the editor: opens 在画面上框一个 for an `@` just typed at [at]. */
  onPick?: (at: number, point: boolean) => void;
  /** Set by the editor in a task's step: opens 新建配置项 from a completion (after `{`, or after `按设置 `). */
  newConfig?: (req: NewRequest) => void }
/** A problem on a line, as a wavy underline; [col]/[len] narrow it to part of the line. */
export interface ScriptProblem { line: number; reason: string; severity?: "error" | "warning"; col?: number; len?: number }

/** How a line went in the trial shown: ran, or stopped there. */
export type LineMark = { line: number; tone: "ok" | "bad" };
/** Where the trial stopped, said under that line. */
export type LineFailure = { line: number; text: string };
/** What hovering a template name shows. */
export type TemplateView = { src: string; meta: string };

class Dot extends GutterMarker {
  constructor(readonly tone: LineMark["tone"]) { super(); }
  eq(other: Dot) { return other.tone === this.tone; }
  toDOM() { const d = document.createElement("span"); d.className = `cm-run-dot cm-run-${this.tone}`; return d; }
}
class Why extends WidgetType {
  constructor(readonly text: string) { super(); }
  eq(other: Why) { return other.text === this.text; }
  toDOM() { const d = document.createElement("div"); d.className = "cm-run-why"; d.textContent = this.text; return d; }
}
const setRun = StateEffect.define<{ marks: LineMark[]; failure: LineFailure | null }>();
/** The trial's marks in the gutter, and its failure as a red line with the reason under it; kept in place while typing. */
const runField = StateField.define<{ dots: RangeSet<GutterMarker>; deco: DecorationSet }>({
  create: () => ({ dots: RangeSet.empty, deco: Decoration.none }),
  update(value, tr) {
    let { dots, deco } = value;
    if (tr.docChanged) { dots = dots.map(tr.changes); deco = deco.map(tr.changes); }
    for (const e of tr.effects) if (e.is(setRun)) {
      const doc = tr.state.doc;
      const inDoc = (n: number) => n >= 1 && n <= doc.lines;
      const marks: Range<GutterMarker>[] = e.value.marks.filter((m) => inDoc(m.line)).map((m) => new Dot(m.tone).range(doc.line(m.line).from));
      dots = RangeSet.of(marks, true);
      const f = e.value.failure;
      deco = f && inDoc(f.line) ? Decoration.set([
        Decoration.line({ class: "cm-run-failed" }).range(doc.line(f.line).from),
        Decoration.widget({ widget: new Why(f.text), block: true, side: 1 }).range(doc.line(f.line).to),
      ]) : Decoration.none;
    }
    return { dots, deco };
  },
  provide: (f) => EditorView.decorations.from(f, (v) => v.deco),
});
const runGutter = gutter({ class: "cm-run-gutter", markers: (view) => view.state.field(runField).dots });

/** A template's picture when the pointer rests on its name after 图. */
function templateHover(look: () => ((name: string) => TemplateView | null)) {
  return hoverTooltip((view, pos) => {
    const line = view.state.doc.lineAt(pos);
    for (const m of line.text.matchAll(/图\s+([^\s@]+)/g)) {
      const from = line.from + m.index! + m[0].length - m[1].length, to = from + m[1].length;
      if (pos < from || pos > to) continue;
      const shown = look()(m[1]); if (!shown) return null;
      return { pos: from, end: to, above: true, create: () => {
        const dom = document.createElement("div"); dom.className = "cm-template-tip";
        const img = document.createElement("img"); img.src = shown.src; img.alt = m[1];
        const text = document.createElement("div"); text.append(Object.assign(document.createElement("b"), { textContent: m[1] }), Object.assign(document.createElement("span"), { textContent: shown.meta }));
        dom.append(img, text); return { dom };
      } };
    }
    return null;
  });
}

/** What the editor knows of the task's settings, read when it draws: none in a snippet (it reads no {x}). */
interface CfgLook {
  on: boolean;
  field: (id: string) => Obj | undefined;
  /** The test value a trial runs with. */
  value: (id: string) => Json | undefined;
  /** How many lines of the task read it, and where. */
  uses: (id: string) => { count: number; countText: string; text: string };
  /** 💡 / ⌥↵ on a number, 改测试值 / 改配置项 / 全部改名 on a card. */
  act: (what: "number" | "test" | "form" | "rename", id: string, pos: number) => void;
}

/** A setting's card when the pointer rests on the name after 按设置 or inside {名}: what it is, its test value, where it is read, and what to do with it. */
function settingHover(look: () => ((id: string) => SettingView | null), cfg: () => CfgLook) {
  return hoverTooltip((view, pos) => {
    const line = view.state.doc.lineAt(pos);
    const at = pos - line.from;
    const found = [...line.text.matchAll(/^(\s*按设置\s+)(\S+)/g)].map((m) => ({ id: m[2], from: m[1].length }))
      .concat([...line.text.matchAll(/\{\s*([^{}|\s]+)[^{}]*\}/g)].map((m) => ({ id: m[1], from: m.index! + m[0].indexOf(m[1], 1) })))
      .find((x) => at >= x.from && at <= x.from + x.id.length);
    if (!found) return null;
    const shown = look()(found.id);
    const c = cfg(); const f = c.on ? c.field(found.id) : undefined;
    if (!shown && !f) return null;
    const start = line.from + found.from;
    return { pos: start, end: start + found.id.length, above: true, create: () => {
      const dom = document.createElement("div"); dom.className = "cm-setting-tip";
      const el = (tag: string, text: string, cls?: string) => Object.assign(document.createElement(tag), { textContent: text, className: cls ?? "" });
      const head = el("div", "", "cm-setting-head");
      if (f) head.append(el("span", typeOf(f.widget)?.glyph ?? "#", "cm-cfg-glyph"));
      head.append(el("b", shown?.label ?? str(f?.label) ?? found.id), el("code", found.id, "cm-setting-muted"));
      dom.append(head);
      if (f) {
        const fallback = fallbackValue(f);
        const test = c.value(found.id);
        dom.append(el("div", [typeName(f.widget), isNumeric(f.widget) ? rangeText(f) : shown?.values ?? "", `默认 ${valueText(f, fallback)}`, `测试值 ${valueText(f, test)}`].filter(Boolean).join(" · "), "cm-setting-muted"));
        const u = c.uses(found.id);
        dom.append(el("div", u.count ? `用在 ${u.countText}：${u.text}` : "还没有脚本读它", "cm-setting-muted"));
        const row = el("div", "", "cm-cfg-actions");
        const button = (text: string, what: "test" | "form" | "rename") => {
          const b = el("button", text) as HTMLButtonElement; b.type = "button";
          b.addEventListener("mousedown", (e) => e.preventDefault());
          b.addEventListener("click", () => { view.dispatch({ effects: closeHoverTooltips }); cfg().act(what, found.id, start); });
          row.append(b);
        };
        button("改测试值", "test"); button("改配置项 ›", "form"); button("全部改名", "rename");
        dom.append(row);
      } else if (shown) {
        const row = (key: string, v: string) => { if (!v) return; const r = el("div", "", "cm-setting-row"); r.append(el("span", key, "cm-setting-muted"), el("span", v)); dom.append(r); };
        row("取值", shown.values); row("推荐", shown.recommended); row("归在", shown.step);
        const a = el("a", "去配置项 ›", "cm-setting-link") as HTMLAnchorElement; a.href = hrefOf(shown.href);
        a.addEventListener("click", (e) => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return; e.preventDefault(); navigate(shown.href); });
        dom.append(a);
      }
      return { dom };
    } };
  });
}

/** A number written where a setting could be read instead (反复 最多 5 次, 等待 2秒): what 💡 / ⌥↵ turns into a 配置项. */
export interface NumberSpot { from: number; to: number; text: string; n: number; unit: string; head: string; line: number; role: string; slot: Slot }
/** What 新建配置项 was opened for: a number to replace, a `{` being completed, or a `按设置 ` line to write branches under. */
export type NewRequest = { kind: "number"; spot: NumberSpot } | { kind: "brace"; from: number; to: number; head: string; after: string } | { kind: "branch"; line: number };
const FIXED_NUMBER = /(?<![\d.,，@|{}\w-])(\d+(?:\.\d+)?)(?=\s*(秒|次))/gu;
/** The fixed number at [pos], when it stands where the engine can read a setting. */
function numberAt(state: EditorState, pos: number): NumberSpot | null {
  const line = state.doc.lineAt(pos);
  const text = stripComment(line.text);
  const at = pos - line.from;
  const head = text.trim().split(/\s+/)[0] ?? "";
  if (head === "长等待") return null;
  for (const m of text.matchAll(FIXED_NUMBER)) {
    const from = m.index!, to = from + m[1].length;
    if (at < from || at > to || inQuote(text, from)) continue;
    const slot = slotOf(head, m[2]);
    if (!slot) return null;
    const role = m[2] === "秒" ? (head === "等待" ? "等待秒数" : "最多秒数") : head === "反复" ? "反复次数" : head === "直到" ? "直到次数" : "点击次数";
    return { from: line.from + from, to: line.from + to, text: m[1], n: Number(m[1]), unit: m[2], head, line: line.number, role, slot };
  }
  return null;
}

const refreshCfg = StateEffect.define<null>();
/** The test value after a line reading settings: 「= 5 测试值」. */
class TestTail extends WidgetType {
  constructor(readonly text: string) { super(); }
  eq(other: TestTail) { return other.text === this.text; }
  toDOM() { return Object.assign(document.createElement("span"), { className: "cm-cfg-tail", textContent: this.text }); }
}
/** 💡 after a fixed number that could be a setting. */
class Bulb extends WidgetType {
  /** [from] / [text]: the number it is for; another number gets a new 💡, so a click never acts on an old one. */
  constructor(readonly from: number, readonly text: string, readonly open: (from: number) => void) { super(); }
  eq(other: Bulb) { return other.from === this.from && other.text === this.text; }
  toDOM() {
    const b = Object.assign(document.createElement("button"), { type: "button", className: "cm-cfg-bulb", title: "变成配置项（⌥↵）", textContent: "💡" });
    b.setAttribute("aria-label", "变成配置项");
    b.addEventListener("mousedown", (e) => e.preventDefault());
    b.addEventListener("click", () => this.open(this.from));
    const wrap = Object.assign(document.createElement("span"), { className: "cm-cfg-bulbs" });
    wrap.append(b, Object.assign(document.createElement("span"), { className: "cm-cfg-key", textContent: "⌥↵" }));
    return wrap;
  }
  ignoreEvent() { return true; }
}
/** {x} and 按设置 x as tags, the test values after their lines, and 💡 on the number the cursor is on. */
function cfgField(look: () => CfgLook) {
  const build = (state: EditorState): DecorationSet => {
    const c = look();
    if (!c.on) return Decoration.none;
    const doc = state.doc;
    const ranges: Range<Decoration>[] = [];
    const tails = new Map<number, { id: string; v: string }[]>();
    for (const r of readsOf(doc.toString()).reads) {
      if (r.line > doc.lines) continue;
      const line = doc.line(r.line);
      const f = c.field(r.field);
      const cls = f ? "cm-cfg-tag" : "cm-cfg-tag cm-cfg-unknown";
      if (r.kind === "number") {
        const open = line.text.lastIndexOf("{", r.col), close = line.text.indexOf("}", r.col);
        if (open < 0 || close < 0) continue;
        ranges.push(Decoration.mark({ class: cls }).range(line.from + open, line.from + close + 1));
      } else ranges.push(Decoration.mark({ class: cls }).range(line.from + r.col, line.from + r.col + r.len));
      if (!f) continue;
      const v = c.value(r.field) ?? (r.kind === "number" && r.fallback !== null ? Number(r.fallback) : undefined);
      if (v === undefined || v === null) continue;
      const list = tails.get(r.line) ?? [];
      if (!list.some((x) => x.id === r.field)) list.push({ id: r.field, v: valueText(f, v) });
      tails.set(r.line, list);
    }
    for (const [n, list] of tails) ranges.push(Decoration.widget({ widget: new TestTail(list.length === 1 ? `= ${list[0].v} 测试值` : list.map((x) => `${x.id} = ${x.v}`).join(" · ")), side: 1 }).range(doc.line(n).to));
    const sel = state.selection.main;
    const spot = sel.empty ? numberAt(state, sel.head) : null;
    if (spot) {
      ranges.push(Decoration.mark({ class: "cm-cfg-num" }).range(spot.from, spot.to));
      // At the line's end, after its test values, so the line itself does not move.
      ranges.push(Decoration.widget({ widget: new Bulb(spot.from, spot.text, (from) => look().act("number", "", from)), side: 2 }).range(doc.lineAt(spot.to).to));
    }
    return Decoration.set(ranges, true);
  };
  return StateField.define<DecorationSet>({
    create: build,
    update: (value, tr) => tr.docChanged || tr.selection || tr.effects.some((e) => e.is(refreshCfg)) ? build(tr.state) : value,
    provide: (f) => EditorView.decorations.from(f),
  });
}

/** A completion with a class of its own on its row (greyed, or the ＋ 新建 one). */
type Opt = Completion & { class?: string };

/** Completes by place: statement words at a line's start, templates after 图, regions after @, snippets after 用, settings after 按设置. */
function completer(names: () => ScriptNames) {
  return (context: CompletionContext) => {
    const line = context.state.doc.lineAt(context.pos);
    const before = line.text.slice(0, context.pos - line.from);
    const list = (words: string[], type: string, from: number): { from: number; options: Completion[] } => ({ from, options: words.map((label) => ({ label, type })) });
    // Nothing in a comment.
    if (stripComment(before) !== before) return null;
    let m = /@([^\s@]*)$/.exec(before);
    if (m) {
      const at = list(names().regions, "constant", context.pos - m[1].length);
      // A place not written yet: drawn on the phone's picture instead.
      if (!m[1] && names().onPick) at.options.unshift({ label: "在画面上框一个", detail: "拉框后插入", type: "text", boost: 99,
        apply: (_v, _c, from) => names().onPick!(from, pointBefore(before.slice(0, -1).replace(/\S*$/, (w) => w.startsWith("\"") || w.startsWith("“") ? w : ""))) });
      return at;
    }
    m = /图\s+([^\s@]*)$/.exec(before);
    // With 选图, the picture panel answers here instead of the list.
    if (m && names().picker) return null;
    if (m) return list(names().templates, "variable", context.pos - m[1].length);
    m = /^\s*用\s+(\S*)$/.exec(before);
    if (m) return list(names().snippets, "function", context.pos - m[1].length);
    m = /^\s*去\s+(\S*)$/.exec(before);
    if (m) return list(names().pages, "constant", context.pos - m[1].length);
    m = /\{([^{}\s|]*)$/.exec(before);
    if (m) {
      const after = line.text.slice(context.pos - line.from);
      const closed = after.startsWith("}");
      const head = before.trim().split(/\s+/)[0] ?? "";
      const typed = m[1].toLowerCase();
      const from = context.pos - m[1].length;
      const options: Opt[] = (names().braces?.(head, after) ?? [])
        .filter((f) => !typed || f.id.toLowerCase().includes(typed) || f.label.toLowerCase().includes(typed)).map((f) => ({
        label: f.id, type: "property", class: f.bad ? "cm-option-off" : undefined,
        detail: f.bad ? `${f.detail} · ${f.bad}` : f.needDefault ? `${f.detail} · 要默认值` : f.detail,
        apply: f.needDefault ? `${f.id}|${f.needDefault}${closed ? "" : "}"}` : closed ? f.id : `${f.id}}` }));
      // Last: a new setting made for this place (its type and unit from the line), written in when saved.
      const make = names().newConfig;
      if (make) {
        const unit = /^[^{}\s]*\}?\s*(秒|次)/.exec(after)?.[1] ?? "";
        options.push({ label: "＋ 新建配置项…", type: "text", class: "cm-option-new", detail: `数字${unit ? ` · ${unit}` : ""}`,
          apply: (_v, _c, a, b) => make({ kind: "brace", from: a, to: b, head, after }) });
      }
      // Filtered here, so the new one stays last whatever is typed.
      return { from, options, filter: false };
    }
    m = /^\s*按设置\s+(\S*)$/.exec(before);
    if (m) {
      const typed = m[1].toLowerCase();
      const options: Opt[] = names().fields.filter((x) => !typed || x.toLowerCase().includes(typed)).map((label) => ({ label, type: "property" }));
      const make = names().newConfig;
      if (make) options.push({ label: "＋ 新建开关 / 单选", type: "text", class: "cm-option-new", detail: "写出分支",
        apply: () => make({ kind: "branch", line: line.number }) });
      return { from: context.pos - m[1].length, options, filter: false };
    }
    // A value line one level under 按设置 x: that setting's values, 其他 and 没有值.
    m = /^(\s+)(\S*)$/.exec(before);
    if (m) {
      const field = branchAbove(context.state.doc, line.number, m[1].length);
      const values = field ? names().values?.(field) : null;
      if (values) return { from: context.pos - m[2].length, options: [
        ...values.map((v) => ({ label: v.word, detail: v.label !== v.word ? v.label : undefined, type: "enum" })),
        { label: "其他", detail: "别的值都走这里", type: "keyword" }, { label: "没有值", detail: "没设值时", type: "keyword" }] };
    }
    m = /^\s*(\S*)$/.exec(before);
    if (m && (m[1] || context.explicit)) return { from: context.pos - m[1].length, options: STATEMENTS.map(([label, info]) => ({ label, detail: info, type: "keyword" })) };
    return null;
  };
}

/** The setting of the `按设置 x` a line of [indent] is a value line of (the nearest line above indented less); null when none. */
function branchAbove(doc: EditorState["doc"], lineNo: number, indent: number): string | null {
  for (let n = lineNo - 1; n >= 1; n--) {
    const text = stripComment(doc.line(n).text);
    if (!text.trim()) continue;
    const own = text.length - text.trimStart().length;
    if (own >= indent) continue;
    return /^\s*按设置\s+(\S+)\s*$/.exec(text)?.[1] ?? null;
  }
  return null;
}

/**
 * The script editor: [value] edited in place, [onChange] on every edit, Ctrl/⌘+S calls [onSave]. [problems] (line,
 * reason) are drawn as wavy underlines on their lines. [names] feeds completion and is read when it is asked for.
 */
export function ScriptEditor({ value, onChange, onSave, problems, names, goTo, onJumped, onCursor, marks = [], failure = null, template = () => null, setting = () => null }: { value: string; onChange: (text: string) => void; onSave: () => void;
  problems: ScriptProblem[]; names: ScriptNames; goTo: { line: number; at: number } | null;
  marks?: LineMark[]; failure?: LineFailure | null; template?: (name: string) => TemplateView | null; onJumped?: () => void;
  /** What hovering a setting's name shows; null when there is no such setting. */
  setting?: (id: string) => SettingView | null;
  /** The line the cursor is on, as it moves. */
  onCursor?: (line: number) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  // 选图 / 在画面上选: what is open, the spot closed (not opened again till the cursor leaves it), and a redraw on scroll.
  // [uid] names the panel for React: a new spot gets a fresh one (no state carried from the last @ or 图), the same spot
  // keeps it while its text moves.
  const [spot, setSpotState] = useState<(Spot & { uid: number }) | null>(null);
  const spotNow = useRef<(Spot & { uid: number }) | null>(null); spotNow.current = spot;
  const uid = useRef(0);
  const setSpot = (next: Spot | null, same = false) => {
    const open = spotNow.current;
    const keep = !!next && !!open && (same || open.key === next.key);
    const shown = next ? { ...next, uid: keep ? open!.uid : ++uid.current } : null;
    spotNow.current = shown; setSpotState(shown);
  };
  const dismissed = useRef<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [, setScrolled] = useState(0);
  const close = () => { const v = view.current; if (spotNow.current) dismissed.current = spotNow.current.key; setSpot(null); v?.focus(); };
  const closeRef = useRef(close); closeRef.current = close;
  const follow = (state: EditorState, moved: boolean, mapped: number | null) => {
    if (moved) setNotice(null);
    const found = spotAt(state, state.selection.main.head, !!latest.current.names.picker);
    const open = spotNow.current;
    if (found) {
      // A spot closed before stays closed, and the panel of another spot does not stay open over it.
      if (dismissed.current === found.key) { if (open && open.key !== found.key) setSpot(null); return; }
      if (open?.key !== found.key || !moved) { setSpot(found); if (view.current) closeCompletion(view.current); }
      return;
    }
    if (moved) dismissed.current = null;
    // Typed elsewhere: an open spot follows its text, or closes when it is gone (or another one now stands there).
    if (!open || mapped === null) return;
    if (open.kind === "insert") { setSpot({ ...open, anchor: mapped, line: state.doc.lineAt(mapped).number, key: `insert:${mapped}` }, true); return; }
    const again = spotAt(state, mapped, true);
    setSpot(again && again.kind === open.kind && again.anchor === mapped ? again : null, true);
  };
  const followRef = useRef(follow); followRef.current = follow;
  const view = useRef<EditorView | null>(null);
  const latest = useRef({ onChange, onSave, names, template, onCursor, setting });
  latest.current = { onChange, onSave, names: { ...names, onPick: (at: number, point: boolean) => {
    const v = view.current; if (!v) return;
    const line = v.state.doc.lineAt(at);
    setSpot({ kind: "insert", key: `insert:${at}`, line: line.number, anchor: at, point });
  } }, template, onCursor, setting };

  // ---- 配置项: in a task's own step, {x} are tags with their test values, a fixed number can become one, and `{` /
  // `按设置 ` offer a new one. The task and step are the page's (/dev/tasks/<task>/steps/<step>).
  const ctx = useContext(DevContext);
  const path = usePath();
  const route = match("/dev/tasks/:task/steps/:step", path) ?? match("/dev/tasks/:task", path);
  const cfgTask = ctx?.draft && route ? tasks(ctx.draft.body).find((t) => t.id === route.task) : undefined;
  const cfgStep = cfgTask ? cfgTask.steps.find((st) => st.id === route?.step) ?? cfgTask.steps[0] : undefined;
  const cfgOn = !!cfgStep && !str(cfgStep.use);
  const taskId = cfgTask?.id ?? "";
  const test = useTestValues(taskId);
  const ops = useFieldOps(taskId);
  const cfgBody = useMemo(() => ctx?.draft && cfgTask ? withEdits(ctx.draft.body, taskId, ctx.edits) : null, [ctx?.draft, ctx?.edits, taskId, !!cfgTask]); // eslint-disable-line react-hooks/exhaustive-deps
  const [newReq, setNewReq] = useState<NewRequest | null>(null);
  // A branch is written once its new setting is in the draft (it needs the options).
  const [pendingBranch, setPendingBranch] = useState<{ line: number; id: string } | null>(null);
  const [pop, setPop] = useState<{ kind: "test" | "rename"; id: string; pos: number } | null>(null);
  const [formId, setFormId] = useState<string | null>(null);
  const fieldOf = (id: string) => cfgTask?.fields.find((x) => String(x.id) === id);
  const cfg = useRef<CfgLook>(null!);
  const closePop = useRef(() => setPop(null));
  cfg.current = {
    on: cfgOn, field: fieldOf, value: (id) => test.values[id] as Json | undefined,
    uses: (id) => { const list = cfgBody ? fieldUses(cfgBody, taskId, id) : []; return { count: list.length, countText: usesCount(list), text: cfgBody ? usesText(cfgBody, taskId, list) : "" }; },
    act: (what, id, pos) => {
      const v = view.current; if (!v) return;
      if (what === "number") { const spot = numberAt(v.state, pos); if (spot) setNewReq({ kind: "number", spot }); return; }
      if (what === "form") { setFormId(id); return; }
      setPop({ kind: what, id, pos });
    },
  };
  if (cfgOn) latest.current.names.newConfig = (req) => setNewReq(req);
  const cfgKey = cfgOn ? JSON.stringify([cfgTask?.fields, test.values]) : "";
  useEffect(() => { view.current?.dispatch({ effects: refreshCfg.of(null) }); }, [cfgKey]);

  useEffect(() => {
    if (!host.current) return;
    const created = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          runField, runGutter, lineNumbers(), highlightActiveLine(), history(), lintGutter(), templateHover(() => latest.current.template), settingHover(() => latest.current.setting, () => cfg.current), cfgField(() => cfg.current),
          indentUnit.of("  "), EditorState.tabSize.of(2),
          scriptLanguage, syntaxHighlighting(highlight),
          autocompletion({ override: [completer(() => latest.current.names)], optionClass: (c) => (c as Opt).class ?? "" }),
          keymap.of([{ key: "Mod-s", preventDefault: true, run: () => { latest.current.onSave(); return true; } }, indentWithTab, ...defaultKeymap, ...historyKeymap]),
          Prec.highest(keymap.of([{ key: "Escape", run: () => { if (!spotNow.current) return false; closeRef.current(); return true; } },
            // ⌥↵ on a fixed number: make it a 配置项.
            { key: "Alt-Enter", run: (v) => { if (!cfg.current.on) return false; const spot = numberAt(v.state, v.state.selection.main.head); if (!spot) return false; cfg.current.act("number", "", spot.from); return true; } },
            // ⌥↓ goes into the open panel (it opens without taking the keyboard, so moving through lines is not caught).
            { key: "Alt-ArrowDown", run: () => { const el = wrap.current?.querySelector<HTMLElement>("[data-panel] [role=listbox], [data-panel] [role=dialog][tabindex]"); if (!el) return false; el.focus(); return true; } }])),
          EditorView.domEventHandlers({ mousedown: () => { dismissed.current = null; closePop.current(); return false; } }),
          EditorView.updateListener.of((update) => {
            if (update.selectionSet || update.docChanged) {
              const open = spotNow.current;
              followRef.current(update.state, update.selectionSet && !update.docChanged, open && update.docChanged ? update.changes.mapPos(open.anchor) : null);
            }
            if (update.geometryChanged || update.viewportChanged) setScrolled((n) => n + 1);
            if (update.docChanged) latest.current.onChange(update.state.doc.toString());
            if (update.selectionSet || update.docChanged) latest.current.onCursor?.(update.state.doc.lineAt(update.state.selection.main.head).number);
          }),
          EditorView.theme({
            "&": { height: "100%", minHeight: "320px", fontSize: "13px", background: "transparent" },
            ".cm-run-gutter": { width: "14px" },
            ".cm-run-dot": { display: "inline-block", width: "8px", height: "8px", borderRadius: "50%", marginLeft: "4px" },
            ".cm-run-ok": { background: "var(--color-ok)" },
            ".cm-run-bad": { background: "var(--color-danger)" },
            ".cm-run-failed": { background: "var(--color-danger-bg)" },
            ".cm-run-why": { margin: "2px 0 6px", padding: "6px 10px", borderRadius: "8px", background: "var(--color-danger-bg)", color: "var(--color-danger)", fontFamily: "inherit", whiteSpace: "pre-wrap", lineHeight: "20px" },
            ".cm-template-tip": { display: "flex", gap: "10px", alignItems: "center", padding: "8px", maxWidth: "320px" },
            ".cm-template-tip img": { maxWidth: "96px", maxHeight: "72px", borderRadius: "6px", background: "#2A2522", imageRendering: "pixelated" },
            ".cm-template-tip div": { display: "flex", flexDirection: "column", fontSize: "12px" },
            ".cm-setting-tip": { display: "flex", flexDirection: "column", gap: "3px", padding: "10px 12px", background: "var(--color-surface)", color: "var(--color-ink)", borderRadius: "10px", maxWidth: "360px", fontSize: "12px", lineHeight: "18px", fontFamily: "var(--font-body)" },
            ".cm-setting-head": { display: "flex", gap: "8px", alignItems: "baseline" },
            ".cm-setting-row": { display: "flex", gap: "8px" },
            ".cm-setting-row > :first-child": { flex: "none", width: "28px" },
            ".cm-setting-muted": { color: "var(--color-muted)" },
            ".cm-setting-link": { color: "var(--color-nav-current)", textDecoration: "none", marginTop: "2px" },
            ".cm-scroller": { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", lineHeight: "22px" },
            ".cm-gutters": { background: "transparent", border: "none", color: "var(--color-muted)" },
            ".cm-activeLine": { background: "color-mix(in srgb, var(--color-line) 35%, transparent)" },
            "&.cm-focused": { outline: "none" },
            // Tooltips and the completion list in the page's colours: the light base theme's #f5f5f5 left dark mode's light text unreadable.
            "& .cm-tooltip": { background: "var(--color-surface)", color: "var(--color-ink)", border: "1px solid var(--color-line)", borderRadius: "6px" },
            "& .cm-tooltip-autocomplete ul li": { color: "var(--color-ink)" },
            "& .cm-tooltip-autocomplete ul li[aria-selected]": { background: "var(--color-nav-current-bg)", color: "var(--color-nav-current)" },
            "& .cm-completionDetail": { color: "var(--color-muted)" },
            "& .cm-option-off": { opacity: ".55" },
            "& .cm-option-new": { color: "var(--color-primary)", fontWeight: "600", borderTop: "1px solid var(--color-line)" },
            ".cm-cfg-tag": { border: "1px solid var(--color-primary-line)", borderRadius: "5px", padding: "0 2px", background: "var(--color-primary-soft)", color: "var(--color-nav-current)" },
            ".cm-cfg-tag *": { background: "transparent !important", color: "inherit !important" },
            ".cm-cfg-unknown": { borderColor: "var(--color-danger-line)", background: "var(--color-danger-soft)", color: "var(--color-danger)" },
            ".cm-cfg-tail": { color: "var(--color-faint)", fontStyle: "italic", marginLeft: "14px", fontSize: "12px", fontFamily: "var(--font-body)", userSelect: "none" },
            ".cm-cfg-num": { borderBottom: "2px dotted var(--color-warn)" },
            ".cm-cfg-bulbs": { display: "inline-flex", alignItems: "center", gap: "4px", marginLeft: "6px", verticalAlign: "middle", userSelect: "none" },
            ".cm-cfg-bulb": { display: "inline-grid", placeItems: "center", width: "20px", height: "20px", padding: "0", border: "0", borderRadius: "5px", background: "var(--color-warn-bg)", color: "var(--color-warn)", fontSize: "12px", lineHeight: "20px", cursor: "pointer" },
            ".cm-cfg-bulb:hover": { boxShadow: "0 0 0 1px var(--color-warn-line)" },
            ".cm-cfg-key": { fontSize: "11px", color: "var(--color-faint)", fontFamily: "var(--font-body)" },
            ".cm-cfg-glyph": { width: "20px", height: "20px", borderRadius: "6px", background: "var(--color-primary-soft)", color: "var(--color-primary)", display: "inline-grid", placeItems: "center", fontSize: "11px", fontWeight: "700", flex: "none", alignSelf: "center" },
            ".cm-cfg-actions": { display: "flex", gap: "6px", marginTop: "6px", flexWrap: "wrap" },
            ".cm-cfg-actions button": { minHeight: "28px", padding: "0 10px", borderRadius: "7px", border: "1px solid var(--color-control)", background: "var(--color-surface)", color: "var(--color-ink)", font: "inherit", fontSize: "12px", fontWeight: "600", cursor: "pointer" },
            ".cm-cfg-actions button:hover": { background: "var(--color-bg)" },
          }),
        ],
      }),
    });
    view.current = created;
    const scrolled = () => setScrolled((n) => n + 1);
    created.scrollDOM.addEventListener("scroll", scrolled);
    return () => { created.scrollDOM.removeEventListener("scroll", scrolled); created.destroy(); view.current = null; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // A value changed from outside (a save elsewhere, a reload, a 配置项 renamed or deleted) replaces the text when it
  // differs: only the part that changed, and out of the undo history, so ⌘Z never puts back an id the 配置项 no
  // longer has (undoing a rename is done on the 配置项); edits typed before it are still undone around it.
  useEffect(() => {
    const v = view.current; if (!v) return;
    const now = v.state.doc.toString();
    if (now === value) return;
    let head = 0;
    while (head < now.length && head < value.length && now[head] === value[head]) head++;
    let tail = 0;
    while (tail < now.length - head && tail < value.length - head && now[now.length - 1 - tail] === value[value.length - 1 - tail]) tail++;
    v.dispatch({ changes: { from: head, to: now.length - tail, insert: value.slice(head, value.length - tail) }, annotations: Transaction.addToHistory.of(false) });
  }, [value]);

  useEffect(() => {
    const v = view.current; if (!v) return;
    const doc = v.state.doc;
    const diagnostics: Diagnostic[] = problems.filter((p) => p.line >= 1 && p.line <= doc.lines).map((p) => {
      const line = doc.line(p.line);
      const severity = p.severity ?? "error";
      if (p.col !== undefined && p.len && p.col + p.len <= line.length) return { from: line.from + p.col, to: line.from + p.col + p.len, severity, message: p.reason };
      const start = line.from + (line.text.length - line.text.trimStart().length);
      return { from: start, to: Math.max(start + 1, line.to), severity, message: p.reason };
    });
    v.dispatch(setDiagnostics(v.state, diagnostics));
  }, [problems]);

  useEffect(() => {
    const v = view.current; if (!v) return;
    v.dispatch({ effects: setRun.of({ marks, failure }) });
  }, [marks, failure]);

  useEffect(() => {
    const v = view.current; if (!v || !goTo || goTo.line < 1 || goTo.line > v.state.doc.lines) return;
    const line = v.state.doc.line(goTo.line);
    v.dispatch({ selection: { anchor: line.from, head: line.to }, scrollIntoView: true });
    v.focus();
    onJumped?.();
  }, [goTo]);

  /** Writes into the line the open spot is on (found again where it is now), then closes and goes back to the text. */
  const write = (make: (now: Spot) => { from: number; to: number; insert: string }[]) => {
    const v = view.current, open = spotNow.current; if (!v || !open) return;
    // 在画面上框一个 writes right after its @: when that @ is gone, nothing is written.
    if (open.kind === "insert" && (open.anchor < 1 || open.anchor > v.state.doc.length || v.state.doc.sliceString(open.anchor - 1, open.anchor) !== "@")) {
      dismissed.current = open.key; setSpot(null); setNotice("位置变了，请重新框"); v.focus(); return;
    }
    const now = open.kind === "insert" ? open : spotAt(v.state, open.anchor, true);
    if (now) {
      const list = make(now);
      const changes = v.state.changes(list);
      // The cursor after what was written, so typing goes on from there.
      const end = list.length ? changes.mapPos(Math.max(...list.map((c) => c.to)), 1) : v.state.selection.main.head;
      v.dispatch({ changes, selection: { anchor: end } });
    }
    dismissed.current = open.key; setSpot(null); v.focus();
  };
  /** Writes the new setting [id] where 新建配置项 was opened for [req] (a number or a `{` being completed). */
  const writeNew = (req: NewRequest, id: string) => {
    const v = view.current; if (!v) return;
    const doc = v.state.doc;
    if (req.kind === "number") {
      const at = req.spot;
      if (doc.sliceString(at.from, at.to) !== at.text) { setNotice("那一行变了，没替换"); v.focus(); return; }
      v.dispatch({ changes: { from: at.from, to: at.to, insert: `{${id}}` }, selection: { anchor: at.from + id.length + 2 } });
    } else if (req.kind === "brace") {
      if (req.from < 1 || doc.sliceString(req.from - 1, req.from) !== "{") { setNotice("那一行变了，没写进去"); v.focus(); return; }
      const closed = doc.sliceString(req.to, req.to + 1) === "}";
      v.dispatch({ changes: { from: req.from, to: req.to, insert: closed ? id : `${id}}` }, selection: { anchor: req.from + id.length + 1 } });
    }
    v.focus();
  };
  /** Line [n] (a `按设置 …` being written) becomes `按设置 id` with a branch per value: 开 / 关, or each option and 其他. */
  const writeBranch = (n: number, id: string, f: Obj) => {
    const v = view.current; if (!v) return;
    const line = n <= v.state.doc.lines ? v.state.doc.line(n) : null;
    const m = line ? /^(\s*)按设置(\s|$)/.exec(line.text) : null;
    if (!line || !m) { setNotice("那一行变了，没写分支"); v.focus(); return; }
    const ind = m[1], child = `${ind}  `, grand = `${ind}    `;
    const word = (x: string) => /^\S+$/.test(x) && !["其他", "没有值"].includes(x) && !/^["“]/.test(x) ? x : `"${x.replace(/"/g, "")}"`;
    const out = [`${ind}按设置 ${id}`];
    if (f.widget === "SWITCH") out.push(`${child}开`, `${grand}# 开着时做什么`, `${child}关`, `${grand}# 关着时做什么（可空）`);
    else {
      for (const o of objs(f.options)) out.push(`${child}${word(String(o.value))}`, `${grand}# 选「${str(o.label) ?? String(o.value)}」时做什么`);
      out.push(`${child}其他`, `${grand}# 别的情况（可空）`);
    }
    v.dispatch({ changes: { from: line.from, to: line.to, insert: out.join("\n") }, selection: { anchor: line.from + out.slice(0, 3).join("\n").length } });
    v.focus();
  };
  useEffect(() => {
    if (!pendingBranch) return;
    const f = fieldOf(pendingBranch.id); if (!f) return;
    writeBranch(pendingBranch.line, pendingBranch.id, f); setPendingBranch(null);
  }, [pendingBranch, cfgTask]); // eslint-disable-line react-hooks/exhaustive-deps
  /** What 新建配置项 starts from for [req]: the type, range and default the place suggests (settingUse's slots). */
  const presetOf = (req: NewRequest): { preset: ConfigPreset; place: string; kinds?: ("number" | "switch" | "choice" | "multi" | "other")[] } => {
    if (req.kind === "number") {
      const at = req.spot;
      return { preset: { label: labelForRole(at.role), widget: "NUMBER", ...numberPreset(at.slot, at.n, at.unit === "次" && at.head === "反复" ? "轮" : at.unit), recommended: at.n },
        place: `替换第 ${at.line} 行的 ${at.text}` };
    }
    if (req.kind === "brace") {
      const unit = /^[^{}\s]*\}?\s*(秒|次)/.exec(req.after)?.[1] ?? "";
      const slot = slotWhileTyping(req.head, req.after);
      const p = numberPreset(slot, null, unit);
      const n = view.current ? view.current.state.doc.lineAt(Math.min(req.from, view.current.state.doc.length)).number : 0;
      return { preset: { widget: "NUMBER", ...p, recommended: slot?.integer ? 3 : p.minimum }, place: `第 ${n} 行的 {…}`, kinds: ["number"] };
    }
    return { preset: { widget: "SWITCH" }, place: `第 ${req.line} 行 · 写出分支`, kinds: ["switch", "choice", "multi"] };
  };
  const popAt = (() => {
    const v = view.current, box = wrap.current;
    if (!pop || !v || !box) return null;
    const c = v.coordsAtPos(Math.min(pop.pos, v.state.doc.length)); if (!c) return null;
    const r = box.getBoundingClientRect();
    return { left: Math.max(8, Math.min(c.left - r.left, r.width - 308)), top: c.bottom - r.top + 6 };
  })();
  const popField = pop ? fieldOf(pop.id) : undefined;
  const placed = (() => {
    const v = view.current, box = wrap.current;
    if (!spot || !v || !box) return null;
    const c = v.coordsAtPos(Math.min(spot.anchor, v.state.doc.length)); if (!c) return null;
    const r = box.getBoundingClientRect();
    const width = spot.kind === "image" ? 360 : 420, tall = spot.kind === "image" ? 520 : 470;
    const left = Math.max(8, Math.min(c.left - r.left, r.width - width - 8));
    const below = c.bottom - r.top + 6;
    const above = below + tall > r.height && c.top - r.top - 6 - tall >= 0;
    return { width, left, ...(above ? { bottom: r.height - (c.top - r.top) + 6 } : { top: below }) };
  })();
  return <div ref={wrap} style={{ height: "100%", position: "relative" }}>
    <div ref={host} style={{ height: "100%" }} />
    {notice && <div className={ps.notice} role="status">{notice}</div>}
    {spot && placed && <div key={spot.uid} className={ps.shell} style={placed} data-panel>
      {spot.kind === "image" && names.picker ? <TemplatePicker at={{ line: spot.line, name: spot.name, region: spot.region, threshold: spot.threshold }} host={names.picker} onClose={close}
          onChoose={(name, region) => write((now) => now.kind !== "image" ? [] : [{ from: now.nameFrom, to: now.nameTo, insert: name },
            ...(region ? [now.regionFrom !== null ? { from: now.regionFrom, to: now.regionTo!, insert: atText(region) } : { from: now.nameTo, to: now.nameTo, insert: `@${atText(region)}` }] : [])])}
          onRegion={(region) => write((now) => now.kind !== "image" ? [] : [now.regionFrom !== null ? { from: now.regionFrom, to: now.regionTo!, insert: atText(region) }
            : { from: now.nameTo, to: now.nameTo, insert: `@${atText(region)}` }])} />
        : spot.kind === "at" ? <ScreenPick point={spot.point} value={spot.values} title={`第 ${spot.line} 行 · ${spot.point ? "点位" : "区域"}`} onCancel={close}
            onDone={(vals) => write((now) => now.kind !== "at" ? [] : [{ from: now.from + 1, to: now.to, insert: atText(vals, now.comma) }])} />
        : spot.kind === "insert" ? <ScreenPick autoFocus point={spot.point} value={null} title={`第 ${spot.line} 行 · ${spot.point ? "点一个位置" : "框一个区域"}`} onCancel={close}
            onDone={(vals) => write((now) => [{ from: now.anchor, to: now.anchor, insert: atText(vals) }])} /> : null}
    </div>}
    {pop && popAt && popField && (pop.kind === "test"
      ? <TestPop style={popAt} f={popField} value={test.values[pop.id]} own={pop.id in test.own} set={(x) => test.set(pop.id, x)} onClose={() => { setPop(null); view.current?.focus(); }} />
      : <RenamePop style={popAt} f={popField} taken={(cfgTask?.fields ?? []).map((x) => String(x.id)).filter((x) => x !== pop.id)} count={cfg.current.uses(pop.id).count}
          onRename={(to) => ops.rename(pop.id, to)} onClose={() => { setPop(null); view.current?.focus(); }} />)}
    {newReq && cfgOn && (() => { const p = presetOf(newReq);
      return <NewConfigDialog taskId={taskId} stepId={cfgStep ? String(cfgStep.id) : undefined} preset={p.preset} place={p.place} kinds={p.kinds}
        onDone={(id) => { const req = newReq; setNewReq(null);
          if (!id) { view.current?.focus(); return; }
          if (req.kind === "branch") setPendingBranch({ line: req.line, id }); else writeNew(req, id); }} />; })()}
    {formId && cfgOn && <ConfigForm taskId={taskId} fieldId={formId} onClose={() => { setFormId(null); view.current?.focus(); }} />}
  </div>;
}

/** 改测试值 over the script: the setting's own control, 改回默认, 完成. */
function TestPop({ f, value, own, set, onClose, style }: { f: Obj; value: unknown; own: boolean; set: (v: unknown) => void; onClose: () => void; style: React.CSSProperties }) {
  const label = str(f.label) ?? String(f.id);
  const n = (x: unknown) => typeof x === "number" ? x : undefined;
  let control: React.ReactNode;
  if (isNumeric(f.widget)) control = <Stepper label={`${label} 测试值`} value={n(value)} min={n(f.minimum)} max={n(f.maximum)} step={n(f.step) && n(f.step)! > 0 ? n(f.step) : 1} unit={str(f.unit)} onChange={(x) => set(x)} />;
  else if (f.widget === "SWITCH") control = <Switch label={`${label} 测试值`} checked={value === true} onChange={(on) => set(on)} />;
  else if (f.widget === "SINGLE_CHOICE") control = <select className={k.select} aria-label={`${label} 测试值`} value={JSON.stringify(value ?? null)} onChange={(e) => set(JSON.parse(e.target.value))}>
    {value === undefined || value === null ? <option value="null">—</option> : null}
    {objs(f.options).map((o) => <option key={String(o.value)} value={JSON.stringify(o.value)}>{str(o.label) ?? String(o.value)}</option>)}</select>;
  else if (f.widget === "MULTI_CHOICE") { const cur = Array.isArray(value) ? value : [];
    control = <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{objs(f.options).map((o) => { const on = cur.includes(o.value);
      return <button key={String(o.value)} type="button" aria-pressed={on} className={k.seg} style={{ flex: "none", padding: "4px 10px", border: "1px solid var(--color-line)" }}
        onClick={() => set(on ? cur.filter((x) => x !== o.value) : [...cur, o.value])}>{str(o.label) ?? String(o.value)}</button>; })}</div>; }
  else control = <input className={join(k.input, k.fill)} aria-label={`${label} 测试值`} value={typeof value === "string" ? value : ""} onChange={(e) => set(e.target.value)} />;
  return <div className={k.pop} style={style} role="dialog" aria-label={`${label} 的测试值`} onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); onClose(); } }}>
    <div className={k.popHead}><b>{label}</b><code>{String(f.id)}</code><span className={k.grow} /><span className={k.hint}>测试值 · 只给试跑</span></div>
    <div className={k.fv}>{control}</div>
    <div className={k.buttons}>{own && <button type="button" className={k.link} style={{ marginRight: "auto" }} onClick={() => set(undefined)}>改回默认 {valueText(f, fallbackValue(f))}</button>}
      <button type="button" className={join(w2.btn, w2.sm)} onClick={onClose}>完成</button></div>
  </div>;
}

/** 全部改名 over the script: the new id, and every line reading the old one changes with it. */
function RenamePop({ f, taken, count, onRename, onClose, style }: { f: Obj; taken: string[]; count: number; onRename: (to: string) => Promise<string | null>; onClose: () => void; style: React.CSSProperties }) {
  const from = String(f.id);
  const [to, setTo] = useState(from);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const go = async () => {
    if (to === from) { onClose(); return; }
    const why = idProblem(to, taken); if (why) { setProblem(why); return; }
    setBusy(true); const result = await onRename(to); setBusy(false);
    if (result) setProblem(result); else onClose();
  };
  return <form className={k.pop} style={style} aria-label={`${str(f.label) ?? from} 改名`} onSubmit={(e) => { e.preventDefault(); void go(); }}
    onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); onClose(); } }}>
    <div className={k.popHead}><b>全部改名</b><code>{from}</code></div>
    <input autoFocus className={join(k.input, k.mono)} aria-label="新编号" value={to} spellCheck={false} onChange={(e) => { setTo(e.target.value.trim()); setProblem(null); }} />
    <span className={problem ? k.problem : k.hint}>{problem ?? `本任务里读它的 ${count} 处一起改；账号里已存的配置按旧编号存，会对不上`}</span>
    <div className={k.buttons}><button type="button" className={join(w2.btn, w2.sm)} onClick={onClose}>取消</button>
      <button type="submit" className={join(w2.btn, w2.sm, w2.primary)} disabled={busy}>{busy ? "改名中…" : "改名"}</button></div>
  </form>;
}
