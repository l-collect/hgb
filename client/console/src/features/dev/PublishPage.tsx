import { useEffect, useRef, useState } from "react";
import { Link } from "../../router";
import { useConsole } from "../../state/context";
import { dev, draftBase, queued, type CheckIssue, type CheckResult, type Obj, type PublishResult, type SyncResult } from "./api";
import { failure, scriptPath, useDev } from "./context";
import { Located, locate, placeOf } from "./where";
import { bothChanged, RepoAhead, SyncReport, SyncTools } from "./SyncTools";
import { standing } from "./HomePage";
import { isObj, objs, requiredMinApp, snippets, str, target, tasks } from "./model";
import { changedLines, lineDiff, wbPaths, type DiffLine } from "./wb";
import w from "./Wb.module.css";
import p from "./Publish.module.css";

const RETRYING = " · 稍后自动重试";
interface Check { ok: boolean | null; title: string; link?: [string, string] }
interface Change { key: string; name: string; summary: string; diffs: { label: string; lines: DiffLine[] }[] }

/** 发布 (v7 V7WbPublish): checks and what changed on the left; version, notes and the automatic preview on the right. */
export function PublishPage() {
  const { draft, game, me, trials, digests, edits, reload, saveScript, conflicts, setCheckFailed } = useDev();
  const { data } = useConsole();
  const [check, setCheck] = useState<CheckResult | null>(null);
  const [checkText, setCheckText] = useState<string | null>(null);
  const [base, setBase] = useState<Obj | null | undefined>(undefined);
  const [version, setVersion] = useState("");
  // The preview runs on the version once typing it is done (the field left), not on every key.
  const [settled, setSettled] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveText, setSaveText] = useState<string | null>(null);
  const [changelog, setChangelog] = useState("");
  const [plan, setPlan] = useState<PublishResult | string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState<[string, boolean] | null>(null);
  const [synced, setSynced] = useState<[string, boolean] | null>(null);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [allIssues, setAllIssues] = useState(false);
  // 发布 asks once more in a dialog that says which version, what changed and who gets it.
  const confirmBox = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (!draft) return;
    let live = true;
    setCheck(null); setCheckText(null);
    const control = new AbortController();
    let retry: ReturnType<typeof setTimeout> | undefined;
    // The server's queue full: its words, and one more try a little later.
    const send = (again: boolean) => dev.check(draft.body, control.signal).then((c) => { if (live) { setCheck(c); setCheckFailed(!c.ok); } }, (e) => {
      if (!live) return;
      if (queued(e) && !again) { setCheckText(`${failure(e)}${RETRYING}`); retry = setTimeout(() => { setCheckText(null); void send(true); }, 8000); return; }
      setCheckText(failure(e));
    });
    void send(false);
    return () => { live = false; clearTimeout(retry); control.abort(); };
  }, [draft]);
  useEffect(() => { let live = true; draftBase(game).then((b) => { if (live) setBase(b); }, () => { if (live) setBase(null); }); return () => { live = false; }; }, [game, draft?.baseVersion]);
  const maintainer = me?.maintainer === true;
  const list = draft ? tasks(draft.body) : [];
  const anyNew = draft ? list.some((t) => draft.bases[`tasks/${t.id}`] === undefined) : false;
  const suggested = draft ? suggest(draft.baseVersion, anyNew) : null;
  useEffect(() => { if (suggested && !version) { setVersion(suggested); setSettled(suggested); } }, [suggested]); // eslint-disable-line react-hooks/exhaustive-deps
  const minApp = draft ? requiredMinApp(draft.body) : "0.4.0";
  // The preview runs by itself (a dry run of the publish), again when the version or the draft changes.
  const isVersion = (v: string) => /^v?[0-9]+(\.[0-9]+){1,3}$/.test(v.trim());
  const validVersion = isVersion(version);
  const previewed = isVersion(settled);
  useEffect(() => {
    if (!draft || !maintainer || !previewed) { setPlan(null); return; }
    let live = true;
    const t = setTimeout(() => {
      setPlan(null);
      dev.publish(game, { version: settled.trim(), changelog: changelog.trim() || "预演", minApp, dryRun: true })
        .then((r) => { if (live) setPlan(r); }, (e) => { if (live) setPlan(failure(e)); });
    }, 300);
    return () => { live = false; clearTimeout(t); };
  }, [draft?.revision, settled, maintainer, minApp, game]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!draft) return null;

  const rows = list.map((t) => standing(t, draft.body, draft.bases, digests, trials.find((x) => x.task === t.id), data.devices));
  const untried = rows.filter((s) => s.changed && s.tone !== "pass");
  const unsavedKeys = Object.keys(edits);
  const unsaved = unsavedKeys.length;
  const scriptName = (k: string) => {
    if (k.startsWith("snippet:")) return `片段 ${k.slice(8)}`;
    const [tid, sid] = k.slice(5).split("/");
    return locate(`target/${game}/task/${tid}/step/${sid}`, draft.body)?.label ?? k;
  };
  const saveAll = async () => {
    setSaving(true); setSaveText(null);
    const problems: string[] = [];
    for (const k of unsavedKeys) {
      if (conflicts.includes(k)) { problems.push(`${scriptName(k)}：别处改过，去那里选用哪边`); continue; }
      const problem = await saveScript(k);
      if (problem) problems.push(`${scriptName(k)}：${problem}`);
    }
    setSaving(false);
    setSaveText(problems.length ? problems.join("；") : "已保存");
    if (!problems.length) setTimeout(() => setSaveText((t) => (t === "已保存" ? null : t)), 2000);
  };
  const why = minApp === "0.7.0" ? "用了步骤配置" : minApp === "0.4.2" ? "有预设计划" : "工作台基础";
  const checks: Check[] = [
    { ok: unsaved === 0, title: unsaved ? `全部保存 · ${unsaved} 处没保存` : "全部保存" },
    check ? { ok: check.ok, title: check.ok ? "结构与类型" : `结构与类型 · ${check.issues.length} 个问题` }
      : { ok: checkText && !checkText.endsWith(RETRYING) ? false : null, title: checkText ? `结构与类型 · ${checkText}` : "结构与类型 · 检查中…" },
    untried.length ? { ok: false, title: `改过的任务都试跑通过 · ${untried.length} 个没过` } : { ok: true, title: "改过的任务都试跑通过" },
    { ok: true, title: `最低 App ${minApp}（${why}）` },
  ];
  const failed = checks.filter((c) => c.ok === false).length;
  const changes = changesOf(draft.body, base ?? null, draft.bases, digests, game);
  const kb = (n: number) => `${Math.max(1, Math.round(n / 1024))} KB`;
  const publish = async () => {
    confirmBox.current?.close();
    setBusy(true); setText(null);
    try {
      const done = await dev.publish(game, { version: version.trim(), changelog: changelog.trim(), minApp, dryRun: false });
      await reload();
      setText([`已发布 ${done.version}${done.commitSha ? ` · 提交 ${done.commitSha.slice(0, 7)}` : ""}`, true]);
    } catch (error) { setText([failure(error), false]); }
    setBusy(false);
  };
  const stale = version.trim() !== settled.trim();
  const label = !maintainer ? "只有维护者能发布" : failed ? `发布（${failed} 项没过）` : !check ? "检查中…" : busy ? "发布中…" : !changelog.trim() ? "先写更新说明" : `发布 ${version.trim()}`;
  const both = bothChanged(syncResult);
  /** A check's issue under its row: where, why, and a way there. */
  const issueRow = (i: CheckIssue, k: string, warn = false) => {
    const place = placeOf(i.where, draft.body) ?? locate(i.location, draft.body);
    return <div key={k} className={`${p.row} ${warn ? p.warn : p.issue}`}><span className={p.mark} />
      <span className={p.grow}>{place ? `${place.label}：` : ""}{i.reason}</span>{place && <Link to={place.to} className={p.link}>去改 ›</Link>}</div>;
  };
  return (
    <>
      <h1 className={p.title}>发布 {version.trim() || ""}</h1>
      <div className={p.layout}>
        <div className={p.left}>
          <section className={w.card} aria-labelledby="ck">
            <div className={p.head}><b id="ck" className={p.grow}>检查</b>
              <SyncTools changed={rows.filter((r) => r.changed).length} onDone={(said, result) => { setSynced(said); setSyncResult(result ?? null); }} /></div>
            <RepoAheadRow changed={rows.filter((r) => r.changed).length} onDone={(said, result) => { setSynced(said); setSyncResult(result ?? null); }} />
            {syncResult ? <div className={p.row}><SyncReport result={syncResult} body={draft.body} onUndone={(said) => { if (said[1]) { setSyncResult(null); setSynced(said); } }} /></div>
              : synced && <div role="status" className={`${p.row} ${synced[1] ? `${w.muted} ${w.okText}` : w.message}`}>{synced[0]}</div>}
            {checks.map((c, i) => <div key={i}>
              <div className={p.row}>
                <span className={p.mark} data-ok={c.ok === null ? "wait" : String(c.ok)} aria-hidden="true">{c.ok === null ? "…" : c.ok ? "✓" : "✗"}</span>
                <span className={p.grow}>{c.title}</span>
                {c.link && <Link to={c.link[0]} className={p.link}>{c.link[1]}</Link>}
                {i === 0 && unsaved > 0 && <button type="button" className={`${w.btn} ${w.sm}`} disabled={saving} onClick={() => void saveAll()}>{saving ? "保存中…" : "全部保存"}</button>}
              </div>
              {i === 0 && unsavedKeys.map((k) => <div key={k} className={`${p.row} ${p.issue}`}><span className={p.mark} />
                <span className={p.grow}>{scriptName(k)}{conflicts.includes(k) ? " · 冲突" : ""}</span><Link to={scriptPath(k)} className={p.link}>去看 ›</Link></div>)}
              {i === 0 && saveText && <div className={`${p.row} ${saveText === "已保存" ? w.muted : w.message}`}>{saveText}</div>}
              {i === 1 && check && !check.ok && (allIssues ? check.issues : check.issues.slice(0, 5)).map((x, k) => issueRow(x, `i${k}`))}
              {i === 1 && check && check.issues.length > 5 && <div className={`${p.row} ${p.issue}`}><span className={p.mark} />
                <button type="button" className={p.link} onClick={() => setAllIssues(!allIssues)}>{allIssues ? "收起" : `其余 ${check.issues.length - 5} 处 ›`}</button></div>}
              {i === 1 && check && (check.warnings?.length ?? 0) > 0 && <>
                <div className={`${p.row} ${p.warn}`}><span className={p.mark} data-ok="wait" aria-hidden="true">!</span><span className={p.grow}>提醒 {check.warnings!.length} 条 · 不挡发布</span></div>
                {check.warnings!.map((x, k) => issueRow(x, `w${k}`, true))}
              </>}
              {i === 2 && untried.map((r) => <div key={r.task.id} className={`${p.row} ${p.issue}`}><span className={p.mark} />
                <span className={p.grow}>{r.task.name} · {r.label}</span><Link to={`${wbPaths.task(r.task.id)}?scope=task`} className={p.link}>整任务试跑 ›</Link></div>)}
            </div>)}
          </section>
          <section className={w.card} aria-labelledby="ch">
            <div className={p.head}><b id="ch" className={p.grow}>改动</b><span className={w.muted}>对比 {draft.baseVersion || "上个版本"}</span></div>
            {changes.map((c) => (
              <div key={c.key}>
                <div className={p.row}>
                  <span className={p.grow}>{c.name}{both.has(c.key) && <span className={w.both} title="仓库也改了它，留的是你的"> 两边都改</span>}</span><span className={w.muted}>{c.summary}</span>
                  {c.diffs.length > 0 && <button type="button" className={p.link} aria-expanded={open === c.key} onClick={() => setOpen(open === c.key ? null : c.key)}>差异 {open === c.key ? "▾" : "›"}</button>}
                </div>
                {open === c.key && c.diffs.map((d) => (
                  <div key={d.label} className={p.diff}>
                    <div className={p.diffHead}>{d.label}</div>
                    {d.lines.filter((l, i, all) => l.kind !== "same" || all.slice(Math.max(0, i - 2), i + 3).some((x) => x.kind !== "same")).map((l, i) => (
                      <div key={i} className={p.diffLine} data-kind={l.kind}><span className={p.ln}>{l.kind === "add" ? l.b : l.a}</span><span>{l.kind === "add" ? "+" : l.kind === "del" ? "−" : " "} {l.text}</span></div>
                    ))}
                  </div>
                ))}
              </div>
            ))}
            {!changes.length && <div className={`${p.row} ${w.muted}`}>没有改动</div>}
            {base === null && changes.length > 0 && <div className={`${p.row} ${w.muted}`}>服务器没给上个版本的内容，只能看哪些改过</div>}
          </section>
        </div>
        <section className={`${w.card} ${p.right}`} aria-label="版本">
          <label className={p.lbl} htmlFor="v">版本</label>
          <input id="v" className={`${p.input} ${p.mono}`} value={version} placeholder="v1.2.0" onChange={(e) => setVersion(e.target.value)}
            onBlur={() => setSettled(version)} onKeyDown={(e) => { if (e.key === "Enter") setSettled(version); }} />
          {suggested && <span className={w.muted}>建议 {suggested}：{anyNew ? "有新任务，升次版本" : "没有新任务，升补丁"}</span>}
          <label className={p.lbl} htmlFor="n">更新说明</label>
          <textarea id="n" className={p.input} rows={4} value={changelog} onChange={(e) => setChangelog(e.target.value)} />
          <div className={p.plan}>{!maintainer ? "需要任务仓库的写权限" : !validVersion ? "版本号形如 v1.2.0" : version.trim() !== settled.trim() ? "填好版本号后预演" : plan === null ? "预演中…"
            : typeof plan === "string" ? <span className={w.message}>预演：<Located text={plan} body={draft.body} /></span>
            : `预演：包 ${kb(plan.bundleBytes)} · 上传 ${plan.uploads.length} 张图 ${kb(plan.uploadBytes)} · 复用 ${plan.reused.length}`}</div>
          <div className={p.confirm}>
            <button type="button" className={`${w.btn} ${w.primary} ${p.center}`}
              disabled={!maintainer || failed > 0 || !check || busy || !validVersion || stale || !changelog.trim() || typeof plan === "string"} onClick={() => confirmBox.current?.showModal()}>{label}</button>
          </div>
          <dialog ref={confirmBox} className={p.dialog} aria-labelledby="pubTitle">
            <b id="pubTitle" className={p.dialogTitle}>发布 {version.trim()}？</b>
            <div className={p.dialogPart}><span className={p.lbl}>改了</span>
              {changes.length ? <ul className={p.dialogList}>{changes.slice(0, 6).map((c) => <li key={c.key}>{c.name}<span className={w.muted}> · {c.summary}</span></li>)}
                {changes.length > 6 && <li className={w.muted}>等 {changes.length} 项</li>}</ul> : <span className={w.muted}>没有改动</span>}</div>
            <div className={p.dialogPart}><span className={p.lbl}>谁会拿到</span><span>App ≥ {minApp} 的玩家，下次更新任务时拿到</span></div>
            {changelog.trim() && <div className={p.dialogPart}><span className={p.lbl}>更新说明</span><span className={p.notes}>{changelog.trim()}</span></div>}
            <div className={p.dialogRow}>
              <button type="button" className={w.btn} onClick={() => confirmBox.current?.close()}>取消</button>
              <button type="button" className={`${w.btn} ${w.primary}`} onClick={() => void publish()}>发布</button>
            </div>
          </dialog>
          {text && <div role="status" className={text[1] ? p.done : w.message}>{text[1] ? text[0] : <Located text={text[0]} body={draft.body} />}</div>}
        </section>
      </div>
    </>
  );
}

