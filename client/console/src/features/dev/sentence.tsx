import { useEffect, useState } from "react";
import { Chips } from "../../components/ui";
import w from "./Wb.module.css";
import s from "./Workspace.module.css";

/**
 * A condition made on a picture ("领取"@x,y,w,h · 图 icon@… · 色 …) becomes a whole line before it goes into a script:
 * 等 / 点 / 如果看到 (TaskScript.kt). On a line that already waits or taps, the default is to put the new condition in
 * that line's place, keeping its limits (最多 N秒 / 最多 N 次 / 偏 …); else it goes in as a new line after it.
 */
export type Verb = "等" | "点" | "如果看到";
export type CondKind = "text" | "image" | "color";
const VERBS: [Verb, string][] = [["等", "等"], ["点", "点"], ["如果看到", "如果看到"]];
/** Text and icons are mostly tapped; colour points mostly tell a page has come. */
export const defaultVerb = (kind: CondKind): Verb => kind === "color" ? "等" : "点";

/** The line(s) a condition makes: 如果看到 opens a block that taps what it saw (change it as needed). */
export function sentence(verb: Verb, cond: string): string {
  return verb === "如果看到" ? `如果看到 ${cond}\n  点 ${cond}` : `${verb} ${cond}`;
}

/** Splits a line into its indent, words (a quoted text with its @region is one word) and trailing comment. */
function split(line: string): { indent: string; words: string[]; comment: string } {
  const indent = /^\s*/.exec(line)![0];
  const words: string[] = []; let comment = "";
  let i = indent.length, word = "", quote: string | null = null;
  while (i < line.length) {
    const c = line[i];
    if (quote) { word += c; if (c === quote || (quote === "“" && c === "”")) quote = null; }
    else if (c === '"' || c === "“") { word += c; quote = c; }
    // A colour point `12,34#C83A2E` keeps its #; a # after a space starts a comment.
    else if (c === "#" && !word) { comment = line.slice(i); break; }
    else if (/\s/.test(c)) { if (word) words.push(word); word = ""; }
    else word += c;
    i++;
  }
  if (word) words.push(word);
  return { indent, words, comment };
}

const WAITS = ["等", "点", "点空白", "如果看到", "如果没看到"];
/** The verb of a line that waits for a condition (等 / 点 / 如果看到 …), else null. */
export function lineVerb(line: string | null | undefined): string | null {
  if (!line) return null;
  const first = split(line).words[0];
  return first && WAITS.includes(first) ? first : null;
}

/** [line] with its condition replaced by [cond]: its verb, limits, tap offset and comment stay. */
export function replaceCondition(line: string, cond: string): string {
  const { indent, words, comment } = split(line);
  const verb = words[0];
  const kept: string[] = [];
  const tap = verb === "点" || verb === "点空白";
  for (let i = 1; i < words.length; i++) {
    const x = words[i];
    if (x === "最多") {
      kept.push(x);
      if (words[i + 1]) kept.push(words[++i]);
      if (words[i + 1] === "秒" || words[i + 1] === "次") kept.push(words[++i]);
    } else if (x === "计" && words[i + 1]) kept.push(x, words[++i]);
    else if (tap && (x === "偏" || x === "大小") && words[i + 1]) kept.push(x, words[++i]);
    else if (tap && x === "空白") kept.push(x);
  }
  return `${indent}${[verb, cond, ...kept].join(" ")}${comment ? ` ${comment}` : ""}`;
}

/** Where a made condition can go: the script line it is for, with what that line says now. */
export interface InsertTarget {
  /** 1-based line the condition is for. */
  line: number;
  lineText: string | null;
  /** Puts [text] as new lines after line [after]. */
  insert: (text: string, after: number) => void;
  /** Puts [text] in place of line [line]. */
  replace: (line: number, text: string) => void;
}

/**
 * The made condition as a line to put in the script: 等 / 点 / 如果看到, then 「替换 L12 的条件」 (on a wait or tap line)
 * or 「插到 L13」, and 复制. [cond] null: not complete yet ([missing] says what to fill in), nothing goes in.
 */
export function ConditionOut({ cond, kind, target, copy, missing, className }: {
  cond: string | null; kind: CondKind; target: InsertTarget | null; copy: (text: string) => void; missing?: string; className?: string;
}) {
  const [verb, setVerb] = useState<Verb>(defaultVerb(kind));
  useEffect(() => { setVerb(defaultVerb(kind)); }, [kind]);
  const current = target ? lineVerb(target.lineText) : null;
  const made = cond ? sentence(verb, cond) : null;
  const replaced = cond && target && current ? replaceCondition(target.lineText!, cond) : null;
  return (
    <div className={className ?? s.result}>
      <Chips label="写成" items={VERBS} value={verb} onChange={setVerb} />
      {made ? <code className={s.code}>{made}</code> : <span className={w.message}>{missing ?? "条件还没填完"}</span>}
      {replaced && <span className={w.muted}>L{target!.line} 会变成 <code>{replaced.trim()}</code></span>}
      <div className={s.toolRow}>
        {target && replaced && <button type="button" className={`${w.btn} ${w.primary} ${w.sm} ${s.grow}`} onClick={() => target.replace(target.line, replaced)}>替换 L{target.line} 的条件</button>}
        {target && made && <button type="button" className={`${w.btn} ${w.sm} ${replaced ? "" : `${w.primary} ${s.grow}`}`} onClick={() => target.insert(made, target.line)}>
          {replaced ? "插到下一行" : `插到 L${target.line + 1}`}</button>}
        {made && <button type="button" className={`${w.btn} ${w.sm}`} onClick={() => copy(made)}>复制</button>}
      </div>
    </div>
  );
}
