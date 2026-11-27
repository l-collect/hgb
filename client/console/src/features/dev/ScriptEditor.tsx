import { useEffect, useRef, useState } from "react";
import { autocompletion, closeCompletion, type Completion, type CompletionContext } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { HighlightStyle, StreamLanguage, indentUnit, syntaxHighlighting } from "@codemirror/language";
import { lintGutter, setDiagnostics, type Diagnostic } from "@codemirror/lint";
import { EditorState, Prec, RangeSet, StateEffect, StateField, type Range } from "@codemirror/state";
import { Decoration, EditorView, GutterMarker, WidgetType, gutter, highlightActiveLine, hoverTooltip, keymap, lineNumbers, type DecorationSet } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { href as hrefOf, navigate } from "../../router";
import { inQuote, stripComment, type SettingView } from "./settingUse";
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
  { tag: tags.propertyName, color: "var(--hl-setting)", fontWeight: "600", background: "color-mix(in srgb, var(--hl-setting) 12%, transparent)", borderRadius: "3px" },
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
  onPick?: (at: number, point: boolean) => void }
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

/** A setting's card when the pointer rests on the name after 按设置 or inside {名}. */
function settingHover(look: () => ((id: string) => SettingView | null)) {
  return hoverTooltip((view, pos) => {
    const line = view.state.doc.lineAt(pos);
    const at = pos - line.from;
    const found = [...line.text.matchAll(/^(\s*按设置\s+)(\S+)/g)].map((m) => ({ id: m[2], from: m[1].length }))
      .concat([...line.text.matchAll(/\{\s*([^{}|\s]+)[^{}]*\}/g)].map((m) => ({ id: m[1], from: m.index! + m[0].indexOf(m[1], 1) })))
      .find((x) => at >= x.from && at <= x.from + x.id.length);
    if (!found) return null;
    const shown = look()(found.id); if (!shown) return null;
    return { pos: line.from + found.from, end: line.from + found.from + found.id.length, above: true, create: () => {
      const dom = document.createElement("div"); dom.className = "cm-setting-tip";
      const el = (tag: string, text: string, cls?: string) => Object.assign(document.createElement(tag), { textContent: text, className: cls ?? "" });
      const head = el("div", "", "cm-setting-head"); head.append(el("b", shown.label), el("span", `${shown.id} · ${shown.type}`, "cm-setting-muted"));
      dom.append(head);
      const row = (k: string, v: string) => { if (!v) return; const r = el("div", "", "cm-setting-row"); r.append(el("span", k, "cm-setting-muted"), el("span", v)); dom.append(r); };
      row("取值", shown.values); row("推荐", shown.recommended); row("归在", shown.step);
      const a = el("a", "去配置项 ›", "cm-setting-link") as HTMLAnchorElement; a.href = hrefOf(shown.href);
      a.addEventListener("click", (e) => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return; e.preventDefault(); navigate(shown.href); });
      dom.append(a);
      return { dom };
    } };
  });
}

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
      return { from: context.pos - m[1].length, options: (names().braces?.(head, after) ?? []).map((f) => ({
        label: f.id, type: "property", boost: f.bad ? -50 : 0, class: f.bad ? "cm-option-off" : undefined,
        detail: f.bad ? `${f.detail} · ${f.bad}` : f.needDefault ? `${f.detail} · 要默认值` : f.detail,
        apply: f.needDefault ? `${f.id}|${f.needDefault}${closed ? "" : "}"}` : closed ? f.id : `${f.id}}` })) };
    }
    m = /^\s*按设置\s+(\S*)$/.exec(before);
    if (m) return list(names().fields, "property", context.pos - m[1].length);
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

  useEffect(() => {
    if (!host.current) return;
    const created = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          runField, runGutter, lineNumbers(), highlightActiveLine(), history(), lintGutter(), templateHover(() => latest.current.template), settingHover(() => latest.current.setting),
          indentUnit.of("  "), EditorState.tabSize.of(2),
          scriptLanguage, syntaxHighlighting(highlight),
          autocompletion({ override: [completer(() => latest.current.names)] }),
          keymap.of([{ key: "Mod-s", preventDefault: true, run: () => { latest.current.onSave(); return true; } }, indentWithTab, ...defaultKeymap, ...historyKeymap]),
          Prec.highest(keymap.of([{ key: "Escape", run: () => { if (!spotNow.current) return false; closeRef.current(); return true; } },
            // ⌥↓ goes into the open panel (it opens without taking the keyboard, so moving through lines is not caught).
            { key: "Alt-ArrowDown", run: () => { const el = wrap.current?.querySelector<HTMLElement>("[data-panel] [role=listbox], [data-panel] [role=dialog][tabindex]"); if (!el) return false; el.focus(); return true; } }])),
          EditorView.domEventHandlers({ mousedown: () => { dismissed.current = null; return false; } }),
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
            ".cm-template-tip img": { maxWidth: "96px", maxHeight: "72px", borderRadius: "6px", background: "#2e2a3a", imageRendering: "pixelated" },
            ".cm-template-tip div": { display: "flex", flexDirection: "column", fontSize: "12px" },
            ".cm-setting-tip": { display: "flex", flexDirection: "column", gap: "3px", padding: "8px 10px", background: "var(--color-surface)", color: "var(--color-ink)", borderRadius: "6px", maxWidth: "340px", fontSize: "12px", lineHeight: "18px" },
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
          }),
        ],
      }),
    });
    view.current = created;
    const scrolled = () => setScrolled((n) => n + 1);
    created.scrollDOM.addEventListener("scroll", scrolled);
    return () => { created.scrollDOM.removeEventListener("scroll", scrolled); created.destroy(); view.current = null; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // A value changed from outside (a save elsewhere, a reload) replaces the text when it differs.
  useEffect(() => {
    const v = view.current; if (!v) return;
    const now = v.state.doc.toString();
    if (now !== value) v.dispatch({ changes: { from: 0, to: now.length, insert: value } });
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
  </div>;
}
