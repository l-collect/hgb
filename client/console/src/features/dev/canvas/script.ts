/**
 * 画板's reading of a task script: each line a statement (its word, line number and the lines indented under it), the
 * way the engine's compiler reads it (TaskScript.kt: indentation makes the tree, `#` starts a comment except in a colour
 * point, `否则` belongs to the 如果… block right above it). The script text stays the only data: every edit here is a
 * change to a few lines of the text, and every line not touched is kept exactly as it was.
 */
import { stripComment } from "../settingUse";

export type Kind =
  | "go" | "wait" | "pause" | "longWait" | "launch"
  | "tap" | "drag" | "scan" | "quiz" | "reset"
  | "ifSee" | "ifNot" | "ifHas" | "ifRed" | "ifColor" | "cases" | "setting"
  | "repeat" | "until" | "each" | "exit"
  | "use" | "result" | "stop" | "report"
  /** A line of a 分情况 / 按设置 / 扫描网格 block: a case, a value, or a label (有 / 无 / 最后 / 还有). */
  | "case"
  /** 否则, under the 如果… right above it. */
  | "else"
  /** A line this reading does not know: shown as it is, edited in the script. */
  | "raw";

/** What a node is for: its colour on the board (走到哪 · 操作 · 判断 · 反复 · 复用与收尾). */
export type Group = "run" | "act" | "if" | "loop" | "end" | "raw";

const WORDS: Record<string, Kind> = {
  去: "go", 等: "wait", 等待: "pause", 长等待: "longWait", 启动游戏: "launch",
  点: "tap", 点空白: "tap", 拖: "drag", 扫描网格: "scan", 答题: "quiz", 清零: "reset",
  如果看到: "ifSee", 如果没看到: "ifNot", 如果有: "ifHas", 如果红点: "ifRed", 如果颜色: "ifColor", 分情况: "cases", 按设置: "setting",
  反复: "repeat", 直到: "until", 逐个: "each", 跳出: "exit",
  用: "use", 结果: "result", 停下: "stop", 上报: "report",
};
export const GROUP: Record<Kind, Group> = {
  go: "run", wait: "run", pause: "run", longWait: "run", launch: "run",
  tap: "act", drag: "act", scan: "if", quiz: "act", reset: "act",
  ifSee: "if", ifNot: "if", ifHas: "if", ifRed: "if", ifColor: "if", cases: "if", setting: "if",
  repeat: "loop", until: "loop", each: "loop", exit: "end",
  use: "end", result: "end", stop: "end", report: "end", case: "if", else: "if", raw: "raw",
};
/** Statements whose indented lines are statements again. */
export const BLOCKS = new Set<Kind>(["ifSee", "ifNot", "ifHas", "ifRed", "ifColor", "repeat", "until", "each"]);
/** Statements whose indented lines are cases (each with statements under it). */
export const CASES = new Set<Kind>(["cases", "setting", "scan"]);
/** The 如果… a 否则 right after belongs to (the engine's ELSE_HEADS). */
export const ELSE_HEADS = new Set<Kind>(["ifSee", "ifNot", "ifHas", "ifRed", "ifColor"]);
export const LOOPS = new Set<Kind>(["repeat", "until", "each"]);
export const BRANCHES = new Set<Kind>([...ELSE_HEADS, ...CASES]);

export interface Stmt {
  /** `L<line>`: the engine's action ids start the same way, so a trial's place finds the node. */
  id: string;
  /** 1-based. */
  line: number;
  indent: number;
  /** The statement word (for a case: its name or value). */
  word: string;
  kind: Kind;
  /** The line without its indentation and comment. */
  text: string;
  children: Stmt[];
  /** The 否则 block of a 如果…, when written. */
  else?: Stmt;
  /** The last line of this statement with everything under it (and its 否则). */
  end: number;
  parent: Stmt | null;
}

export interface Doc {
  text: string;
  lines: string[];
  roots: Stmt[];
  /** Why the lines do not make a tree (indentation, tabs), with where; nothing can be drawn then. */
  error: { line: number; reason: string } | null;
  /** Every statement (cases and 否则 too) by its line. */
  byLine: Map<number, Stmt>;
}

