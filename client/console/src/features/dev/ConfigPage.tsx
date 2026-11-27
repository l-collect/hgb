import { useEffect, useState } from "react";
import { Link, navigate, useQuery } from "../../router";
import { dev, type SettingUse } from "./api";
import { devPaths, useDev } from "./context";
import { snippets, str, tasks } from "./model";
import { placeText, typeName } from "./config/fields";
import { ConfigForm } from "./config/ConfigForm";
import { NewConfigDialog } from "./config/NewConfigDialog";
import { PlayerPreview } from "./config/Preview";
import { useTestValues } from "./config/testValues";
import { findUses, standingOf } from "./config/UsesView";
import { wbPaths } from "./wb";
import w from "./Wb.module.css";
import c from "./Config.module.css";

export { findUses } from "./config/UsesView";

/** 配置项 (v7 V7WbConfig): fields | the selected one's whole form (config/ConfigForm) | what the player sees, with the test values a trial takes. */
export function ConfigPage({ id }: { id: string }) {
  const { draft } = useDev();
  const [pick, setPick] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  // ?field=<id> (the editor's 去配置项) opens on that setting.
  const wanted = useQuery().get("field");
  useEffect(() => { if (wanted) setPick(wanted); }, [wanted]);
  const test = useTestValues(id);
  const task = draft ? tasks(draft.body).find((x) => x.id === id) : undefined;
  // Where the server's check says each setting is read (it compiles the scripts, so it sees every {x}); null until it
  // answers, or when it is an older server: then the scripts are read here.
  const [served, setServed] = useState<SettingUse[] | null>(null);
  const body = draft?.body;
  useEffect(() => {
    setServed(null);
    if (!body || !task) return;
    let live = true;
    const timer = setTimeout(() => {
      dev.check({ bundle: body, task: id, measure: false }).then((r) => { if (live) setServed(r.settingUses ?? null); }, () => undefined);
    }, 400);
    return () => { live = false; clearTimeout(timer); };
  }, [body, id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!draft || !task) return <div className={w.card}><div className={w.empty}>草稿里没有这个任务</div></div>;
  const fields = task.fields;
  const current = fields.find((x) => String(x.id) === pick) ?? fields[0];
  const lib = snippets(draft.body);
  return (
    <>
      <header className={c.header}>
        <Link to={devPaths.task(id)} className={c.back}>← {task.name}</Link>
        <h1 className={c.title}>配置项</h1>
        <button type="button" className={w.btn} onClick={() => setAdding(true)}>＋ 配置项</button>
      </header>
      <div className={c.layout}>
        <nav aria-label="配置项" className={`${w.card} ${c.nav}`}>
          {fields.map((x) => { const tone = standingOf(x, fields, findUses(task.raw, task.steps, lib, String(x.id), id, served));
            return <button key={String(x.id)} type="button" className={c.field} aria-current={x === current ? "true" : undefined} style={{ paddingLeft: x.visibleWhen ? 22 : undefined }} onClick={() => setPick(String(x.id))}>
              <b className={c.name}>{str(x.label)}{tone && <span className={c.flag} data-tone={tone} aria-label={tone === "bad" ? "用法有错" : "有没处理的值"} />}</b>
              <span className={w.muted}>{placeText(x, task.steps)} · {typeName(x.widget)}</span>
            </button>; })}
          {!fields.length && <div className={w.empty}>还没有</div>}
        </nav>

        {current ? <ConfigForm key={String(current.id)} inline taskId={id} fieldId={String(current.id)} onSaved={(next) => setPick(next)} onDeleted={() => setPick(null)} />
          : <section className={`${w.card} ${c.form}`}><div className={w.empty}>还没有配置项</div></section>}

        <aside aria-label="玩家看到的" className={c.aside}>
          <span className={w.muted}>玩家看到的（按测试值）</span>
          <div className={`${w.card} ${c.preview}`}>
            <PlayerPreview fields={fields} steps={task.steps} values={test.values} onChange={(fid, v) => test.set(fid, v)} />
          </div>
          {Object.keys(test.own).length > 0 && <button type="button" className={`${w.btn} ${w.sm}`} onClick={test.reset}>测试值都改回默认</button>}
          <button type="button" className={`${w.btn} ${w.primary} ${c.center}`} onClick={() => navigate(`${wbPaths.task(id)}?values=${encodeURIComponent(JSON.stringify(test.trial))}`)}>带回试跑</button>
        </aside>
      </div>
      {adding && <NewConfigDialog taskId={id} onDone={(fid) => { setAdding(false); if (fid) setPick(fid); }} />}
    </>
  );
}
