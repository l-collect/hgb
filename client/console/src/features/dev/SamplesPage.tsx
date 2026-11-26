import { useEffect, useRef, useState, type PointerEvent } from "react";
import { ask } from "../../components/Confirm";
import { Chips, SegmentTabs, Stepper } from "../../components/ui";
import { navigate } from "../../router";
import { dev, follow, type Sample, type Template } from "./api";
import { failure, useDev } from "./context";
import { clock } from "./HomePage";
import { isObj, nodeDigest, resources, snippets, str, target, tasks } from "./model";
import { pixelsOf, colorAt, colorLine, validSetName, worstOf, type ColorAnchor, type ColorPick } from "./colors";
import { useDevice, useInsert, wbPaths } from "./wb";
import { useDevRun } from "./events";
import { ConditionOut, type CondKind } from "./sentence";
import w from "./Wb.module.css";
import m from "./Samples.module.css";

type Kind = "samples" | "templates" | "colors";
type Tool = "region" | "template" | "color" | "offset" | "private";
const TOOLS: [Tool, string][] = [["region", "框区域"], ["template", "裁模板"], ["color", "取色"], ["offset", "量偏移"], ["private", "打码"]];
const ANCHORS: [ColorAnchor, string][] = [["auto", "自动"], ["left", "贴左"], ["center", "居中"], ["right", "贴右"]];
const ANCHOR_PREFIX: Record<ColorAnchor, string> = { auto: "", left: "左:", center: "中:", right: "右:" };
const overlaps = (a: number[], b: number[]) => a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3];
/** Where a sample of another size puts what is at x on [ref]: scaled by height, docked as the anchor says (ScreenLayout). */
const shiftsOf = (ref: Sample, other: Sample, anchor: ColorAnchor) => {
  const s = other.height / Math.max(1, ref.height); const dW = other.width - ref.width * s;
  const all = anchor === "left" ? [0] : anchor === "center" ? [dW / 2] : anchor === "right" ? [dW] : Math.abs(dW) < 1 ? [0] : [dW / 2, 0, dW];
  return { s, shifts: all };
};
type Verdict = { id: string; name: string; hit: boolean | null; worst?: number | null };
/** At least half of [t] lies inside [r], as the server judges a recognized text inside a region (Judge.textSeen). */
const halfInside = (t: number[], r: number[]) => {
  const [x, y, w, h] = t;
  const ix = Math.max(0, Math.min(x + w, r[0] + r[2]) - Math.max(x, r[0])), iy = Math.max(0, Math.min(y + h, r[1] + r[3]) - Math.max(y, r[1]));
  return w > 0 && h > 0 && 2 * ix * iy >= w * h;
};
/** TextCondition.matches for a script's `"字"@区域` (contains, within a region): the text in the line, or fuzzyContains. */
const textMatches = (line: string, text: string) => line.includes(text) || (text.length >= 3 && fuzzyContains(line, text));
/** core fuzzyContains: at least 3/4 (and all but one) of [target]'s characters in order inside a span of its length + 1. */
function fuzzyContains(line: string, target: string): boolean {
  const a = Array.from(line), b = Array.from(target);
  if (b.length < 3 || a.length < b.length - 1) return false;
  const least = Math.max(Math.ceil(b.length * 0.75), b.length - 1);
  for (let start = 0; start < a.length; start++) {
    let matched = 0, ti = 0;
    const limit = Math.min(start + b.length + 1, a.length);
    for (let li = start; li < limit && ti < b.length; li++) {
      const idx = b.indexOf(a[li], ti);
      if (idx >= 0 && idx - ti <= 1) { matched++; ti = idx + 1; }
    }
    if (matched >= least) return true;
  }
  return false;
}

