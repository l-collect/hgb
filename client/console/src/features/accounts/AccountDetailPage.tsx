import { useEffect, useState } from "react";
import { api, enc } from "../../api/client";
import type { EventFollowUp, GameAccount, GameTask, InterruptionOption } from "../../api/types";
import { Breadcrumb, Button, Card, CardHead, Empty, LiveSelect, LiveSwitch, PageTabs, Pill, Row, ui } from "../../components/ui";
import { orToast } from "../../components/useAction";
import { ask } from "../../components/Confirm";
import { shortTime } from "../../format";
import { Link, navigate, paths } from "../../router";
import { useConsole } from "../../state/context";
import { NotFound } from "../ConsolePage";
import { RunRows } from "../jobs/runs";
import { accountNow, ApplyAccountLoginAction, EditAccount, removeAccount, ReportDeviceLoginAction } from "./GameAccountsPage";
import { PlanList } from "./Plans";
import s from "./Accounts.module.css";

type Tab = "settings" | "plans" | "runs";

/** Level-2 账号设置: 资料, 协战与登录态, 弹窗处理, 单跑参数, and 移除账号; its plans and runs are the other tabs. */
export function AccountDetailPage({ id, tab }: { id: string; tab: Tab }) {
  const { data } = useConsole();
  const account = data.accounts.find((item) => item.id === id);
  if (!account) return <NotFound text="没有这个账号" back={paths.accounts} backText="回到账号" />;
  const game = data.games.find((item) => item.id === account.gameId);
  const [now, tone] = accountNow(account, data);
  const runs = data.jobs.filter((job) => job.accountId === account.id);
  return (
    <>
      <Breadcrumb items={[["账号与计划", paths.accounts], [account.name, null]]} />
      <header className={s.header}>
        <h1 className={s.title}>{account.name} · 账号设置</h1>
        <Pill tone={tone} live className={s.headPill}>{now}</Pill>
      </header>
      <PageTabs label="账号内容" value={tab} tabs={[
        ["settings", "设置", paths.account(account.id)],
        ["plans", "计划", paths.account(account.id, "plans")],
        ["runs", "战报", paths.account(account.id, "runs")],
      ]} />
      {tab === "settings" && <AccountSettingsTab account={account} gameName={game?.name ?? account.gameId} tasks={game?.tasks ?? []} interruptions={game?.interruptions ?? []} />}
      {tab === "plans" && <PlanList account={account} game={game} plans={data.plans} jobs={data.jobs} />}
      {tab === "runs" && <Card as="section" flush aria-label="战报">{runs.length ? <RunRows jobs={runs} devices={data.devices} columns={["place", "source"]} /> : <Empty>还没有战报</Empty>}</Card>}
    </>
  );
}

