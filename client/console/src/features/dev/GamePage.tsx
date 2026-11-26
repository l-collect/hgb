import { useEffect, useState } from "react";
import type { Obj, Sample } from "./api";
import { useDev } from "./context";
import { arr, isObj, nodeDigest, objs, programOf, snippets, str, target, tasks } from "./model";
import { Fallbacks } from "./PageGraph";
import { ratio } from "./StatesPage";
import w from "./Wb.module.css";
import g from "./Game.module.css";

const IDENTITY: Record<string, string> = { NONE: "不分账号", OPTIONAL: "可分账号", REQUIRED: "必分账号" };

/** The 游戏 card on top of 页面: the target app, how its screens are read, the account policy and generic close fallbacks. */
export function GameCard({ samples }: { samples: Sample[] }) {
  const { draft, game, gameName, apply } = useDev();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState<[string, boolean] | null>(null);
  const app = draft ? target(draft.body, game) : undefined;
  const appName = str(app?.name) ?? "";
  const appPackages = arr(app?.androidPackages).join("、");
  const [name, setName] = useState(appName);
  const [packages, setPackages] = useState(appPackages);
  useEffect(() => { setName(appName); setPackages(appPackages); }, [appName, appPackages]);
  if (!draft || !app) return <div className={`${w.card} ${g.card}`}><div className={w.muted}>草稿里没有这个游戏</div></div>;
  const profile = objs(draft.body.visionProfiles).find((v) => v.targetId === game);
  const size = referenceSize(draft.body, game);
  const ratios = Object.entries(samples.reduce<Record<string, number>>((m, x) => { const k = ratio(x.width, x.height); m[k] = (m[k] ?? 0) + 1; return m; }, {}));
  const library = isObj(app.library) ? app.library : {};
  const fallbacks = arr(library.fallbacks).length;
  const save = async () => {
    const list = packages.split(/[、,，\s]+/).map((x) => x.trim()).filter(Boolean);
    const problem = await apply(async (body) => {
      const now = target(body, game);
      if (!now || (name.trim() === str(now.name) && list.join() === arr(now.androidPackages).join())) return [];
      return [{ op: "put", path: `targets:${game}`, expect: await nodeDigest(now), value: { ...now, name: name.trim(), androidPackages: list } }];
    });
    setText(problem ? [problem, false] : ["已保存", true]);
  };
  return (
    <section className={`${w.card} ${g.card}`} aria-label="游戏">
      <button type="button" className={g.summary} aria-expanded={open} onClick={() => setOpen(!open)}>
        <b>游戏 · {gameName}</b>
        <span className={`${w.muted} ${g.grow} ${g.clip}`}>{appPackages || "没写包名"} · 参考 {size ?? "—"} · 模型 {str(profile?.recognizer) ?? "无"} · {IDENTITY[str(app.identityPolicy) ?? ""] ?? str(app.identityPolicy) ?? "—"} · 兜底 {fallbacks}</span>
        <span className={w.muted}>{open ? "收起" : "展开"}</span>
      </button>
      {open && <>
        <div className={g.pair}>
          <div className={g.f} style={{ flex: "1 1 140px" }}><label htmlFor="gn">名称</label><input id="gn" value={name} onChange={(e) => setName(e.target.value)} onBlur={save} /></div>
          <div className={g.f} style={{ flex: "2 1 220px" }}><label htmlFor="gp">包名（分身用顿号分开）</label><input id="gp" value={packages} onChange={(e) => setPackages(e.target.value)} onBlur={save} /></div>
        </div>
        <div className={g.pair}><span className={w.muted}>样本比例</span>
          {ratios.length ? ratios.map(([k, n]) => <span key={k} className={`${w.chip} ${n > 1 ? w.pass : w.none}`}>{k} · {n}</span>) : <span className={w.muted}>没有样本</span>}</div>
        <Fallbacks />
        {text && <div className={text[1] ? `${w.muted} ${w.okText}` : w.message}>{text[0]}</div>}
      </>}
    </section>
  );
}

/** The reference size from library defaults, or from actions, or 2400 × 1080 when scripts are present. */
function referenceSize(body: Obj, gameId: string): string | null {
  const app = target(body, gameId);
  const lib = isObj(app?.library) ? app.library : undefined;
  const defs = isObj(lib?.defaults) ? lib.defaults : undefined;
  const star = isObj(defs?.["*"]) ? defs["*"] : undefined;
  if (typeof star?.referenceWidth === "number" && typeof star?.referenceHeight === "number") {
    return `${star.referenceWidth} × ${star.referenceHeight}`;
  }
  const count: Record<string, number> = {};
  const walk = (program: Obj[]) => program.forEach((node) => {
    const a = isObj(node.action) ? node.action : null;
    const inputs = a && isObj(a.inputs) ? a.inputs : null;
    if (inputs && typeof inputs.referenceWidth === "number") { const k = `${inputs.referenceWidth} × ${inputs.referenceHeight}`; count[k] = (count[k] ?? 0) + 1; }
    for (const v of Object.values(node)) if (Array.isArray(v)) walk(objs(v));
    for (const c of objs(node.cases)) walk(objs(c.program));
  });
  for (const t of tasks(body)) for (const st of t.steps) walk(programOf(st));
  for (const sn of snippets(body)) walk(programOf(sn));
  const fromProg = Object.entries(count).sort((a, b) => b[1] - a[1])[0]?.[0];
  if (fromProg) return fromProg;
  const hasScript = tasks(body).some((t) => t.steps.some((st) => typeof st.script === "string")) || snippets(body).some((sn) => typeof sn.script === "string");
  return hasScript ? "2400 × 1080" : null;
}