/** 仓库有新任务 as a row of the checks, only when it says something. */
function RepoAheadRow(props: Parameters<typeof RepoAhead>[0]) {
  return <div className={p.rowWrap}><RepoAhead {...props} /></div>;
}

/** The next version after [last]: a minor step when a task is new, else a patch. */
function suggest(last: string, minor: boolean): string | null {
  const m = /^v?(\d+)\.(\d+)(?:\.(\d+))?/.exec(last.trim());
  if (!m) return null;
  const [maj, min, pat] = [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)];
  return minor ? `v${maj}.${min + 1}.0` : `v${maj}.${min}.${pat + 1}`;
}

/**
 * What changed since the base, by node digest (`bases` against the digests now). With the base's own content, each
 * task says which steps changed by how many lines (with the line diff) and how many settings were added.
 */
function changesOf(body: Obj, base: Obj | null, bases: Record<string, string>, digests: Record<string, string>, game: string): Change[] {
  const out: Change[] = [];
  const baseTasks = base ? tasks(base) : [];
  for (const t of tasks(body)) {
    const key = `tasks/${t.id}`;
    if (bases[key] === undefined) { out.push({ key, name: t.name, summary: "新任务", diffs: [] }); continue; }
    if (digests[key] === undefined || digests[key] === bases[key]) continue;
    const old = baseTasks.find((x) => x.id === t.id);
    if (!old) { out.push({ key, name: t.name, summary: "改过", diffs: [] }); continue; }
    const parts: string[] = []; const diffs: Change["diffs"] = [];
    t.steps.forEach((st, i) => {
      const was = old.steps.find((x) => x.id === st.id);
      const label = `步骤 ${i + 1}${str(st.name) ? ` ${str(st.name)}` : ""}`;
      if (!was) { parts.push(`${label} 新`); diffs.push({ label, lines: lineDiff("", str(st.script) ?? "") }); return; }
      const a = str(was.script) ?? JSON.stringify(was.program ?? was.actions ?? null, null, 1), b = str(st.script) ?? JSON.stringify(st.program ?? st.actions ?? null, null, 1);
      if (a === b) { if (JSON.stringify(was) !== JSON.stringify(st)) parts.push(`${label} 属性`); return; }
      const lines = lineDiff(a, b); parts.push(`${label} 改 ${changedLines(lines)} 行`); diffs.push({ label, lines });
    });
    const gone = old.steps.filter((x) => !t.steps.some((s) => s.id === x.id)).length;
    if (gone) parts.push(`删 ${gone} 步`);
    const addedFields = t.fields.filter((f) => !old.fields.some((x) => x.id === f.id)).length;
    const removedFields = old.fields.filter((f) => !t.fields.some((x) => x.id === f.id)).length;
    const editedFields = t.fields.filter((f) => { const x = old.fields.find((o) => o.id === f.id); return x && JSON.stringify(x) !== JSON.stringify(f); }).length;
    if (addedFields || removedFields || editedFields) parts.push(`配置 ${[addedFields && `+${addedFields}`, removedFields && `−${removedFields}`, editedFields && `改 ${editedFields}`].filter(Boolean).join(" ")}`);
    out.push({ key, name: t.name, summary: parts.join(" · ") || "任务属性", diffs });
  }
  for (const k of Object.keys(bases)) if (k.startsWith("tasks/") && !tasks(body).some((t) => `tasks/${t.id}` === k)) out.push({ key: k, name: k.slice(6), summary: "删除", diffs: [] });
  for (const sn of snippets(body)) {
    const key = `snippets/${String(sn.id)}`;
    if (digests[key] !== undefined && digests[key] === bases[key]) continue;
    if (digests[key] === undefined) continue;
    const was = base ? snippets(base).find((x) => x.id === sn.id) : undefined;
    const name = `片段 ${str(sn.name) ?? String(sn.id)}`;
    if (bases[key] === undefined) { out.push({ key, name, summary: "新片段", diffs: [] }); continue; }
    if (!was) { out.push({ key, name, summary: "改过", diffs: [] }); continue; }
    const lines = lineDiff(str(was.script) ?? "", str(sn.script) ?? "");
    out.push({ key, name, summary: `改 ${changedLines(lines)} 行`, diffs: [{ label: name, lines }] });
  }
  // 素材: templates by the resources' ids in the base; colour sets from the base's game when it is to hand.
  const resIds = objs(body.resources).map((r) => String(r.id));
  const addedRes = resIds.filter((id) => bases[`resources/${id}`] === undefined).length;
  const removedRes = Object.keys(bases).filter((k) => k.startsWith("resources/") && !resIds.includes(k.slice(10))).length;
  const assets: string[] = [];
  if (addedRes || removedRes) assets.push(`模板 ${[addedRes && `+${addedRes}`, removedRes && `−${removedRes}`].filter(Boolean).join(" ")}`);
  const colorsOf = (b: Obj) => { const lib = target(b, game)?.library; return isObj(lib) && isObj(lib.colors) ? Object.keys(lib.colors) : []; };
  const gameChanged = digests[`targets/${game}`] !== undefined && bases[`targets/${game}`] !== undefined && digests[`targets/${game}`] !== bases[`targets/${game}`];
  if (base) {
    const now = colorsOf(body), was = colorsOf(base);
    const a = now.filter((x) => !was.includes(x)).length, r = was.filter((x) => !now.includes(x)).length;
    if (a || r) assets.push(`取色组 ${[a && `+${a}`, r && `−${r}`].filter(Boolean).join(" ")}`);
  }
  if (assets.length) out.push({ key: "assets", name: "素材", summary: assets.join(" · "), diffs: [] });
  if (gameChanged) out.push({ key: "game", name: "游戏与页面", summary: "改过", diffs: [] });
  return out;
}