/** 素材: samples, templates and colour sets; on a sample the tools make a condition, checked on every sample, then 插到 the line. */
export function SamplesPage({ id }: { id?: string }) {
  const { game, draft, apply, me } = useDev();
  const phone = useDevice();
  const insert = useInsert();
  const [kind, setKind] = useState<Kind>("samples");
  const [list, setList] = useState<Sample[] | null>(null);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [tool, setTool] = useState<Tool>("region");
  const [showTexts, setShowTexts] = useState(true);
  const [rect, setRect] = useState<number[] | null>(null);
  const [points, setPoints] = useState<[number, number][]>([]);
  const [anchor, setAnchor] = useState<ColorAnchor>("auto");
  const [made, setMade] = useState<Template | null>(null);
  const [text, setText] = useState<[string, boolean] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [picks, setPicks] = useState<ColorPick[]>([]);
  const [tolerance, setTolerance] = useState(24);
  const [tried, setTried] = useState<Verdict[] | null>(null);
  const [pickedTemplate, setPickedTemplate] = useState<string | null>(null);
  const [pickedSet, setPickedSet] = useState<string | null>(null);
  const [setName, setSetName] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const start = useRef<[number, number] | null>(null);
  const load = () => Promise.all([dev.samples(game).then(setList), dev.templates(game).then(setTemplates)]).catch((e) => setText([failure(e), false]));
  useEffect(() => { void load(); }, [game]); // eslint-disable-line react-hooks/exhaustive-deps
  // A sample taken (or read) on the phone shows up here as soon as it is stored.
  useDevRun((run) => {
    if ((run.kind === "sample" || run.kind === "recognize") && run.target === game && run.state === "FINISHED") void load();
  }, [game]);
  // Verifications are numbered: one still running when the sample, tool, box or points change is dropped when it ends.
  const verifies = useRef(0);
  const dropVerify = () => { verifies.current++; setTried(null); setBusy((b) => (b === "verify" ? null : b)); };
  useEffect(() => { setRect(null); setPoints([]); setMade(null); dropVerify(); }, [id]);
  useEffect(() => { setPoints([]); setMade(null); dropVerify(); if (tool !== "color") setPicks([]); }, [tool]);
  useEffect(() => { dropVerify(); }, [rect, picks, tolerance, anchor]);
  const sample = list?.find((x) => x.id === id) ?? list?.[0];
  const keep = insert?.keep ?? "";
  const open = (sid: string) => navigate(wbPaths.asset(sid) + keep);
  const colorSets = draft ? setsOf(draft.body, game) : {};
  const copy = (value: string) => { void navigator.clipboard?.writeText(value); setText([`已复制 ${value}`, true]); };

  const takeOne = async () => {
    if (!phone?.online) { setText(["当前手机不在线", false]); return; }
    setBusy("sample"); setText(null);
    try {
      const run = await dev.startRun({ kind: "sample", target: game, device: phone.id, name: "样本" });
      const done = await follow(run.id, () => {});
      if (done.state === "FINISHED") { await load(); setText(["已采到一张", true]); } else setText([done.detail || "没采到", false]);
    } catch (error) { setText([failure(error), false]); }
    setBusy(null);
  };
  const upload = async (file: File) => {
    setText(null);
    let made: Sample;
    try { made = await dev.uploadSample(game, file); await load(); open(made.id); }
    catch (error) { setText([failure(error), false]); return; }
    if (!me?.serverRecognizer) { setText(["已上传 · 识别后才能裁模板", true]); return; }
    setBusy("read"); setText(["识别中…", true]);
    try { const read = await dev.recognizeSample(made.id); await load(); setText([`已上传 · 读到 ${read.texts.length} 处字`, true]); }
    catch (error) { setText([`识别没成：${failure(error)}`, false]); }
    setBusy(null);
  };
  const recognize = async (s: Sample) => {
    setBusy("read"); setText(null);
    try {
      if (me?.serverRecognizer) { const read = await dev.recognizeSample(s.id); setText([`读到 ${read.texts.length} 处字`, true]); }
      else {
        if (!phone?.online) { setText(["当前手机不在线", false]); setBusy(null); return; }
        const done = await follow((await dev.startRun({ kind: "recognize", target: game, device: phone.id, sample: s.id })).id, () => {});
        setText(done.state === "FINISHED" ? [done.detail || "已识别", true] : [done.detail || "没识别成", false]);
      }
      await load();
    } catch (error) { setText([failure(error), false]); }
    setBusy(null);
  };

  /** Adds or replaces the template in the draft's resources. */
  const addToDraft = async (t: Template) => {
    if (!draft) return;
    const entry = { id: t.id, assetName: t.assetName, bytes: t.bytes, sha256: t.sha256 };
    const problem = await apply(async (body) => {
      const old = resources(body).find((r) => r.id === t.id);
      return [old ? { op: "put", path: `resources:${t.id}`, expect: await nodeDigest(old), value: entry } : { op: "insert", path: "", field: "resources", value: entry }];
    });
    setText(problem ? [problem, false] : [`已存模板 ${t.id}`, true]);
  };
  const deleteTemplate = async (t: Template) => {
    if (!await ask({ title: `删除模板 ${t.id}？`, ok: "删除", danger: true })) return;
    try {
      await dev.deleteTemplate(game, t.id);
      const problem = await apply(async (body) => {
        const old = resources(body).find((r) => r.id === t.id);
        return old ? [{ op: "delete", path: `resources:${t.id}`, expect: await nodeDigest(old) }] : [];
      });
      if (made?.id === t.id) setMade(null);
      setPickedTemplate(null); await load();
      setText(problem ? [problem, false] : [`已删除 ${t.id}`, true]);
    } catch (error) { setText([failure(error), false]); }
  };
  /** Changes the game's colour sets as the latest draft has them; [edit] null leaves them. */
  const changeSets = async (edit: (old: Record<string, string[]>) => Record<string, string[]> | null) => {
    let missing = false;
    const problem = await apply(async (body) => {
      const now = target(body, game);
      if (!now) { missing = true; return []; }
      const library = isObj(now.library) ? now.library : {};
      const next = edit(setsOf(body, game));
      if (!next) return [];
      return [{ op: "put", path: `targets:${game}`, expect: await nodeDigest(now), value: { ...now, library: { ...library, colors: next } } }];
    });
    return problem ?? (missing ? "草稿里没有这个游戏" : null);
  };

  const left = (
    <nav aria-label="素材" className={m.list}>
      <SegmentTabs label="素材种类" value={kind} onChange={setKind}
        items={[["samples", `样本 ${list?.length ?? 0}`], ["templates", `模板 ${templates.length}`], ["colors", `取色组 ${Object.keys(colorSets).length}`]]} />
      {kind === "samples" && <div className={m.buttons}>
        <button type="button" className={`${w.btn} ${w.primary}`} disabled={!!busy} onClick={takeOne}>{busy === "sample" ? "等手机…" : "手机采一张"}</button>
        <label className={w.btn}>上传<input type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void upload(f); }} /></label>
      </div>}
      <div className={`${w.card} ${m.rows}`}>
        {kind === "samples" && (list?.length ? list.map((x) => (
          <button key={x.id} type="button" className={m.item} aria-current={x.id === sample?.id ? "true" : undefined} onClick={() => open(x.id)}>
            <img className={m.thumb} src={dev.sampleImage(x.id)} alt="" loading="lazy" decoding="async" />
            <span className={m.grow}><b className={m.name}>{x.name}</b><span className={w.muted}>{clock(x.createdAt)} · {x.device || "手机"}</span></span>
          </button>)) : <div className={w.empty}>{list ? "还没有样本" : "加载中…"}</div>)}
        {kind === "templates" && (templates.length ? templates.map((t) => (
          <button key={t.id} type="button" className={m.item} aria-current={t.id === (pickedTemplate ?? templates[0]?.id) ? "true" : undefined} onClick={() => setPickedTemplate(t.id)}>
            <img className={m.tplThumb} src={dev.templateImage(game, t.id)} alt="" loading="lazy" />
            <span className={m.grow}><b className={m.name}>{t.id}</b><span className={w.muted}>{t.width}×{t.height}{inDraft(t) ? "" : " · 不在草稿"}</span></span>
          </button>)) : <div className={w.empty}>还没有模板</div>)}
        {kind === "colors" && (Object.keys(colorSets).length ? Object.entries(colorSets).map(([name, pts]) => (
          <button key={name} type="button" className={m.item} aria-current={name === (pickedSet ?? Object.keys(colorSets)[0]) ? "true" : undefined} onClick={() => setPickedSet(name)}>
            <span className={m.swatches}>{pts.slice(0, 4).map((p, i) => <span key={i} className={m.swatch} style={{ background: `#${p.split("#")[1] ?? "000"}` }} />)}</span>
            <span className={m.grow}><b className={m.name}>{name}</b><span className={w.muted}>{pts.length} 点</span></span>
          </button>)) : <div className={w.empty}>还没有取色组</div>)}
      </div>
    </nav>
  );
  const message = text && <div className={text[1] ? `${w.muted} ${w.okText}` : w.message} role="status">{text[0]}</div>;
  function inDraft(t: Template) { return draft ? resources(draft.body).some((r) => r.id === t.id && r.sha256 === t.sha256) : false; }

  if (kind === "templates") {
    const t = templates.find((x) => x.id === pickedTemplate) ?? templates[0];
    const from = t?.sample ? list?.find((x) => x.id === t.sample) : undefined;
    const cond = t ? `图 ${t.id.split("@")[0]}@${padded(t.rect, from).join(",")}` : "";
    return (
      <div className={m.layout}>{left}
        <section className={m.main} aria-label="模板">
          {message}
          {t ? <>
            <div className={m.nameRow}><b className={m.title}>{t.id}</b><span className={w.muted}>{t.width}×{t.height} · {t.bytes} 字节{from ? ` · 裁自 ${from.name}` : ""}</span></div>
            <div className={`${w.card} ${m.stage}`}>
              {from ? <div className={m.canvas}><img src={dev.sampleImage(from.id)} alt={from.name} draggable={false} />
                <div className={m.box} data-kind="template" style={pct(t.rect, from)}><span>{t.id}</span></div></div>
                : <img className={m.bigTpl} src={dev.templateImage(game, t.id)} alt={t.id} />}
            </div>
          </> : <div className={`${w.card} ${w.empty}`}>还没有模板 · 在样本上用「裁模板」</div>}
        </section>
        <aside className={m.aside} aria-label="模板操作">
          {t && <div className={`${w.card} ${m.panel}`}>
            <h2 className={m.h2}>模板</h2>
            <img className={m.made} src={dev.templateImage(game, t.id)} alt="" />
            {t.sameAs.length > 0 && <div className={w.muted}>同图：{t.sameAs.join("、")}</div>}
            <Result text={cond} kind="image" insert={insert} copy={copy} />
            <div className={m.actions}>
              {!inDraft(t) && <button type="button" className={w.btn} onClick={() => void addToDraft(t)}>入草稿</button>}
              <button type="button" className={`${w.btn} ${m.danger}`} onClick={() => void deleteTemplate(t)}>删除</button>
            </div>
          </div>}
        </aside>
      </div>
    );
  }
  if (kind === "colors") {
    const name = pickedSet && colorSets[pickedSet] ? pickedSet : Object.keys(colorSets)[0];
    return (
      <div className={m.layout}>{left}
        <section className={m.main} aria-label="取色组">
          {message}
          {name ? <ColorSetView key={name} name={name} points={colorSets[name]} used={setUses(draft?.body ?? {}, name)} insert={insert} copy={copy}
            onRename={async (next) => {
              if (!validSetName(next)) return "组名不能有空格、@、#、逗号或引号";
              const problem = await changeSets((old) => {
                if (!(name in old) || next in old) return null;
                return Object.fromEntries(Object.entries(old).map(([k, v]) => [k === name ? next : k, v]));
              });
              if (!problem) setPickedSet(next);
              return problem;
            }}
            onDelete={async () => {
              if (!await ask({ title: `删除取色组 ${name}？`, ok: "删除", danger: true })) return null;
              const problem = await changeSets((old) => { if (!(name in old)) return null; const { [name]: _, ...rest } = old; return rest; });
              if (!problem) setPickedSet(null);
              return problem;
            }} />
            : <div className={`${w.card} ${w.empty}`}>还没有取色组 · 在样本上用「取色」后「存为组」</div>}
        </section>
      </div>
    );
  }

  if (!list) return <div className={m.layout}>{left}<div className={w.empty}>正在加载…</div></div>;
  if (!sample) return <div className={m.layout}>{left}<section className={m.main}>{message}<div className={`${w.card} ${w.empty}`}>还没有样本 · 手机采一张或上传</div></section></div>;

  const scale = () => (box.current?.clientWidth ?? sample.width) / sample.width;
  const at = (event: PointerEvent<HTMLDivElement>): [number, number] => {
    const r = box.current!.getBoundingClientRect();
    return [Math.round((event.clientX - r.left) / scale()), Math.round((event.clientY - r.top) / scale())];
  };
  const drawing = tool === "region" || tool === "template" || tool === "private";
  const inside = rect ? Array.from(new Set(sample.texts.filter((t) => overlaps(t.box, rect)).map((t) => t.text))) : [];
  const mine = templates.filter((t) => t.sample === sample.id);
  const pfx = ANCHOR_PREFIX[anchor];

  /** Every sample: does the condition hold there? Colours read the pixels; words use what each sample's recognition read. */
  const verify = async () => {
    const n = ++verifies.current;
    setBusy("verify"); setTried(null); setText(null);
    try {
      const out: Verdict[] = [];
      for (const x of list) {
        if (tool === "color") {
          const worst = worstOf(await pixelsOf(dev.sampleImage(x.id)), picks, sample.width, sample.height, anchor);
          out.push({ id: x.id, name: x.name, hit: worst !== null && worst <= tolerance, worst });
        } else if (rect) {
          if (!x.recognized) { out.push({ id: x.id, name: x.name, hit: null }); continue; }
          const word = inside[0];
          // As the server maps a region (ScreenLayout.mapRegion, envelope): scaled by height, spanning every placement.
          const { s, shifts } = shiftsOf(sample, x, anchor);
          const lo = Math.min(...shifts), hi = Math.max(...shifts);
          const r = [rect[0] * s + lo, rect[1] * s, rect[2] * s + hi - lo, rect[3] * s];
          const hit = x.texts.some((t) => t.box.length === 4 && halfInside(t.box, r) && (!word || textMatches(t.text, word)));
          out.push({ id: x.id, name: x.name, hit });
        }
      }
      if (n === verifies.current) setTried(out);
    } catch (error) { if (n === verifies.current) setText([failure(error), false]); }
    if (n === verifies.current) setBusy(null);
  };
  const verdict = tried && <Verified tried={tried} tolerance={tool === "color" ? tolerance : undefined} open={open} />;

  const panel = (() => {
    if (tool === "color") {
      const line = colorLine(picks, tolerance, anchor);
      return (
        <div className={`${w.card} ${m.panel}`}>
          <h2 className={m.h2}>取色</h2>
          {picks.length ? picks.map((p, i) => <div key={i} className={m.text}><span className={m.swatch} style={{ background: `#${p.hex}` }} />
            <span className={`${m.grow} ${m.mono}`}>{p.x},{p.y}</span>
            <button type="button" className={m.x} aria-label="去掉这个点" onClick={() => setPicks(picks.filter((_, k) => k !== i))}>✕</button></div>)
            : <div className={w.muted}>点 3–6 个颜色稳的点</div>}
          <div className={m.line}><span className={m.grow}>锚点</span><Chips label="锚点" items={ANCHORS} value={anchor} onChange={setAnchor} /></div>
          <div className={m.line}><span className={m.grow}>容差</span><Stepper label="容差" value={tolerance} min={0} max={255} onChange={(v) => setTolerance(v ?? 0)} /></div>
          {picks.length > 0 && <>
            <button type="button" className={w.btn} disabled={busy === "verify"} onClick={verify}>{busy === "verify" ? "验证中…" : `在 ${list.length} 张样本上验`}</button>
            {verdict}
            <Result text={line} kind="color" insert={insert} copy={copy} />
            {draft && <div className={m.actions}>
              <input className={m.input} aria-label="组名" value={setName} onChange={(e) => setSetName(e.target.value)} placeholder="组名" />
              <button type="button" className={w.btn} disabled={!setName.trim()} onClick={() => void saveSet(setName.trim())}>存为组</button>
            </div>}
          </>}
        </div>
      );
    }
    if (tool === "offset") {
      const [a, b] = points;
      return (
        <div className={`${w.card} ${m.panel}`}>
          <h2 className={m.h2}>量偏移</h2>
          <div className={m.mono}>{a ? `(${a[0]}, ${a[1]})${b ? ` → (${b[0]}, ${b[1]})` : ""}` : "先点锚点，再点目标"}</div>
          {a && b && <div className={`${m.block} ${m.mono}`}>dx {b[0] - a[0]} · dy {b[1] - a[1]}</div>}
          <div className={m.actions}>
            {a && <button type="button" className={w.btn} onClick={() => copy(`${a[0]}, ${a[1]}`)}>复制坐标</button>}
            {a && b && <button type="button" className={`${w.btn} ${w.primary}`} onClick={() => copy(`${b[0] - a[0]}, ${b[1] - a[1]}`)}>复制偏移</button>}
          </div>
        </div>
      );
    }
    if (!rect) return <div className={`${w.card} ${m.panel}`}><h2 className={m.h2}>{TOOLS.find(([k]) => k === tool)?.[1]}</h2><div className={w.muted}>在图上拖一个框</div></div>;
    if (tool === "private") return (
      <div className={`${w.card} ${m.panel}`}><h2 className={m.h2}>打码</h2><div className={m.mono}>[{rect.join(", ")}]</div><div className={w.muted}>这块不进任何模板</div>
        <button type="button" className={`${w.btn} ${w.primary}`} onClick={markPrivate}>打码</button></div>
    );
    if (tool === "region") {
      return (
        <div className={`${w.card} ${m.panel}`}>
          <h2 className={m.h2}>框区域</h2>
          <div className={w.muted}>{inside.length ? `读到「${inside.join("」「")}」` : sample.recognized ? "框里没字" : "还没识别"}</div>
          <div className={m.line}><span className={m.grow}>锚点</span><Chips label="锚点" items={ANCHORS} value={anchor} onChange={setAnchor} /></div>
          <button type="button" className={w.btn} disabled={busy === "verify"} onClick={verify}>{busy === "verify" ? "验证中…" : `在 ${list.length} 张样本上验`}</button>
          {verdict}
          <RegionOut key={`${sample.id}/${rect.join(",")}`} read={inside[0] ?? ""} region={`@${pfx}${rect.join(",")}`} insert={insert} copy={copy} />
          <div className={m.actions}>
            <button type="button" className={w.btn} onClick={() => copy(`@${pfx}${rect.join(",")}`)}>复制 @区域</button>
            <button type="button" className={w.btn} onClick={() => setTool("template")}>裁成模板</button>
          </div>
        </div>
      );
    }
    return <CutPanel key={rect.join(",")} rect={rect} inside={inside} made={made} game={game} sample={sample} pfx={pfx} insert={insert} copy={copy}
      known={draft ? Array.from(new Set(resources(draft.body).map((r) => (typeof r.id === "string" ? r.id.split("@")[0] : "")).filter((x) => x && !x.endsWith(".onnx") && !x.endsWith(".txt")))) : []}
      onCut={async (cut) => {
        setText(null);
        try { const t = await dev.cut(game, { ...cut, sample: sample.id, rect }); setMade(t); await load(); await addToDraft(t); }
        catch (error) { setText([failure(error), false]); }
      }} />;
  })();
  async function markPrivate() {
    if (!rect || !sample) return;
    try { await dev.changeSample(sample.id, { privateRegions: [...sample.privateRegions, rect] }); setRect(null); await load(); setText(["已打码", true]); }
    catch (error) { setText([failure(error), false]); }
  }
  async function saveSet(name: string) {
    if (!validSetName(name)) { setText(["组名不能有空格、@、#、逗号或引号", false]); return; }
    const x0 = Math.min(...picks.map((p) => p.x)), y0 = Math.min(...picks.map((p) => p.y));
    if (colorSets[name] && !await ask({ title: `替换取色组 ${name}？`, body: "已有同名的组", ok: "替换", danger: true })) return;
    const problem = await changeSets((old) => ({ ...old, [name]: picks.map((p) => `${p.x - x0},${p.y - y0}#${p.hex}`) }));
    setText(problem ? [problem, false] : [`已存为 ${name} · 写 色 ${name}@${pfx}${x0},${y0} 容差 ${tolerance}`, true]);
  }

  return (
    <div className={m.layout}>
      {left}
      <section aria-label="标注" className={m.main}>
        {message}
        <div className={m.nameRow}>
          <input key={sample.id} aria-label="样本名" className={m.nameInput} defaultValue={sample.name} maxLength={64}
            onBlur={async (e) => { const name = e.target.value.trim(); if (!name || name === sample.name) return;
              try { await dev.changeSample(sample.id, { name }); await load(); } catch (error) { setText([failure(error), false]); } }} />
          <span className={w.muted}>{sample.width}×{sample.height} · {sample.recognized ? `识别 ${sample.texts.length} 处文字` : "未识别"}</span>
          {!sample.recognized && me && <button type="button" className={w.btn} disabled={!!busy} onClick={() => void recognize(sample)}>{busy === "read" ? "识别中…" : "识别"}</button>}
          <span className={m.grow} />
          <div className={m.tools}><SegmentTabs label="工具" items={TOOLS} value={tool} onChange={setTool} /></div>
        </div>
        <div className={`${w.card} ${m.stage}`}>
          <div ref={box} className={m.canvas} data-tool={tool}
            onPointerDown={(e) => {
              if (tool === "color") {
                const [x, y] = at(e);
                const near = picks.findIndex((p) => Math.abs(p.x - x) <= 4 && Math.abs(p.y - y) <= 4);
                if (near >= 0) { setPicks(picks.filter((_, k) => k !== near)); return; }
                if (picks.length >= 32) { setText(["最多 32 个点", false]); return; }
                void pixelsOf(dev.sampleImage(sample.id)).then((px) => {
                  const cx = Math.min(x, px.width - 1), cy = Math.min(y, px.height - 1);
                  const hex = colorAt(px, cx, cy);
                  if (hex) setPicks((all) => [...all, { x: cx, y: cy, hex }]); else setText(["这里读不到颜色", false]);
                }).catch((error) => setText([failure(error), false]));
                return;
              }
              if (!drawing) { const p = at(e); setPoints(points.length === 1 ? [points[0], p] : [p]); return; }
              e.currentTarget.setPointerCapture(e.pointerId); start.current = at(e); setRect(null); setMade(null);
            }}
            onPointerMove={(e) => { if (!start.current) return; const [x, y] = at(e); const [sx, sy] = start.current;
              setRect([Math.min(x, sx), Math.min(y, sy), Math.abs(x - sx), Math.abs(y - sy)]); }}
            onPointerUp={() => { start.current = null; setRect((r) => r && (r[2] < 4 || r[3] < 4) ? null : r); }}>
            <img src={dev.sampleImage(sample.id)} alt={sample.name} draggable={false} />
            {showTexts && sample.texts.map((t, i) => <div key={i} className={m.box} data-kind="text" style={pct(t.box, sample)}><span>{t.text}</span></div>)}
            {mine.map((t) => <div key={t.id} className={m.box} data-kind="template" style={pct(t.rect, sample)}><span>{t.id}</span></div>)}
            {sample.privateRegions.map((r, i) => <div key={`p${i}`} className={m.box} data-kind="private" style={pct(r, sample)}><span>打码</span></div>)}
            {rect && <div className={m.box} data-kind="region" style={pct(rect, sample)}><span>{TOOLS.find(([k]) => k === tool)?.[1]}</span></div>}
            {tool === "color" && picks.map((p, i) => <div key={`c${i}`} className={m.point} data-kind="color" style={{ left: `${p.x / sample.width * 100}%`, top: `${p.y / sample.height * 100}%` }} />)}
            {points.map((p, i) => <div key={`pt${i}`} className={m.point} style={{ left: `${p[0] / sample.width * 100}%`, top: `${p[1] / sample.height * 100}%` }} />)}
          </div>
          <div className={`${w.muted} ${m.legend}`}>
            <label className={m.toggle}><input type="checkbox" checked={showTexts} onChange={(e) => setShowTexts(e.target.checked)} />显示文字</label>
            <span className={m.grow} />
            <button type="button" className={m.delete} onClick={async () => {
              if (!await ask({ title: "删除这张样本？", body: "模板会保留", ok: "删除", danger: true })) return;
              try { await dev.deleteSample(sample.id); await load(); navigate(wbPaths.assets + keep); } catch (error) { setText([failure(error), false]); }
            }}>删除样本</button>
          </div>
        </div>
      </section>
      <aside aria-label="结果" className={m.aside}>
        {rect && drawing && <RectEditor rect={rect} sample={sample} onChange={(r) => { setRect(r); setMade(null); }} />}
        {panel}
      </aside>
    </div>
  );
}
const pct = (r: number[], s: { width: number; height: number }) => ({ left: `${r[0] / s.width * 100}%`, top: `${r[1] / s.height * 100}%`, width: `${r[2] / s.width * 100}%`, height: `${r[3] / s.height * 100}%` });
/** A template's search region: its box with some room around it, inside the sample. */
const padded = (rect: number[], s?: { width: number; height: number }) => {
  const x = Math.max(0, rect[0] - 24), y = Math.max(0, rect[1] - 24);
  return [x, y, s ? Math.min(s.width - x, rect[2] + 48) : rect[2] + 48, s ? Math.min(s.height - y, rect[3] + 48) : rect[3] + 48];
};