/** The statement word of a line's text: up to the first space or `@` (a quoted start has none). */
export function wordOf(text: string): string {
  if (text.startsWith("\"") || text.startsWith("“")) return "";
  return /^[^\s@]+/.exec(text)?.[0] ?? "";
}
const indentOf = (s: string) => s.length - s.trimStart().length;

/** Reads [text] into statements. Never throws: lines that do not make a tree are said in [Doc.error]. */
export function read(text: string): Doc {
  const lines = text.split("\n");
  const byLine = new Map<number, Stmt>();
  type Raw = { line: number; indent: number; text: string; kids: Raw[] };
  const roots: Raw[] = []; const stack: Raw[] = [];
  let error: Doc["error"] = null;
  for (let i = 0; i < lines.length && !error; i++) {
    const code = stripComment(lines[i].replace(/\r$/, "")).trimEnd();
    if (!code.trim()) continue;
    const indent = indentOf(code);
    if (code.slice(0, indent).includes("\t")) { error = { line: i + 1, reason: "请用空格缩进，不要用 Tab" }; break; }
    const node: Raw = { line: i + 1, indent, text: code.trim(), kids: [] };
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
    if (!stack.length) {
      if (roots.length && indent !== roots[0].indent) { error = { line: i + 1, reason: "缩进对不齐" }; break; }
      roots.push(node);
    } else {
      const siblings = stack[stack.length - 1].kids;
      if (siblings.length && siblings[0].indent !== indent) { error = { line: i + 1, reason: "缩进和上面同一层的行对不齐" }; break; }
      siblings.push(node);
    }
    stack.push(node);
  }
  if (error) return { text, lines, roots: [], error, byLine };

  const make = (r: Raw, parent: Stmt | null, asCase: boolean): Stmt => {
    const word = asCase ? (/^("[^"]*"|“[^”]*”|[^\s@]+)/.exec(r.text)?.[0] ?? r.text) : wordOf(r.text);
    let kind: Kind = asCase ? "case" : WORDS[word] ?? "raw";
    // A statement that may not have lines under it, with some, is shown as it is.
    if (!asCase && kind !== "raw" && r.kids.length && !BLOCKS.has(kind) && !CASES.has(kind)) kind = "raw";
    const s: Stmt = { id: `L${r.line}`, line: r.line, indent: r.indent, word, kind, text: r.text, children: [], end: r.line, parent };
    byLine.set(r.line, s);
    if (kind === "raw") s.children = r.kids.map((k) => rawTree(k, s));
    else if (CASES.has(kind)) s.children = r.kids.map((k) => make(k, s, true));
    else s.children = list(r.kids, s);
    return s;
  };
  const rawTree = (r: Raw, parent: Stmt): Stmt => {
    const s: Stmt = { id: `L${r.line}`, line: r.line, indent: r.indent, word: wordOf(r.text), kind: "raw", text: r.text, children: [], end: r.line, parent };
    byLine.set(r.line, s);
    s.children = r.kids.map((k) => rawTree(k, s));
    return s;
  };
  /** Sibling lines: 否则 joins the 如果… above it. */
  const list = (rs: Raw[], parent: Stmt | null): Stmt[] => {
    const out: Stmt[] = [];
    for (const r of rs) {
      const prev = out[out.length - 1];
      if (r.text.replace(/[:：]$/, "") === "否则" && prev && ELSE_HEADS.has(prev.kind) && !prev.else) {
        const e: Stmt = { id: `L${r.line}`, line: r.line, indent: r.indent, word: "否则", kind: "else", text: r.text, children: [], end: r.line, parent: prev };
        byLine.set(r.line, e);
        e.children = list(r.kids, e);
        prev.else = e;
        continue;
      }
      out.push(make(r, parent, false));
    }
    return out;
  };
  const top = list(roots, null);
  const ends = (s: Stmt): number => {
    let end = s.line;
    for (const c of s.children) end = Math.max(end, ends(c));
    if (s.else) end = Math.max(end, ends(s.else));
    s.end = end; return end;
  };
  top.forEach(ends);
  return { text, lines, roots: top, error: null, byLine };
}

/** The statement lines in the order the tree holds them (a statement, what is under it, its 否则). */
export function walkOrder(doc: Doc): number[] {
  const out: number[] = [];
  const go = (s: Stmt) => { out.push(s.line); s.children.forEach(go); if (s.else) go(s.else); };
  doc.roots.forEach(go);
  return out;
}

/**
 * The text back from the tree: each statement's line where the tree puts it, and the lines that are no statement
 * (blank, comments) kept in their places. Unchanged, it is the text read, character for character.
 */
export function write(doc: Doc): string {
  if (doc.error) return doc.text;
  const out: string[] = []; let next = 1;
  const isStmt = new Set(doc.byLine.keys());
  for (const n of walkOrder(doc)) {
    for (; next < n; next++) if (!isStmt.has(next)) out.push(doc.lines[next - 1]);
    out.push(doc.lines[n - 1]); next = Math.max(next, n + 1);
  }
  for (; next <= doc.lines.length; next++) if (!isStmt.has(next)) out.push(doc.lines[next - 1]);
  return out.join("\n");
}

/** Every statement, depth first (cases and 否则 included). */
export function allStmts(doc: Doc): Stmt[] {
  const out: Stmt[] = [];
  const go = (s: Stmt) => { out.push(s); s.children.forEach(go); if (s.else) go(s.else); };
  doc.roots.forEach(go);
  return out;
}
/** The innermost statement a line belongs to (the line itself when it is one). */
export function stmtAt(doc: Doc, line: number): Stmt | null {
  let best: Stmt | null = null;
  for (const s of allStmts(doc)) if (s.line <= line && s.end >= line && (!best || s.line >= best.line)) best = s;
  return best;
}

// ---- A line split into its parts, and its words with where they are

/** [raw] = indent + code + tail (spaces and the comment after the statement). */
export function splitLine(raw: string): { indent: string; code: string; tail: string } {
  const stripped = stripComment(raw);
  const code = stripped.trimEnd();
  const indent = code.slice(0, indentOf(code));
  return { indent, code: code.slice(indent.length), tail: raw.slice(code.length) };
}

export interface Tok { text: string; quoted: boolean; at: string | null; from: number; to: number; atFrom: number; atTo: number }
/** The engine's tokens of a statement's code (offsets into it): words and quoted texts, each with its `@region`. */
export function tokens(code: string): Tok[] {
  const out: Tok[] = []; let i = 0;
  const at = (): [string | null, number, number] => {
    if (i < code.length && code[i] === "@") { const start = ++i; while (i < code.length && !/\s/.test(code[i])) i++; return [code.slice(start, i) || null, start, i]; }
    return [null, i, i];
  };
  while (i < code.length) {
    const c = code[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === "\"" || c === "“") {
      const close = c === "\"" ? "\"" : "”";
      const from = i; let end = code.indexOf(close, i + 1); if (end < 0) end = code.length;
      const value = code.slice(i + 1, end); i = Math.min(code.length, end + 1);
      const [a, af, at2] = at();
      out.push({ text: value, quoted: true, at: a, from, to: a ? at2 : i, atFrom: af, atTo: at2 });
    } else {
      const from = i;
      while (i < code.length && !/\s/.test(code[i]) && code[i] !== "@") i++;
      const word = code.slice(from, i);
      const [a, af, at2] = at();
      const last = out[out.length - 1];
      if (!word && a !== null && last && last.at === null) { last.at = a; last.atFrom = af; last.atTo = at2; last.to = at2; }
      else out.push({ text: word, quoted: false, at: a, from, to: a !== null ? at2 : i, atFrom: af, atTo: at2 });
    }
  }
  return out;
}

/** A line with its code replaced, its indentation and comment kept. */
export function withCode(raw: string, code: string): string {
  const p = splitLine(raw);
  return p.indent + code + p.tail;
}

// ---- 最多 N秒 / 最多 N 次 / 最多 N步

export interface Limit { value: string; unit: string; from: number; to: number; valueFrom: number; valueTo: number; spaced: boolean }
/** Every `最多 …` of [code]. */
export function limits(code: string): Limit[] {
  const toks = tokens(code); const out: Limit[] = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.quoted || t.at !== null || t.text !== "最多") continue;
    let j = i + 1; let joined = toks[j]?.text ?? ""; const first = toks[j];
    if (!first || first.quoted) continue;
    while (joined.startsWith("{") && !joined.includes("}") && toks[j + 1]) { j++; joined += toks[j].text; }
    const m = /^([0-9]+(?:\.[0-9]+)?|\{[^{}]*\})(秒|次|步)?$/.exec(joined);
    if (!m) continue;
    if (m[2]) {
      const vTo = toks[j].to - m[2].length;
      out.push({ value: m[1], unit: m[2], from: t.from, to: toks[j].to, valueFrom: first.from, valueTo: vTo, spaced: false });
    } else {
      const u = toks[j + 1];
      if (!u || u.quoted || !["秒", "次", "步"].includes(u.text)) continue;
      out.push({ value: m[1], unit: u.text, from: t.from, to: u.to, valueFrom: first.from, valueTo: toks[j].to, spaced: true });
    }
  }
  return out;
}
export const limitOf = (code: string, unit: string) => limits(code).find((l) => l.unit === unit) ?? null;
/** [code] with its `最多 …unit` set to [value] (added at the end when missing), or taken away (null). */
export function setLimit(code: string, unit: string, value: string | null): string {
  const l = limitOf(code, unit);
  if (!l) return value === null ? code : `${code} 最多 ${value}${unit === "次" ? " " : ""}${unit}`;
  if (value === null) { const before = code.slice(0, l.from).replace(/\s+$/, ""); return before + code.slice(l.to); }
  return code.slice(0, l.valueFrom) + value + code.slice(l.valueTo);
}

