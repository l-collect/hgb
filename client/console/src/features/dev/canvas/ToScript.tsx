/**
 * A step or snippet still written as blocks (a program, not a script): the workbench writes scripts only now, so it is
 * rewritten as one by the server (`POST /api/dev/script-of`) and put into the draft in its place (script set, program
 * dropped) through the usual patches. When some part cannot be rewritten, nothing changes and those parts are listed;
 * the blocks stay as they are, shown read-only.
 */
import { useEffect, useRef, useState } from "react";
import { apiUrl } from "../../../api/client";
import type { Json, Obj } from "../api";
import type { Edit } from "../context";
import { failure } from "../context";
import { describe, KIND, nodeDigest, objs, programOf, str } from "../model";
import c from "./Canvas.module.css";

export interface ScriptOf { script: string; unsupported: { at: string; reason: string }[] }
type State = { kind: "asking" } | { kind: "old" } | { kind: "unsupported"; list: ScriptOf["unsupported"] } | { kind: "failed"; why: string } | { kind: "held" };

/** The server's rewrite of [program]; null when the server does not have it yet (404). */
async function scriptOf(program: Json[]): Promise<ScriptOf | null> {
  let reply: Response;
  try { reply = await fetch(apiUrl("/api/dev/script-of"), { method: "POST", headers: { "Content-Type": "application/json", "X-YYS-Request": "1" }, credentials: "include", body: JSON.stringify({ program }) }); }
  catch { throw new Error("无法连接服务器，请检查网络"); }
  if (reply.status === 404 || reply.status === 405) return null;
  const data = await reply.json().catch(() => null);
  if (!reply.ok) throw new Error(data?.message ?? "改写没做成，请稍后再试");
  return { script: String(data?.script ?? ""), unsupported: Array.isArray(data?.unsupported) ? data.unsupported : [] };
}

export function ToScript({ owner, path, apply, auto, onConverted }: {
  owner: Obj;
  /** The node's patch path: `tasks:<t>/steps:<s>` or `snippets:<id>`. */
  path: string;
  apply: (edit: Edit) => Promise<string | null>;
  /** Rewrite at once (not after it was undone here). */
  auto: boolean;
  onConverted: (before: Obj, script: string) => void;
}) {
  const [state, setState] = useState<State>({ kind: auto ? "asking" : "held" });
  const started = useRef(false);
  const program = programOf(owner);
  const run = async () => {
    setState({ kind: "asking" });
    try {
      const got = await scriptOf(program as unknown as Json[]);
      if (!got) { setState({ kind: "old" }); return; }
      if (got.unsupported.length) { setState({ kind: "unsupported", list: got.unsupported }); return; }
      const before = owner;
      const problem = await apply(async () => {
        const value: Obj = { ...owner, script: got.script };
        delete value.program; delete value.actions;
        return [{ op: "put", path, expect: await nodeDigest(owner), value }];
      });
      if (problem) { setState({ kind: "failed", why: problem }); return; }
      onConverted(before, got.script);
    } catch (error) { setState({ kind: "failed", why: error instanceof Error ? error.message : failure(error) }); }
  };
  useEffect(() => { if (auto && !started.current) { started.current = true; void run(); } }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const what = path.startsWith("snippets:") ? "这个片段" : "这一步";
  return (
    <div className={c.toScript}>
      <b>{what}是积木写的</b>
      {state.kind === "asking" && <span className={c.muted}>正在改写成脚本…</span>}
      {state.kind === "held" && <><span className={c.muted}>工作台只用脚本写法了，改写后可以在脚本和画板里编辑。</span>
        <button type="button" className={`${c.btn} ${c.pri}`} onClick={() => void run()}>改写成脚本</button></>}
      {state.kind === "old" && <span className={c.muted}>需要更新服务端才能改写。先保留原样，只读。</span>}
      {state.kind === "failed" && <><span className={c.err}>{state.why}</span><button type="button" className={c.btn} onClick={() => void run()}>再试一次</button></>}
      {state.kind === "unsupported" && <>
        <span className={c.warn}>这几处没法改写，先保留原样，只读：</span>
        <ul className={c.list}>{state.list.map((u, i) => <li key={i}><code className={c.mono}>{u.at}</code> {u.reason}</li>)}</ul>
      </>}
      {state.kind !== "asking" && <Blocks program={program} />}
    </div>
  );
}

/** The blocks as they are, one line each, nested: read-only. */
function Blocks({ program }: { program: Obj[] }) {
  const rows: [number, string][] = [];
  const walk = (list: Obj[], depth: number) => list.forEach((n) => {
    const kind = KIND[String(n.type)] ?? String(n.type ?? "");
    const said = n.type === "action" ? `${str(n.capability) ?? ""}${n.id ? ` · ${String(n.id)}` : ""}` : describe(n);
    rows.push([depth, `${kind} ${said}`.trim()]);
    for (const c2 of objs(n.cases)) walk(objs(c2.program), depth + 1);
    walk(objs(n.program), depth + 1);
  });
  walk(program, 0);
  if (!rows.length) return null;
  return <div className={c.blocksList} aria-label="积木（只读）">{rows.slice(0, 200).map(([d, t], i) => <div key={i} style={{ paddingLeft: d * 16 }}>{t}</div>)}
    {rows.length > 200 && <div className={c.muted}>还有 {rows.length - 200} 块</div>}</div>;
}