/** The game's colour sets (`library.colors`: name → "dx,dy#RRGGBB" points). */
function setsOf(body: Record<string, unknown>, game: string): Record<string, string[]> {
  const lib = target(body as never, game)?.library;
  const colors = isObj(lib) && isObj(lib.colors) ? lib.colors : {};
  return Object.fromEntries(Object.entries(colors).filter(([, v]) => Array.isArray(v)).map(([k, v]) => [k, (v as unknown[]).map(String)]));
}
/** How many script lines name colour set [name] (`色 name@…`). */
function setUses(body: Record<string, unknown>, name: string): number {
  const pattern = new RegExp(`(^|[\\s　])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}@`);
  const scripts = [...tasks(body as never).flatMap((t) => t.steps.map((st) => str(st.script) ?? "")), ...snippets(body as never).map((sn) => str(sn.script) ?? "")];
  return scripts.reduce((n, sc) => n + sc.split("\n").filter((l) => pattern.test(l)).length, 0);
}

/** The condition made as a whole line, and where it goes: the workspace line we came from (in its place or after it), or 复制. */
function Result({ text, kind, insert, copy, missing }: { text: string | null; kind: CondKind; insert: ReturnType<typeof useInsert>; copy: (v: string) => void; missing?: string }) {
  return <>
    {insert && <span className={w.muted}>回到 {insert.name} L{insert.target.line}</span>}
    <ConditionOut className={m.out} cond={text} kind={kind} target={insert?.target ?? null} copy={copy} missing={missing} />
  </>;
}

