import { useState } from "react";
import { Button, Chips, Message, Stepper } from "../../../components/ui";
import { admin, save, stamp, type Generated } from "../api";
import { ask } from "../../../components/Confirm";
import { toast } from "../../../components/Toast";
import { failure } from "../failure";
import { dateInput, duration, endOfDay, MAX_DAYS } from "../format";
import { AlertIcon, DownloadIcon } from "../icons";
import { Drawer } from "./parts";
import s from "./pages.module.css";

type Length = "30" | "90" | "365" | "forever" | "custom";

/**
 * 批量生成, in the drawer: fill in, then the codes in plain text. The server keeps only their digests, so this is the one
 * time they can be seen; closing asks first unless they were copied or saved.
 */
export function Generate({ onClose, onGenerated }: { onClose: () => void; onGenerated: () => void }) {
  const [count, setCount] = useState<number | undefined>(20);
  const [length, setLength] = useState<Length>("30");
  const [custom, setCustom] = useState<number | undefined>(180);
  const [batch, setBatch] = useState("");
  const [limited, setLimited] = useState<"none" | "until">("none");
  const [until, setUntil] = useState(() => dateInput(Date.now() + 30 * 86400000));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<Generated | null>(null);
  const [kept, setKept] = useState(false);
  const [copied, setCopied] = useState(false);

  const days = length === "forever" ? null : length === "custom" ? custom : Number(length);
  const valid = count != null && count >= 1 && count <= 500 && (days === null || (days != null && days >= 1 && days <= MAX_DAYS)) && (limited === "none" || !!until);

  const generate = async () => {
    if (!valid) return;
    setBusy(true); setError("");
    try {
      const result = await admin.generate({ count: count!, days: days ?? null, batch: batch.trim() || null, redeemBy: limited === "until" ? endOfDay(until) : null });
      setDone(result); onGenerated();
    } catch (e) { setError(failure(e)); } finally { setBusy(false); }
  };
  const close = async () => {
    if (done && !kept && !await ask({ title: "关掉就看不到明文了", body: "还没复制或下载", ok: "仍要关闭", cancel: "再看看", danger: true })) return;
    onClose();
  };
  const copy = async () => {
    if (!done) return;
    try { await navigator.clipboard.writeText(done.codes.join("\n")); setKept(true); setCopied(true); setTimeout(() => setCopied(false), 2000); }
    catch { toast("复制失败，请改用导出 CSV", { tone: "bad" }); }
  };
  const download = () => {
    if (!done) return;
    // As the server writes its CSV: a cell a spreadsheet would read as a formula gets a leading ', and one with a comma,
    // quote or line break is quoted.
    const cell = (raw: string) => {
      const value = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
      return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
    };
    const rows = [["码", "时长", "批次"], ...done.codes.map((code) => [code, duration(done.days), done.batch ?? ""])];
    // The byte-order mark lets spreadsheet programs read the Chinese as UTF-8.
    save(new Blob(["﻿" + rows.map((row) => row.map(cell).join(",")).join("\r\n") + "\r\n"], { type: "text/csv;charset=utf-8" }), `兑换码明文-${stamp()}.csv`);
    setKept(true);
  };

  if (done) return (
    <Drawer title={`已生成 ${done.codes.length} 个`} onClose={close}
      foot={<><Button onClick={download}><DownloadIcon />导出 CSV</Button><Button onClick={copy}>{copied ? "已复制" : "复制全部"}</Button><Button variant="primary" onClick={close}>好了</Button></>}>
      <div className={s.once} role="alert"><span className={s.onceTile}><AlertIcon /></span><b>明文只显示这一次</b></div>
      <div className={s.plain}>{done.codes.map((code) => <span key={code}>{code}</span>)}</div>
      <span className={s.meta}>{duration(done.days)}{done.batch ? ` · 批次「${done.batch}」` : ""}</span>
    </Drawer>
  );
  return (
    <Drawer title="批量生成" onClose={onClose}
      foot={<><Button onClick={onClose}>取消</Button><Button variant="primary" disabled={!valid || busy} onClick={generate}>{busy ? "生成中…" : `生成 ${count ?? ""} 个`}</Button></>}>
      <div className={s.group}><span className={s.label}>数量</span><Stepper label="数量" value={count} onChange={setCount} min={1} max={500} /></div>
      <div className={s.group}>
        <span className={s.label}>时长</span>
        <Chips label="时长" value={length} onChange={setLength} items={[["30", "30 天"], ["90", "90 天"], ["365", "365 天"], ["forever", "永久"], ["custom", "自定义"]]} />
        {length === "custom" && <Stepper label="天数" value={custom} onChange={setCustom} min={1} max={MAX_DAYS} unit="天" />}
      </div>
      <div className={s.group}>
        <span className={s.label}>批次</span>
        <input aria-label="批次" className={s.input} maxLength={40} placeholder="11 月活动" value={batch} onChange={(e) => setBatch(e.target.value)} />
      </div>
      <div className={s.group}>
        <span className={s.label}>有效期</span>
        <Chips label="有效期" value={limited} onChange={setLimited} items={[["none", "不限"], ["until", "指定截止日"]]} />
        {limited === "until" && <label className={s.inlineField}><input type="date" aria-label="兑换截止日" className={s.input} value={until} min={dateInput(Date.now())} max={dateInput(Date.now() + MAX_DAYS * 86400000)} onChange={(e) => setUntil(e.target.value)} />前兑换</label>}
      </div>
      <Message text={error} />
    </Drawer>
  );
}
