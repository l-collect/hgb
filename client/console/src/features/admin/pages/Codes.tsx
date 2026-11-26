import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Card, Empty, Message, MoreMenu, Pill, SegmentTabs, ui } from "../../../components/ui";
import { navigate } from "../../../router";
import { ask } from "../../../components/Confirm";
import { toast } from "../../../components/Toast";
import { admin, type Code, type CodeFilter, type CodePage } from "../api";
import { failure } from "../failure";
import { CODE_STATUS, duration, shortCode, time, who } from "../format";
import { Generate } from "./Generate";
import { FilterChip, Pager, Search, Title } from "./parts";
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
  return (
    <>
      <Title aside={<Button variant="primary" onClick={() => setGenerating(true)}>＋ 批量生成</Button>}>兑换码</Title>
      <div className={s.kpis}>
        {([["已发", stats?.issued, ""], ["已兑换", stats?.redeemed, s.kpiOk], ["未用", stats?.unused, s.kpiRun], ["近 7 天兑换", stats?.redeemed7d, ""]] as const).map(([label, value, tone]) => (
          <Card key={label} className={s.kpi}><b className={tone}>{value ?? "—"}</b><span className={ui.tiny}>{label}</span></Card>
        ))}
      </div>
      <div className={s.filters}>
        <div className={s.seg}>
          <SegmentTabs label="状态" value={filter.status} onChange={(status) => change({ status })}
            items={[["all", `全部 ${counts?.all ?? ""}`], ["unused", `未用 ${counts?.unused ?? ""}`], ["used", `已用 ${counts?.used ?? ""}`], ["revoked", `作废 ${counts?.revoked ?? ""}`], ["expired", `过期 ${counts?.expired ?? ""}`]]} />
        </div>
        <FilterChip label="批次" value={filter.batch} onChange={(batch) => change({ batch })}
          options={[["", "全部"], ...(page?.batches ?? []).map((name): [string, string] => [name, name])]} />
        <FilterChip label="时长" value={filter.days} onChange={(days) => change({ days })} options={DAYS} />
        <span className={s.spacer} />
        <Search value={filter.q} onChange={search} placeholder="搜码、兑换人" />
        <Button onClick={exportCsv} disabled={exporting}>导出 CSV</Button>
      </div>
      <Message text={error} />
      <Card flush>
        <div className={s.scroll}><table className={s.table}>
          <colgroup><col style={{ width: 190 }} /><col style={{ width: 76 }} /><col style={{ width: 84 }} /><col /><col style={{ width: 116 }} /><col /><col style={{ width: 116 }} /><col style={{ width: 56 }} /></colgroup>
          <thead><tr><th>码</th><th>时长</th><th>状态</th><th>批次</th><th>生成</th><th>兑换人</th><th>兑换时间</th><th><span className="visually-hidden">操作</span></th></tr></thead>
          <tbody>
            {page?.items.map((code) => {
              const [label, tone] = CODE_STATUS[code.status];
              const actions: [string, () => void, boolean?][] = [];
              if (code.status === "unused") actions.push(["作废", () => void revoke(code), true]);
              if (code.redeemedBy) { const id = code.redeemedBy.userId; actions.push(["看兑换人", () => navigate(`/admin/users?user=${encodeURIComponent(id)}`)]); }
              return (
                <tr key={code.id}>
                  <td className={ui.mono}>{shortCode(code.prefix)}</td>
                  <td>{duration(code.days)}</td>
                  <td><Pill tone={tone}>{label}</Pill></td>
                  <td className={ui.tiny}>{code.batch ?? "—"}</td>
                  <td className={`${ui.tiny} ${ui.mono}`}>{time(code.createdAt)}</td>
                  <td className={ui.tiny}>{code.redeemedBy ? who(code.redeemedBy) : "—"}</td>
                  <td className={`${ui.tiny} ${ui.mono}`}>{time(code.redeemedAt)}</td>
                  <td className={s.menu}>{actions.length > 0 && <MoreMenu label={`${shortCode(code.prefix)} 的操作`} actions={actions} />}</td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
        {page && page.items.length === 0 && <Empty>没有兑换码</Empty>}
        {!page && !error && <Empty>读取中…</Empty>}
      </Card>
      {page && <Pager offset={offset} total={page.total} onChange={setOffset} />}
      <p className={ui.tiny}>码只存摘要，明文只在生成时显示一次</p>
      {generating && <Generate onClose={() => setGenerating(false)} onGenerated={() => void load()} />}
    </>
  );
}