function AccountSettingsTab({ account, gameName, tasks, interruptions }: { account: GameAccount; gameName: string; tasks: GameTask[]; interruptions: InterruptionOption[] }) {
  const { data } = useConsole();
  const [editing, setEditing] = useState(false);
  const peerAccounts = data.accounts.filter((item) => item.gameId === account.gameId && item.id !== account.id);
  const partner1 = account.coopPartnerIds?.[0] ?? "";
  const partner2 = account.coopPartnerIds?.[1] ?? "";
  const savePartners = (next1: string, next2: string) => {
    const partnerIds = [next1, next2].filter((id, idx, arr) => id && arr.indexOf(id) === idx);
    return api(`/api/accounts/${enc(account.id)}/coop-partners`, { method: "PUT", body: { partnerIds } });
  };
  const peerName = (a: GameAccount): [string, string] => [a.id, a.nickname ? `${a.name} · ${a.nickname}` : a.name];
  const remove = () => void removeAccount(account, () => navigate(paths.accounts, { force: true }));
  const clearSnapshot = async () => {
    if (!await ask({ title: `清除「${account.name}」的登录快照？`, body: "之后要切到它，得重新读取登录", ok: "清除", danger: true })) return;
    await orToast(() => api(`/api/accounts/${enc(account.id)}/login-snapshot`, { method: "DELETE" }), "已清除登录快照");
  };

  return (
    <div className={s.stack}>
      <Card as="section" flush aria-label="资料">
        {editing ? <div style={{ padding: 16 }}><EditAccount account={account} done={() => setEditing(false)} /></div> : (
          <Row>
            <span style={{ flex: 1, minWidth: 0 }}>
              <b className={s.semi}>资料</b>
              <span className={ui.tiny} style={{ display: "block" }}>{[gameName, account.nickname, account.uid].filter(Boolean).join(" · ")}</span>
            </span>
            <button type="button" className={s.configLink} onClick={() => setEditing(true)}>修改 ›</button>
          </Row>
        )}
      </Card>

      <Card as="section" flush aria-label="协战与登录态">
        <CardHead title="协战与登录态" />
        {peerAccounts.length > 0 && (
          <Row>
            <span style={{ flex: 1 }}>1 号协战</span>
            <LiveSelect label="1 号协战" value={partner1} save={(next) => savePartners(next, next === partner2 ? "" : partner2)}
              options={[["", "不带"], ...peerAccounts.map(peerName)]} />
          </Row>
        )}
        {peerAccounts.length >= 2 && (
          <Row>
            <span style={{ flex: 1 }}>2 号协战</span>
            <LiveSelect label="2 号协战" value={partner2} save={(next) => savePartners(partner1, next)}
              options={[["", "不带"], ...peerAccounts.filter((a) => a.id !== partner1).map(peerName)]} />
          </Row>
        )}
        <Row>
          <span style={{ flex: 1, minWidth: 0 }}>
            登录快照
            <span className={ui.tiny} style={{ display: "block" }}>
              {account.hasLoginSnapshot
                ? `已存${account.snapshotUpdatedAt ? ` · ${shortTime(account.snapshotUpdatedAt)}` : ""}`
                : "未存 · 从在线设备读取"}
            </span>
          </span>
          <span style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <ReportDeviceLoginAction gameId={account.gameId} label={account.hasLoginSnapshot ? "重新读取" : "读取登录"} primary={!account.hasLoginSnapshot} small />
            {account.hasLoginSnapshot && <ApplyAccountLoginAction account={account} label="下发登录" primary small />}
            {account.hasLoginSnapshot && <Button small onClick={() => void clearSnapshot()}>清除</Button>}
          </span>
        </Row>
      </Card>

      {interruptions.length > 0 && (
        <Card as="section" flush aria-label="弹窗处理">
          <CardHead title={<>弹窗处理 <span className={ui.tiny} style={{ fontWeight: 400 }}>任务中途弹出时</span></>} />
          {interruptions.map((opt) => {
            const current = account.interruptions?.[opt.id] ?? opt.choices[0]?.id ?? "";
            return (
              <Row key={opt.id}>
                <span style={{ flex: 1 }}>{opt.name}</span>
                <LiveSelect label={opt.name} value={current} save={(next) => api(`/api/accounts/${enc(account.id)}/interruptions`,
                  { method: "PUT", body: { values: { ...(account.interruptions ?? {}), [opt.id]: next } } })}
                  options={opt.choices.map((c): [string, string] => [c.id, c.name])} />
              </Row>
            );
          })}
          <FollowUpSwitches gameId={account.gameId} />
        </Card>
      )}

      {tasks.length > 0 && (
        <Card as="section" flush aria-label="单跑参数">
          <CardHead title="单跑参数" />
          {tasks.map((task) => {
            const paused = (account.pausedTasks ?? []).find((p) => p.targetId === task.targetId && p.taskId === task.taskId);
            return (
              <Row key={task.taskId}>
                <span style={{ flex: 1, minWidth: 0 }} title={paused?.reason}>{task.name}</span>
                {paused && <Pill tone="warn">失败停用</Pill>}
                {paused && (
                  <Button small onClick={() => void orToast(() => api(`/api/accounts/${enc(account.id)}/paused-tasks/${enc(task.targetId)}/${enc(task.taskId)}`, { method: "DELETE" }), "已恢复")}>
                    恢复
                  </Button>
                )}
                <Link to={paths.taskDetail(task.targetId, task.taskId, account.id)} className={s.configLink}>配置 ›</Link>
              </Row>
            );
          })}
        </Card>
      )}

      <Button variant="danger" className={s.dangerWide} onClick={remove}>移除账号</Button>
    </div>
  );
}

function FollowUpSwitches({ gameId }: { gameId: string }) {
  const [items, setItems] = useState<EventFollowUp[] | null>(null);
  const load = () => api<EventFollowUp[]>("/api/notifications/follow-ups").then(setItems).catch(() => setItems([]));
  useEffect(() => { void load(); }, [gameId]); // eslint-disable-line react-hooks/exhaustive-deps
  const mine = (items ?? []).filter((item) => item.targetId === gameId);
  return (
    <>
      {mine.map((item) => (
        <Row key={item.id}>
          <span style={{ flex: 1 }}>{item.eventName}后去做{item.taskName}</span>
          <LiveSwitch checked={item.enabled} label={`${item.eventName}后去做${item.taskName}`} save={async (on) => {
            await api("/api/notifications/follow-ups", { method: "POST", body: { targetId: item.targetId, eventName: item.eventName, taskId: item.taskId, enabled: on } });
            await load();
          }} />
        </Row>
      ))}
    </>
  );
}
