import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Card, Empty, join, Message, MoreMenu, Pill, Popover, SegmentTabs, ui } from "../../../components/ui";
import { navigate } from "../../../router";
import { ask } from "../../../components/Confirm";
import { toast } from "../../../components/Toast";
import { admin, type Code, type CodeFilter, type CodePage } from "../api";
import { failure } from "../failure";
import { CODE_STATUS, duration, shortCode, time, who } from "../format";
import { Generate } from "./Generate";
import { DownloadIcon, KeyIcon, PlusIcon } from "../icons";
import { FilterChip, Pager, Search, TabsRow, Title } from "./parts";
import s from "./pages.module.css";

const DAYS: [CodeFilter["days"], string][] = [["", "全部"], [30, "30 天"], [90, "90 天"], [365, "365 天"], ["forever", "永久"]];

/** 兑换码: four numbers, the filters, and the codes, newest first. Only a code's first characters are ever shown here. */
export function CodesPage() {
  const [filter, setFilter] = useState<CodeFilter>({ status: "all", batch: "", days: "", q: "" });
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<CodePage | null>(null);
  const [error, setError] = useState("");
  const [generating, setGenerating] = useState(false);
  const [exporting, setExporting] = useState(false);
  const change = (next: Partial<CodeFilter>) => { setFilter((current) => ({ ...current, ...next })); setOffset(0); };
  const search = useCallback((q: string) => change({ q }), []);

  // Only the latest request's answer is shown: an older one arriving late (a slow search) is dropped.
  const latest = useRef(0);
  const load = useCallback(async () => {
    const ticket = ++latest.current;
    try { const next = await admin.codes(filter, offset); if (ticket === latest.current) { setPage(next); setError(""); } }
    catch (e) { if (ticket === latest.current) setError(failure(e)); }
  }, [filter, offset]);
  useEffect(() => { void load(); }, [load]);

  const revoke = async (code: Code) => {
    if (!await ask({ title: `作废 ${code.prefix ? `${code.prefix}…` : "这个码"}？`, body: "作废后不能再兑换", ok: "作废", danger: true })) return;
    try { await admin.revoke(code.id); toast("已作废", { tone: "ok" }); await load(); } catch (e) { toast(failure(e), { tone: "bad" }); }
  };
  const exportCsv = async () => {
    setExporting(true);
    try { await admin.exportCodes(filter); } catch (e) { toast(failure(e), { tone: "bad" }); } finally { setExporting(false); }
  };

  const counts = page?.counts; const stats = page?.stats;
  /** What a code's ⋯ (or, narrow, its row) offers: 作废 while unused, the redeemer once used. */
  const actionsOf = (code: Code) => {
    const actions: [string, () => void, boolean?][] = [];
    if (code.status === "unused") actions.push(["作废", () => void revoke(code), true]);
    if (code.redeemedBy) { const id = code.redeemedBy.userId; actions.push(["看兑换人", () => navigate(`/admin/users?user=${encodeURIComponent(id)}`)]); }
    return actions;
  };
  const status = (code: Code) => { const [label, tone] = CODE_STATUS[code.status]; return <Pill tone={tone} className={tone ? undefined : s.quiet}>{label}</Pill>; };
  return (
    <>
      <Title aside={<>
        <Button onClick={exportCsv} disabled={exporting}><DownloadIcon />导出 CSV</Button>
        <Button variant="primary" onClick={() => setGenerating(true)}><PlusIcon />批量生成</Button>
      </>}>兑换码</Title>
      <div className={s.kpis}>
        {([["已发", stats?.issued], ["已兑换", stats?.redeemed], ["未用", stats?.unused], ["近 7 天兑换", stats?.redeemed7d]] as const).map(([label, value]) => (
          <Card key={label} className={s.kpi}><b>{value ?? "—"}</b><span>{label}</span></Card>
        ))}
      </div>
      <div className={s.filters}>
        <TabsRow>
          <SegmentTabs label="状态" value={filter.status} onChange={(status) => change({ status })}
            items={[["all", `全部 ${counts?.all ?? ""}`], ["unused", `未用 ${counts?.unused ?? ""}`], ["used", `已用 ${counts?.used ?? ""}`], ["revoked", `作废 ${counts?.revoked ?? ""}`], ["expired", `过期 ${counts?.expired ?? ""}`]]} />
        </TabsRow>
        <FilterChip label="批次" value={filter.batch} onChange={(batch) => change({ batch })}
          options={[["", "全部"], ...(page?.batches ?? []).map((name): [string, string] => [name, name])]} />
        <FilterChip label="时长" value={filter.days} onChange={(days) => change({ days })} options={DAYS} />
        <span className={s.spacer} />
        <Search value={filter.q} onChange={search} placeholder="搜码、兑换人" />
      </div>
      <Message text={error} />
      <Card flush>
        <div className={s.tableWrap}><table className={join(s.table, s.codes)}>
          <colgroup><col style={{ width: 190 }} /><col style={{ width: 80 }} /><col style={{ width: 92 }} /><col /><col style={{ width: 120 }} /><col /><col style={{ width: 120 }} /><col style={{ width: 60 }} /></colgroup>
          <thead><tr><th>码</th><th>时长</th><th>状态</th><th>批次</th><th>生成</th><th>兑换人</th><th>兑换时间</th><th><span className="visually-hidden">操作</span></th></tr></thead>
          <tbody>
            {page?.items.map((code) => {
              const actions = actionsOf(code);
              return (
                <tr key={code.id}>
                  <td className={s.mono}>{shortCode(code.prefix)}</td>
                  <td>{duration(code.days)}</td>
                  <td>{status(code)}</td>
                  <td className={s.muted}>{code.batch ?? "—"}</td>
                  <td className={join(s.mono, s.muted)}>{time(code.createdAt)}</td>
                  <td className={s.muted}>{code.redeemedBy ? who(code.redeemedBy) : "—"}</td>
                  <td className={join(s.mono, s.muted)}>{time(code.redeemedAt)}</td>
                  <td className={s.menu}>{actions.length > 0 && <MoreMenu label={`${shortCode(code.prefix)} 的操作`} actions={actions} />}</td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
        {/* Narrow: a row per code; one with actions opens them when tapped. */}
        <div className={s.rows}>
          {page?.items.map((code) => {
            const actions = actionsOf(code);
            const body = <>
              <span className={s.tile}><KeyIcon /></span>
              <span className={s.rowText}><span className={s.rowCode}>{shortCode(code.prefix)}</span><span className={s.sub}>{duration(code.days)}{code.batch ? ` · ${code.batch}` : ""}</span></span>
              {status(code)}
            </>;
            if (actions.length === 0) return <div key={code.id} className={s.row}>{body}</div>;
            return (
              <Popover key={code.id} label={`${shortCode(code.prefix)}，${CODE_STATUS[code.status][0]}，操作`} plain align="end" trigger={<span className={s.row}>{body}</span>}>
                {(close) => actions.map(([text, run, danger]) => (
                  <button key={text} type="button" role="menuitem" className={join(ui.menuItem, danger && ui.menuDanger)} onClick={() => { close(); run(); }}>{text}</button>
                ))}
              </Popover>
            );
          })}
        </div>
        {page && page.items.length === 0 && <Empty>没有兑换码</Empty>}
        {!page && !error && <Empty>读取中…</Empty>}
      </Card>
      {page && <Pager offset={offset} total={page.total} onChange={setOffset} />}
      {generating && <Generate onClose={() => setGenerating(false)} onGenerated={() => void load()} />}
    </>
  );
}
