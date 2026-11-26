import { useEffect, useRef } from "react";
import { autocompletion, type Completion, type CompletionContext } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { HighlightStyle, StreamLanguage, indentUnit, syntaxHighlighting } from "@codemirror/language";
import { lintGutter, setDiagnostics, type Diagnostic } from "@codemirror/lint";
import { EditorState, RangeSet, StateEffect, StateField, type Range } from "@codemirror/state";
import { Decoration, EditorView, GutterMarker, WidgetType, gutter, highlightActiveLine, hoverTooltip, keymap, lineNumbers, type DecorationSet } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { href as hrefOf, navigate } from "../../router";
import type { SettingView } from "./settingUse";

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

const highlight = HighlightStyle.define([
  { tag: tags.keyword, color: "#7c3aed", fontWeight: "600" },
  { tag: tags.string, color: "#0f8a5f" },
  { tag: tags.atom, color: "#2563eb" },
  { tag: tags.number, color: "#c2410c" },
  { tag: tags.comment, color: "#8a8f98", fontStyle: "italic" },
  { tag: tags.operator, color: "#b45309" },
  { tag: tags.labelName, color: "#db2777", fontWeight: "600" },
  { tag: tags.propertyName, color: "#0e7490", fontWeight: "600", background: "color-mix(in srgb, #0e7490 10%, transparent)", borderRadius: "3px" },
]);

export interface ScriptNames { templates: string[]; regions: string[]; snippets: string[]; fields: string[]; pages: string[];
  /** Number settings, offered after `{`. */
  numberFields?: { id: string; label: string }[] }
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
      row("取值", shown.values); row("推荐", shown.recommended); row("提供", shown.step);
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
    let m = /@([^\s@]*)$/.exec(before);
    if (m) return list(names().regions, "constant", context.pos - m[1].length);
    m = /图\s+([^\s@]*)$/.exec(before);
    if (m) return list(names().templates, "variable", context.pos - m[1].length);
    m = /^\s*用\s+(\S*)$/.exec(before);
    if (m) return list(names().snippets, "function", context.pos - m[1].length);
    m = /^\s*去\s+(\S*)$/.exec(before);
    if (m) return list(names().pages, "constant", context.pos - m[1].length);
    m = /\{([^{}\s]*)$/.exec(before);
    if (m) {
      const closed = line.text.slice(context.pos - line.from).startsWith("}");
      return { from: context.pos - m[1].length, options: (names().numberFields ?? []).map((f) => ({ label: f.id, detail: f.label, type: "property", apply: closed ? f.id : `${f.id}}` })) };
    }
    m = /^\s*按设置\s+(\S*)$/.exec(before);
    if (m) return list(names().fields, "property", context.pos - m[1].length);
    m = /^\s*(\S*)$/.exec(before);
    if (m && (m[1] || context.explicit)) return { from: context.pos - m[1].length, options: STATEMENTS.map(([label, info]) => ({ label, detail: info, type: "keyword" })) };
    return null;
  };
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
  const view = useRef<EditorView | null>(null);
  const latest = useRef({ onChange, onSave, names, template, onCursor, setting });
  latest.current = { onChange, onSave, names, template, onCursor, setting };

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
          EditorView.updateListener.of((update) => {
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
          }),
        ],
      }),
    });
    view.current = created;
    return () => { created.destroy(); view.current = null; };
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

  return <div ref={host} style={{ height: "100%" }} />;
}