// ---- The parts most statements have

/** The first `@…` of [code] (where to look). */
export function regionOf(code: string): { value: string; from: number; to: number } | null {
  const t = tokens(code).find((x) => x.at !== null);
  return t ? { value: t.at!, from: t.atFrom, to: t.atTo } : null;
}
export function setRegion(code: string, value: string): string {
  const r = regionOf(code);
  if (r) return code.slice(0, r.from) + value + code.slice(r.to);
  return code;
}
/** `图 name@region [0.8]`: the template, where, and how alike it has to be. */
export function imageOf(code: string): { name: string; nameFrom: number; nameTo: number; region: string | null; threshold: string | null; thFrom: number; thTo: number } | null {
  const toks = tokens(code);
  const i = toks.findIndex((t) => !t.quoted && t.at === null && t.text === "图");
  const n = i >= 0 ? toks[i + 1] : undefined;
  if (!n || n.quoted) return null;
  const nameTo = n.from + n.text.length;
  const th = toks[i + 2];
  const threshold = th && !th.quoted && th.at === null && /^(0?\.\d+|1(?:\.0+)?)$/.test(th.text) ? th : null;
  return { name: n.text, nameFrom: n.from, nameTo, region: n.at, threshold: threshold?.text ?? null, thFrom: threshold?.from ?? n.to, thTo: threshold?.to ?? n.to };
}
export function setImage(code: string, name: string): string {
  const im = imageOf(code); if (!im) return code;
  return code.slice(0, im.nameFrom) + name + code.slice(im.nameTo);
}
export function setThreshold(code: string, value: string | null): string {
  const im = imageOf(code); if (!im) return code;
  if (im.threshold === null) return value === null ? code : code.slice(0, im.thFrom) + " " + value + code.slice(im.thFrom);
  if (value === null) return code.slice(0, im.thFrom).replace(/\s+$/, "") + code.slice(im.thTo);
  return code.slice(0, im.thFrom) + value + code.slice(im.thTo);
}
/** The first quoted text. */
export function quotedOf(code: string): { value: string; from: number; to: number } | null {
  const t = tokens(code).find((x) => x.quoted);
  if (!t) return null;
  return { value: t.text, from: t.from + 1, to: t.from + 1 + t.text.length };
}
export function setQuoted(code: string, value: string): string {
  const q = quotedOf(code); if (!q) return code;
  return code.slice(0, q.from) + value.replace(/["“”]/g, "") + code.slice(q.to);
}
/** The word right after the statement word (去 页面 / 用 片段 / 按设置 x / 清零 名). */
export function argOf(code: string): { value: string; from: number; to: number } | null {
  const t = tokens(code)[1];
  return t ? { value: t.text, from: t.from + (t.quoted ? 1 : 0), to: t.from + (t.quoted ? 1 : 0) + t.text.length } : null;
}
export function setArg(code: string, value: string): string {
  const a = argOf(code);
  return a ? code.slice(0, a.from) + value + code.slice(a.to) : `${code} ${value}`;
}
/** `等待 2秒` / `长等待 300秒`: the seconds as written (a number or `{x}`). */
export function secondsOf(code: string): { value: string; from: number; to: number } | null {
  const m = /^(\S+\s+)(\S+?)(\s*秒)\s*$/.exec(code);
  return m ? { value: m[2], from: m[1].length, to: m[1].length + m[2].length } : null;
}
export function setSeconds(code: string, value: string): string {
  const s = secondsOf(code);
  return s ? code.slice(0, s.from) + value + code.slice(s.to) : `${wordOf(code)} ${value}秒`;
}

// ---- Edits: a few lines of the text changed, the rest kept

/** The lines of [text] from [from] to [to] (1-based, inclusive) replaced by [put]. */
export function splice(text: string, from: number, to: number, put: string[]): string {
  // A text whose every line ends in \r\n keeps doing so: new lines get the same ending.
  const crlf = text.includes("\r\n") && text.split("\n").length - 1 === text.split("\r\n").length - 1;
  const lines = crlf ? text.split("\r\n") : text.split("\n");
  lines.splice(from - 1, Math.max(0, to - from + 1), ...put.map((l) => crlf ? l.replace(/\r$/, "") : l));
  return lines.join(crlf ? "\r\n" : "\n");
}
/** Line [n] of [text] with its code replaced (indentation and comment kept). */
export function setCode(text: string, n: number, code: string): string {
  const lines = text.split("\n");
  if (n < 1 || n > lines.length) return text;
  lines[n - 1] = withCode(lines[n - 1], code);
  return lines.join("\n");
}

/**
 * Where a new statement goes. after: right after line [line] and all under it, at that line's own indentation (after a
 * case: one more case). first: first under [parent] (a block, a case, or with "else" its 否则, written when missing).
 * top: first of the script.
 */
export type Place =
  | { kind: "after"; line: number }
  | { kind: "first"; parent: number | null; branch: "children" | "else" }
  | { kind: "top" };

/** The indentation one level in from [s], as the script already writes it (two spaces when nothing says). */
function innerIndent(doc: Doc, s: Stmt): number {
  const kid = s.children[0] ?? s.else?.children[0];
  if (kid) return kid.indent;
  const any = allStmts(doc).find((x) => x.parent && x.indent > x.parent.indent);
  return s.indent + (any ? any.indent - any.parent!.indent : 2);
}
const pad = (n: number) => " ".repeat(n);
const isComment = (l: string) => /^\s*#/.test(l);
/**
 * [block] put at indentation [indent]: its statement lines keep their indentation relative to the first statement;
 * a comment written less indented than that (or with a tab) goes at [indent] itself.
 */
function indented(block: string[], indent: number): string[] {
  const code = block.filter((l) => l.trim() && !isComment(l));
  const base = code.length ? indentOf(code[0]) : Math.min(...block.filter((l) => l.trim()).map(indentOf));
  return block.map((l) => {
    if (!l.trim()) return l;
    const lead = l.slice(0, indentOf(l));
    if (indentOf(l) < base || lead.includes("\t")) return pad(indent) + l.trimStart();
    return pad(indent) + l.slice(base);
  });
}

/** [text] with [block] (one statement and what is under it, as lines) put at [place]; and the line it starts at. */
export function insert(text: string, place: Place, block: string[]): { text: string; line: number } { return insertLines(text, place, block); }
function insertLines(text: string, place: Place, block: string[]): { text: string; line: number } {
  const doc = read(text);
  if (doc.error) return { text, line: 0 };
  const rootIndent = doc.roots[0]?.indent ?? 0;
  if (place.kind === "top" || (place.kind === "first" && place.parent === null)) {
    // First of the script: before its first statement (comments at the top stay on top).
    const first = doc.roots[0];
    if (!first && doc.text === "") return { text: indented(block, 0).join("\n"), line: 1 };
    // Only comments (or blank lines): after the last of them, the text's end (and its last newline) kept.
    let lastText = doc.lines.length; while (lastText > 0 && !doc.lines[lastText - 1].trim()) lastText--;
    const at = first ? leadOf(doc, first) : lastText + 1;
    const lines = indented(block, rootIndent);
    return { text: splice(text, at, at - 1, lines), line: at };
  }
  if (place.kind === "after") {
    const s = doc.byLine.get(place.line);
    if (!s) return { text, line: 0 };
    // After a 否则: last in it. After anything else (a case too): next to it, at its own indentation.
    if (s.kind === "else") { const ind = innerIndent(doc, s); return { text: splice(text, s.end + 1, s.end, indented(block, ind)), line: s.end + 1 }; }
    return { text: splice(text, s.end + 1, s.end, indented(block, s.indent)), line: s.end + 1 };
  }
  const parent = doc.byLine.get(place.parent!);
  if (!parent) return { text, line: 0 };
  if (place.branch === "else") {
    if (parent.else) {
      const ind = innerIndent(doc, parent.else);
      return { text: splice(text, parent.else.line + 1, parent.else.line, indented(block, ind)), line: parent.else.line + 1 };
    }
    const ind = innerIndent(doc, parent);
    const lines = [pad(parent.indent) + "否则", ...indented(block, ind)];
    return { text: splice(text, parent.end + 1, parent.end, lines), line: parent.end + 2 };
  }
  const ind = innerIndent(doc, parent);
  return { text: splice(text, parent.line + 1, parent.line, indented(block, ind)), line: parent.line + 1 };
}

/** The first of the comment lines right above [s] (no blank between): they go with it when it is moved or taken away. */
export function leadOf(doc: Doc, s: Stmt): number {
  let n = s.line;
  while (n > 1 && /^\s*#/.test(doc.lines[n - 2]) && !doc.byLine.has(n - 1)) n--;
  return n;
}
/** [text] without statement [line], everything under it (its 否则 too) and the comment right above it. */
export function remove(text: string, line: number): string {
  const doc = read(text);
  const s = doc.byLine.get(line);
  if (!s || doc.error) return text;
  return splice(text, leadOf(doc, s), s.end, []);
}
/** Why [line] cannot be taken away alone (a block that would be left empty), or null. */
export function removeProblem(doc: Doc, line: number): string | null {
  const s = doc.byLine.get(line);
  if (!s) return "找不到这一句";
  const p = s.parent;
  if (p && (p.kind === "repeat" || p.kind === "each") && p.children.length === 1 && p.children[0] === s) return `「${p.word}」里至少要留一句`;
  if (s.kind === "case" && p && p.children.length === 1) return `「${p.word}」至少要留一种情况`;
  return null;
}
/** [text] with statement [line] (and what is under it) written once more right after itself. */
export function duplicate(text: string, line: number): { text: string; line: number } {
  const doc = read(text);
  const s = doc.byLine.get(line);
  if (!s || doc.error || s.kind === "else") return { text, line: 0 };
  const lines = doc.lines.slice(s.line - 1, s.end);
  return { text: splice(text, s.end + 1, s.end, lines), line: s.end + 1 };
}
/** [text] with statement [line] (and what is under it) moved to [place]: its lines re-indented, nothing else changed. */
export function move(text: string, line: number, place: Place): { text: string; line: number } {
  const doc = read(text);
  const s = doc.byLine.get(line);
  if (!s || doc.error || s.kind === "case" || s.kind === "else") return { text, line: 0 };
  if (place.kind === "after" && place.line >= s.line && place.line <= s.end) return { text, line: 0 };
  if (place.kind === "first" && place.parent !== null && place.parent >= s.line && place.parent <= s.end) return { text, line: 0 };
  const lead = leadOf(doc, s);
  const block = doc.lines.slice(lead - 1, s.end);
  const without = splice(text, lead, s.end, []);
  if (!read(without).roots.length && place.kind !== "after") return { text: [...block, ...without.split("\n")].join("\n").replace(/\n$/, text.endsWith("\n") ? "\n" : ""), line: 1 + s.line - lead };
  const shift = (n: number) => n > s.end ? n - (s.end - lead + 1) : n;
  const moved: Place = place.kind === "after" ? { kind: "after", line: shift(place.line) }
    : place.kind === "first" ? { ...place, parent: place.parent === null ? null : shift(place.parent) } : place;
  const put = insertLines(without, moved, block);
  return { text: put.text, line: put.line + (s.line - lead) };
}

// ---- What a script is made of, for the round trip

/** The text of [text]'s statements read, written back: the same, character for character, when nothing was changed. */
export const roundTrip = (text: string) => write(read(text));
