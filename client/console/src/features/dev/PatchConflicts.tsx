import { useState } from "react";
import type { Json, Obj, PatchConflict } from "./api";
import { isObj, snippets, str, tasks } from "./model";
import { lineDiff } from "./wb";
import w from "./Wb.module.css";
import pub from "./Publish.module.css";

/**
 * A batch the server refused because the nodes changed elsewhere since editing began: each node's two sides (线上 =
 * stored now, 我的 = what this edit wanted), and which to keep. Nothing is sent again until one is chosen.
 */
export function PatchConflicts({ conflicts, body, onChoose }: { conflicts: PatchConflict[]; body: Obj; onChoose: (mine: boolean) => Promise<string | null> }) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const choose = async (mine: boolean) => {
    setBusy(true); setProblem(null);
    const text = await onChoose(mine);
    setBusy(false); if (text) setProblem(text);
  };
  return (
    <div className={`${w.card} ${w.refused}`} role="alertdialog" aria-label="改动冲突">
      <b>别处改过了（你开始编辑之后）</b>
      <span className={w.muted}>− 线上的 · + 我的</span>
      {conflicts.map((c, i) => <Sides key={i} conflict={c} body={body} />)}
      {problem && <span className={w.message}>{problem}</span>}
      <div className={w.refusedRow}>
        <button type="button" className={`${w.btn} ${w.sm} ${w.primary}`} disabled={busy} onClick={() => void choose(true)}>{busy ? "保存中…" : "用我的"}</button>
        <button type="button" className={`${w.btn} ${w.sm}`} disabled={busy} onClick={() => void choose(false)}>用线上的</button>
      </div>
    </div>
  );
}

function Sides({ conflict: c, body }: { conflict: PatchConflict; body: Obj }) {
  const theirs = c.current ?? null, mine = c.mine ?? null;
  const note = theirs === null ? "线上已删掉" : mine === null ? "我的是删掉它" : null;
  // A script on both sides reads as lines; anything else as its JSON.
  const scripts = isObj(theirs) && isObj(mine) && typeof theirs.script === "string" && typeof mine.script === "string";
  const lines = scripts ? lineDiff(str((theirs as Obj).script)!, str((mine as Obj).script)!) : lineDiff(pretty(theirs), pretty(mine));
  const other = scripts && pretty({ ...(theirs as Obj), script: null }) !== pretty({ ...(mine as Obj), script: null });
  const shown = lines.filter((l, i, all) => l.kind !== "same" || all.slice(Math.max(0, i - 2), i + 3).some((x) => x.kind !== "same"));
  return <div>
    <div className={w.muted}><b>{nameOf(c.path, body)}</b>{note ? ` · ${note}` : ""}{other ? " · 名称等也不同" : ""}{scripts && !shown.length ? " · 脚本相同" : ""}</div>
    {shown.length > 0 && <div className={pub.diff} style={{ margin: "4px 0 0" }}>
      {shown.map((l, i) => <div key={i} className={pub.diffLine} data-kind={l.kind}><span className={pub.ln}>{l.kind === "add" ? l.b : l.a}</span><span>{l.kind === "add" ? "+" : l.kind === "del" ? "−" : " "} {l.text}</span></div>)}
    </div>}
  </div>;
}

const pretty = (value: Json | null) => value === null ? "" : JSON.stringify(value, null, 2);

/** A patch path (`tasks:daily/steps:s2`, `snippets:open`) in words: 「日常 · 2 领奖」, 「片段 open」. */
function nameOf(path: string, body: Obj): string {
  const parts = path.split("/").filter(Boolean).map((x) => { const i = x.indexOf(":"); return i < 0 ? [x, ""] : [x.slice(0, i), x.slice(i + 1)]; });
  const out: string[] = [];
  let task = undefined as ReturnType<typeof tasks>[number] | undefined;
  for (const [kind, id] of parts) {
    if (kind === "tasks") { task = tasks(body).find((t) => t.id === id); out.push(task?.name || id); }
    else if (kind === "steps") { const st = task?.steps.find((x) => String(x.id) === id); out.push(st ? `${task!.steps.indexOf(st) + 1} ${str(st.name) ?? id}` : id); }
    else if (kind === "snippets") out.push(`片段 ${str(snippets(body).find((x) => String(x.id) === id)?.name) ?? id}`);
    else out.push(id || kind);
  }
  return out.join(" · ") || "草稿";
}
