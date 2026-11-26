import { useState } from "react";
import { Stepper } from "../../components/ui";
import type { Json, Obj } from "./api";
import { uniqueId } from "./HomePage";
import { idOf } from "./NameButton";
import { arr, isObj, objs, str } from "./model";
import w from "./Wb.module.css";
import g from "./Game.module.css";

/** 干扰页 (technical design 1.6): pages that can come up over any other; every page wait clears them first with their snippet. */
export function describeInterruption(page: Obj, known: Obj[], lib: Obj[]): string {
  const state = page.state;
  const seen = typeof state === "string" ? `状态 ${str(known.find((s) => s.id === state)?.name) ?? state}`
    : isObj(state) ? `有字「${arr(state.text).map((c) => (isObj(c) ? str(c.text) : str(c)) ?? "").join("」「")}」` : "";
  const choices = objs(page.choices);
  if (choices.length >= 2) return `${seen} · 可选 ${choices.map((c) => str(c.name) ?? str(c.id)).join(" / ")}`;
  return `${seen} · 片段 ${str(lib.find((sn) => sn.id === page.use)?.name) ?? str(page.use)}`;
}

/** One interruption page being written: how it is recognized, which snippet clears it, how often at most. */
export function InterruptionForm({ page, lib, known, taken = [], onSave, onDelete, onCancel }: { page?: Obj; lib: Obj[]; known: Obj[]; taken?: string[];
  onSave: (next: Obj) => void; onDelete?: () => void; onCancel: () => void }) {
  const written = page?.state;
  const [name, setName] = useState(str(page?.name) ?? "");
  const [byState, setByState] = useState(typeof written === "string" || (!page && known.length > 0));
  const [stateId, setStateId] = useState(typeof written === "string" ? written : str(known[0]?.id) ?? "");
  const [words, setWords] = useState(isObj(written) ? arr(written.text).map((c) => (isObj(c) ? str(c.text) : str(c)) ?? "").join("、") : "");
  const firstWithin = isObj(written) ? arr(written.text).map((c) => isObj(c) ? arr(c.within) : []).find((r) => r.length === 4) : undefined;
  const [within, setWithin] = useState((firstWithin ?? [0, 0, 2400, 1080]).join(","));
  const [use, setUse] = useState(str(page?.use) ?? str(lib[0]?.id) ?? "");
  const [choices, setChoices] = useState<{ id: string; name: string; use: string }[]>(() =>
    objs(page?.choices).map((c) => ({ id: str(c.id) ?? "", name: str(c.name) ?? "", use: str(c.use) ?? str(lib[0]?.id) ?? "" })));
  const [maximum, setMaximum] = useState(String(typeof page?.maximum === "number" ? page.maximum : 3));
  const [wanted, setWanted] = useState("");
  const chosen = idOf(wanted) || idOf(name);
  const list = words.split(/[、,，\s]+/).map((x) => x.trim()).filter(Boolean);
  const region = within.split(/[,，\s]+/).map(Number).filter((n) => Number.isFinite(n));
  const multi = choices.length > 0;
  const choicesOk = !multi || (choices.length >= 2 && choices.every((c) => (idOf(c.id) || idOf(c.name)) && c.name.trim() && c.use)
    && new Set(choices.map((c) => idOf(c.id) || idOf(c.name))).size === choices.length);
  const ready = name.trim() && (multi ? choicesOk : !!use) && (page || chosen) && (byState ? stateId : list.length > 0 && region.length === 4 && region[2] > 0 && region[3] > 0)
    && Number(maximum) >= 1 && Number(maximum) <= 10;
  const submit = () => {
    const id = str(page?.id) ?? uniqueId(chosen, taken, "page");
    // Written in full: a page wait looks for every word within a region, with a confidence to clear. A popup's line
    // is a whole sentence, so any line holding the words counts.
    const state: Json = byState ? stateId : { id, text: list.map((t) => ({ text: t, minimumConfidence: 0.8, within: region, contains: true })) };
    // What the form does not edit (a snippet's arguments in "with") stays as written; the same snippet keeps them.
    const { maximum: _, with: given, choices: _c, use: _u, ...kept } = page ?? {};
    const builtChoices = choices.map((c) => ({ id: idOf(c.id) || idOf(c.name), name: c.name.trim(), use: c.use }));
    const effectiveUse = multi ? builtChoices[0].use : use;
    onSave({ ...kept, id, name: name.trim(), state, use: effectiveUse, ...(multi ? { choices: builtChoices } : {}),
      ...(!multi && isObj(given) && use === page?.use ? { with: given } : {}),
      ...(Number(maximum) !== 3 ? { maximum: Number(maximum) } : {}) });
  };
  return (
    <div className={g.form}>
      <div className={g.pair}>
        <div className={g.f} style={{ flex: "1 1 140px" }}><label htmlFor="pn">名称</label><input id="pn" value={name} onChange={(e) => setName(e.target.value)} placeholder="断线重连" /></div>
        {!page && <div className={g.f} style={{ flex: "1 1 140px" }}><label htmlFor="pi">编号</label>
          <input id="pi" value={wanted} onChange={(e) => setWanted(e.target.value)} placeholder={idOf(name) || "lost-connection"} /></div>}
        <div className={g.f} style={{ flex: "none" }}><span className={g.lb}>最多处理</span><Stepper label="最多处理" unit="次" min={1} max={10} value={maximum === "" || !Number.isFinite(Number(maximum)) ? undefined : Number(maximum)} onChange={(v) => setMaximum(v === undefined ? "" : String(v))} /></div>
      </div>
      <div className={g.f}><span className={g.lb}>认法</span>
        <div className={g.pair}>
          <label className={g.radio}><input type="radio" checked={!byState} onChange={() => setByState(false)} />文字</label>
          <label className={g.radio}><input type="radio" checked={byState} disabled={!known.length} onChange={() => setByState(true)} />状态</label>
        </div>
        {byState ? <select aria-label="状态" value={stateId} onChange={(e) => setStateId(e.target.value)}>
          {known.map((s) => <option key={String(s.id)} value={String(s.id)}>{str(s.name) ?? String(s.id)}</option>)}</select>
          : <div className={g.pair}>
            <input aria-label="字" style={{ flex: "2 1 160px" }} value={words} onChange={(e) => setWords(e.target.value)} placeholder="已断开游戏服务器" />
            <input aria-label="区域 x,y,宽,高" style={{ flex: "1 1 140px" }} value={within} onChange={(e) => setWithin(e.target.value)} />
          </div>}
      </div>
      <div className={g.f}>
        <div className={g.headRow}>
          <label htmlFor="pu" className={g.grow}>{multi ? "处理方式（首项默认）" : "片段"}</label>
          {!multi ? <button type="button" className={w.btn} style={{ minHeight: 28 }} onClick={() => setChoices([
            { id: "reject", name: "拒绝", use }, { id: "accept", name: "接受", use },
          ])}>多选项</button>
            : <button type="button" className={w.btn} style={{ minHeight: 28 }} onClick={() => { if (choices[0]?.use) setUse(choices[0].use); setChoices([]); }}>固定片段</button>}
        </div>
        {!multi ? (
          <select id="pu" value={use} onChange={(e) => setUse(e.target.value)}>
            {!lib.length && <option value="">先建片段</option>}
            {lib.map((sn) => <option key={String(sn.id)} value={String(sn.id)}>{str(sn.name) ?? String(sn.id)}</option>)}
          </select>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {choices.map((ch, idx) => (
              <div key={idx} className={g.pair}>
                <input aria-label="方式名称" style={{ flex: "1 1 90px" }} value={ch.name} placeholder={idx === 0 ? "拒绝（默认）" : "接受"}
                  onChange={(e) => setChoices(choices.map((x, k) => k === idx ? { ...x, name: e.target.value } : x))} />
                <input aria-label="方式编号" style={{ flex: "1 1 90px" }} value={ch.id} placeholder={idOf(ch.name) || "reject"}
                  onChange={(e) => setChoices(choices.map((x, k) => k === idx ? { ...x, id: e.target.value } : x))} />
                <select aria-label="处理片段" style={{ flex: "2 1 140px" }} value={ch.use}
                  onChange={(e) => setChoices(choices.map((x, k) => k === idx ? { ...x, use: e.target.value } : x))}>
                  {!lib.length && <option value="">先建片段</option>}
                  {lib.map((sn) => <option key={String(sn.id)} value={String(sn.id)}>{str(sn.name) ?? String(sn.id)}</option>)}
                </select>
                {choices.length > 2 && <button type="button" className={w.btn} onClick={() => setChoices(choices.filter((_, k) => k !== idx))}>删</button>}
              </div>
            ))}
            <button type="button" className={w.btn} style={{ alignSelf: "flex-start", minHeight: 28 }}
              onClick={() => setChoices([...choices, { id: "", name: "", use: str(lib[0]?.id) ?? "" }])}>＋ 方式</button>
          </div>
        )}
      </div>
      <div className={g.pair}>
        <button type="button" className={`${w.btn} ${w.primary}`} disabled={!ready} onClick={submit}>保存</button>
        <button type="button" className={w.btn} onClick={onCancel}>取消</button>
        {onDelete && <button type="button" className={w.btn} style={{ color: "var(--color-danger)" }} onClick={() => { if (confirm("删掉这个干扰页？")) onDelete(); }}>删除</button>}
      </div>
    </div>
  );
}