/** 框区域's condition: the words read in the box, or typed when none were read (no placeholder goes into a script). */
function RegionOut({ read, region, insert, copy }: { read: string; region: string; insert: ReturnType<typeof useInsert>; copy: (v: string) => void }) {
  const [word, setWord] = useState(read);
  const typed = word.trim().replace(/["“”]/g, "");
  return <>
    <div className={m.f}><label htmlFor="rw">要等的字</label><input id="rw" value={word} onChange={(e) => setWord(e.target.value)} placeholder="框里的字" /></div>
    <Result text={typed ? `"${typed}"${region}` : null} kind="text" insert={insert} copy={copy} missing="框里没读到字：填上要等的字才能插入" />
  </>;
}

/** What checking the condition on every sample found. */
function Verified({ tried, tolerance, open }: { tried: Verdict[]; tolerance?: number; open: (id: string) => void }) {
  const hits = tried.filter((t) => t.hit === true), misses = tried.filter((t) => t.hit === false), unread = tried.filter((t) => t.hit === null);
  const worst = tolerance !== undefined ? Math.max(0, ...hits.map((t) => t.worst ?? 0)) : null;
  return (
    <div className={m.verdict} data-tone={hits.length ? "ok" : "bad"}>
      <b>{tried.length} 张样本：命中 {hits.length} · 没中 {misses.length}{unread.length ? ` · 未识别 ${unread.length}` : ""}</b>
      {worst !== null && hits.length > 0 && <div className={w.muted}>最差色差 {worst} / {tolerance}</div>}
      {hits.length > 0 && <div className={m.hits}>{hits.map((t) => <button key={t.id} type="button" onClick={() => open(t.id)}>{t.name}</button>)}</div>}
    </div>
  );
}

/** 裁模板: the name (and theme variant) it is written by, the words in it confirmed, then cut on the server. */
function CutPanel({ rect, inside, made, game, sample, pfx, known, insert, copy, onCut }: {
  rect: number[]; inside: string[]; made: Template | null; game: string; sample: Sample; pfx: string; known: string[];
  insert: ReturnType<typeof useInsert>; copy: (v: string) => void;
  onCut: (cut: { id: string; confirmedTexts: string[]; reason?: string; maskBackground?: boolean; maskTolerance?: number }) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [variant, setVariant] = useState("");
  const [mask, setMask] = useState(false);
  const [maskTol, setMaskTol] = useState(28);
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const id = name.trim() && variant.trim() && !name.includes("@") ? `${name.trim()}@${variant.trim()}` : name.trim();
  const cond = made ? `图 ${made.id.split("@")[0]}@${pfx}${padded(rect, sample).join(",")}` : "";
  return (
    <div className={`${w.card} ${m.panel}`}>
      <h2 className={m.h2}>裁模板</h2>
      <div className={m.f}><label htmlFor="tn">名称</label>
        <input id="tn" list="tpl-names" value={name} onChange={(e) => setName(e.target.value)} placeholder="mail-icon" />
        <datalist id="tpl-names">{known.map((x) => <option key={x} value={x} />)}</datalist></div>
      <div className={m.f}><label htmlFor="tv">变体</label><input id="tv" value={variant} onChange={(e) => setVariant(e.target.value)} placeholder="留空 = 原皮" /></div>
      <label className={`${w.muted} ${m.toggle}`}><input type="checkbox" checked={mask} onChange={(e) => setMask(e.target.checked)} />抠背景</label>
      {mask && <div className={m.line}><span className={m.grow}>背景容差</span><Stepper label="背景容差" value={maskTol} min={4} max={96} onChange={(v) => setMaskTol(v ?? 28)} /></div>}
      {(rect[2] > 64 || rect[3] > 64) && <div className={m.f}><label htmlFor="tr">超 64×64 的理由</label><input id="tr" value={reason} onChange={(e) => setReason(e.target.value)} /></div>}
      {inside.length > 0 && <div className={w.muted}>确认是游戏里的字：
        <div className={m.checks}>{inside.map((t) => <label key={t}><input type="checkbox" checked={confirmed.includes(t)} onChange={(e) => setConfirmed(e.target.checked ? [...confirmed, t] : confirmed.filter((x) => x !== t))} />{t}</label>)}</div></div>}
      {made ? <>
        <div className={m.text}><img src={dev.templateImage(game, made.id)} alt={made.id} className={m.made} /><span className={w.muted}>{made.width}×{made.height} · {made.bytes} 字节</span></div>
        <Result text={cond} kind="image" insert={insert} copy={copy} />
      </> : <button type="button" className={`${w.btn} ${w.primary}`} disabled={!id || busy} onClick={async () => {
        setBusy(true); await onCut({ id, confirmedTexts: confirmed, reason: reason.trim() || undefined, maskBackground: mask, maskTolerance: maskTol }); setBusy(false);
      }}>{busy ? "裁剪中…" : "存为模板"}</button>}
    </div>
  );
}

/** A colour set: its points, renamed or deleted in the game's library. */
function ColorSetView({ name, points, used, insert, copy, onRename, onDelete }: {
  name: string; points: string[]; used: number; insert: ReturnType<typeof useInsert>; copy: (v: string) => void;
  onRename: (next: string) => Promise<string | null>; onDelete: () => Promise<string | null>;
}) {
  const [next, setNext] = useState(name);
  const [text, setText] = useState<string | null>(null);
  // Where the set's top-left goes on the screen: a set is written 色 名@x,y.
  const [x, setX] = useState(""); const [y, setY] = useState("");
  const placed = /^\d+$/.test(x.trim()) && /^\d+$/.test(y.trim());
  return (
    <div className={m.setLayout}>
      <div className={`${w.card} ${m.panel} ${m.grow}`}>
        <div className={m.nameRow}><b className={m.title}>{name}</b><span className={w.muted}>{points.length} 点 · {used ? `用在 ${used} 行` : "没人用"}</span></div>
        {points.map((p, i) => { const [xy, hex] = p.split("#"); return (
          <div key={i} className={m.text}><span className={m.swatch} style={{ background: `#${hex}` }} /><span className={`${m.mono} ${m.grow}`}>{xy}</span><span className={`${m.mono} ${w.muted}`}>#{hex}</span></div>); })}
      </div>
      <div className={`${w.card} ${m.panel} ${m.setSide}`}>
        <h2 className={m.h2}>取色组</h2>
        <div className={m.rect}>
          <label className={m.f}><span>左上 x</span><input type="number" min={0} value={x} onChange={(e) => setX(e.target.value)} /></label>
          <label className={m.f}><span>左上 y</span><input type="number" min={0} value={y} onChange={(e) => setY(e.target.value)} /></label>
        </div>
        <Result text={placed ? `色 ${name}@${x.trim()},${y.trim()} 容差 24` : null} kind="color" insert={insert} copy={copy} missing="填上组左上角在画面上的位置" />
        <div className={m.f}><label htmlFor="sn">改名</label>
          <div className={m.actions}><input id="sn" className={m.input} value={next} onChange={(e) => setNext(e.target.value)} />
            <button type="button" className={w.btn} disabled={!next.trim() || next.trim() === name} onClick={async () => setText(await onRename(next.trim()))}>改名</button></div></div>
        {used > 0 && <div className={w.muted}>脚本里 {used} 行要跟着改</div>}
        <button type="button" className={`${w.btn} ${m.danger}`} onClick={async () => setText(await onDelete())}>删除</button>
        {text && <div className={w.message}>{text}</div>}
      </div>
    </div>
  );
}

/** The drawn box in sample pixels, adjustable by number, with what is inside it enlarged. */
function RectEditor({ rect, sample, onChange }: { rect: number[]; sample: Sample; onChange: (rect: number[]) => void }) {
  const zoom = Math.min(4, 260 / Math.max(rect[2], 1), 140 / Math.max(rect[3], 1));
  const set = (i: number, v: string) => {
    const n = Math.round(Number(v));
    if (!Number.isFinite(n)) return;
    const next = [...rect]; next[i] = n;
    next[0] = Math.max(0, Math.min(next[0], sample.width - 1)); next[1] = Math.max(0, Math.min(next[1], sample.height - 1));
    next[2] = Math.max(1, Math.min(next[2], sample.width - next[0])); next[3] = Math.max(1, Math.min(next[3], sample.height - next[1]));
    onChange(next);
  };
  return (
    <div className={`${w.card} ${m.panel}`}>
      <div className={m.rect}>{(["x", "y", "宽", "高"] as const).map((label, i) => (
        <label key={label} className={m.f}><span>{label}</span><input type="number" value={rect[i]} onChange={(e) => set(i, e.target.value)} /></label>
      ))}</div>
      <div className={m.zoom} role="img" aria-label="框里的内容（放大）" style={{ width: rect[2] * zoom, height: rect[3] * zoom,
        backgroundImage: `url(${dev.sampleImage(sample.id)})`, backgroundSize: `${sample.width * zoom}px ${sample.height * zoom}px`,
        backgroundPosition: `${-rect[0] * zoom}px ${-rect[1] * zoom}px` }} />
    </div>
  );
}
