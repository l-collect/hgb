import { useEffect, useState, type ReactNode } from "react";
import { api, enc } from "../../api/client";
import type { Device, Game, GameAccount } from "../../api/types";
import { Button, ButtonLink, Card, CardHead, Chips, Empty, Field, Form, Message, MoreMenu, Muted, PageHeader, Pill, Row, RowLink, Segments, ui } from "../../components/ui";
import { orAlert, useAction } from "../../components/useAction";
import { jobStatus, shortTime, type Tone } from "../../format";
import { Link, navigate, paths } from "../../router";
import type { ConsoleData } from "../../state/console";
import { useConsole } from "../../state/context";
import { Drawer } from "../../components/Drawer";
import { useWide } from "../../shell/useWidth";
import { PlanList } from "./Plans";
import { PlanTable } from "./PlansDesk";
import d from "../../shell/Desk.module.css";
import s from "./Accounts.module.css";

export function onlineGameDevices(devices: Device[], gameId: string, requireApp = false): Device[] {
  return devices.filter((d) => d.online && (d.apps.some((a) => a.gameId === gameId) || (!requireApp && d.apps.length === 0)));
}

export function ReportDeviceLoginAction({ gameId, label = "读取设备登录", primary = false, small = true, onNotice }: {
  gameId: string; label?: string; primary?: boolean; small?: boolean; onNotice?: (msg: string) => void;
}) {
  const { data } = useConsole();
  const candidates = onlineGameDevices(data.devices, gameId, false);
  const trigger = (dev: Device) => {
    const appKey = dev.apps.find((a) => a.gameId === gameId)?.key;
    const qs = new URLSearchParams({ gameId });
    if (appKey) qs.set("appKey", appKey);
    orAlert(async () => {
      await api(`/api/devices/${enc(dev.id)}/report-login?${qs.toString()}`, { method: "POST" });
      onNotice?.(`已通知「${dev.name}」读取本机阴阳师登录信息，识别后将自动建号并加密上传登录态`);
    });
  };
  if (candidates.length <= 1) {
    return (
      <Button small={small} variant={primary ? "primary" : undefined} onClick={() => {
        if (candidates.length === 0) {
          alert("当前没有在线设备，请先在手机打开护肝宝并连上云端");
          return;
        }
        trigger(candidates[0]);
      }}>{label}</Button>
    );
  }
  return (
    <MoreMenu label={label} actions={candidates.map((dev): [string, () => void] => [`从「${dev.name}」读取登录`, () => trigger(dev)])} />
  );
}

export function ApplyAccountLoginAction({ account, label = "下发到设备", primary = false, small = true, onNotice }: {
  account: GameAccount; label?: string; primary?: boolean; small?: boolean; onNotice?: (msg: string) => void;
}) {
  const { data } = useConsole();
  const candidates = onlineGameDevices(data.devices, account.gameId, true);
  const trigger = (dev: Device) => {
    const appKey = dev.apps.find((a) => a.gameId === account.gameId)?.key ?? null;
    orAlert(async () => {
      await api(`/api/accounts/${enc(account.id)}/apply-login`, { method: "POST", body: { deviceId: dev.id, appKey } });
      onNotice?.(`已向「${dev.name}」下发「${account.name}」的登录信息`);
    });
  };
  if (candidates.length <= 1) {
    return (
      <Button small={small} variant={primary ? "primary" : undefined} onClick={() => {
        if (candidates.length === 0) {
          alert("当前没有装有该游戏的在线设备");
          return;
        }
        trigger(candidates[0]);
      }}>{label}</Button>
    );
  }
  return (
    <MoreMenu label={label} actions={candidates.map((dev): [string, () => void] => [`下发到「${dev.name}」`, () => trigger(dev)])} />
  );
}

export function accountNow(account: GameAccount, data: ConsoleData): [string, Tone] {
  const running = data.jobs.find((job) => job.accountId === account.id && job.state === "RUNNING");
  if (running) return [`运行中 · ${running.deviceName ?? "设备"}`, "info"];
  const signedIn = data.devices.flatMap((device) => device.apps.filter((app) => app.accountId === account.id).map((app) => device.apps.length > 1 ? `${device.name} · ${app.name}` : device.name));
  if (signedIn.length) return [`已绑 ${signedIn.join("、")}`, "ok"];
  return ["空闲", ""];
}

/**
 * Level-1 账号与计划: account chips; the plans on the left, the account's summary and latest runs on the right.
 * On a wide window the plans are a table (or the week), and [drawer] (a plan being edited, at its own address) slides in
 * over the page for [accountId], which stays in view.
 */
export function GameAccountsPage({ accountId, drawer }: { accountId?: string; drawer?: ReactNode } = {}) {
  const { data } = useConsole();
  const wide = useWide();
  const [adding, setAdding] = useState(false);
  const [managing, setManaging] = useState(false);
  const [chosen, setChosen] = useState(data.games[0]?.id ?? "");
  const gameId = data.games.some((game) => game.id === chosen) ? chosen : data.games[0]?.id ?? "";
  const game = data.games.find((g) => g.id === gameId);
  const accounts = data.accounts.filter((account) => account.gameId === gameId);
  const [selectedId, setSelectedId] = useState(accounts[0]?.id ?? "");
  const [syncNotice, setSyncNotice] = useState<string | null>(null);
  // Opening a plan of another account (its address) shows that account behind the drawer, and keeps it after closing.
  const routed = accountId ? data.accounts.find((a) => a.id === accountId) : undefined;
  useEffect(() => { if (routed) { setSelectedId(routed.id); setChosen(routed.gameId); } }, [routed]);
  const activeAccount = accounts.find((a) => a.id === (routed?.id ?? selectedId)) ?? accounts[0];
  const isOnmyoji = !gameId || gameId === "onmyoji";

  return (
    <>
      <PageHeader title="账号与计划" aside={
        <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {accounts.length > 0 && <Button small onClick={() => setManaging(!managing)}>{managing ? "回到计划" : "管理账号"}</Button>}
          {isOnmyoji
            ? <ReportDeviceLoginAction gameId={gameId || "onmyoji"} label="读取设备登录" primary small onNotice={setSyncNotice} />
            : <Button small variant="primary" aria-expanded={adding} onClick={() => setAdding(!adding)}>{adding ? "收起" : "＋ 添加账号"}</Button>}
        </span>
      } />
      {syncNotice && <Message text={syncNotice} ok />}
      {!isOnmyoji && adding && <AddAccount games={data.games} gameId={gameId} done={() => setAdding(false)} />}
      {data.games.length === 0 ? <Card><Empty>先连一台设备</Empty></Card> : (
        <>
          {data.games.length > 1 && <Segments label="游戏" value={gameId} onChange={setChosen}
            items={data.games.map((g) => [g.id, g.name])} />}
          {accounts.length === 0 ? (
            <Card>
              {isOnmyoji ? (
                <div style={{ padding: "24px 16px", textAlign: "center", display: "grid", gap: 10, justifyItems: "center" }}>
                  <b>还没有阴阳师账号</b>
                  <Muted>无需手动新建：在手机登录阴阳师并允许护肝宝 Root 权限后，直接读取当前机器登录信息即可自动建号并加密上传登录态。</Muted>
                  <ReportDeviceLoginAction gameId={gameId} label="读取设备登录建号" primary small={false} onNotice={setSyncNotice} />
                </div>
              ) : <Empty>还没有账号</Empty>}
            </Card>
          ) : managing ? (
            <Card flush>
              <div className={s.tableBox}>
                <table className={s.table}>
                  <thead><tr><th>名称</th><th>状态</th><th>最近运行</th><th><span className="visually-hidden">操作</span></th></tr></thead>
                  <tbody>{accounts.map((account) => <AccountRow key={account.id} account={account} />)}</tbody>
                </table>
              </div>
            </Card>
          ) : activeAccount && (
            <>
              <Chips label="切换账号" value={activeAccount.id} onChange={(id) => { setSelectedId(id); if (accountId) navigate(paths.accounts); }}
                items={accounts.map((a): [string, string] => [a.id, a.name])} />
              <div className={wide ? d.colsMain : s.columns}>
                {wide
                  ? <PlanTable account={activeAccount} game={game} plans={data.plans} jobs={data.jobs} />
                  : <PlanList account={activeAccount} game={game} plans={data.plans} jobs={data.jobs} />}
                <div className={s.stack}>
                  <AccountSummary account={activeAccount} accounts={accounts} game={game} />
                  <Card flush as="section" aria-label="最近战报">
                    <CardHead title="最近战报" aside={<Link to={paths.account(activeAccount.id, "runs")} className={ui.tiny} style={{ textDecoration: "none" }}>全部 ›</Link>} />
                    {(() => {
                      const runs = data.jobs.filter((job) => job.accountId === activeAccount.id).slice(0, 3);
                      return runs.length ? runs.map((job) => {
                        const [label, tone] = jobStatus(job);
                        return (
                          <RowLink key={job.id} to={paths.job(job.id)}>
                            <span style={{ flex: 1, minWidth: 0 }}><span style={{ display: "block", fontWeight: 500 }}>{job.taskName}</span><span className={ui.tiny}>{shortTime(job.updatedAt)}{job.deviceName ? ` · ${job.deviceName}` : ""}</span></span>
                            <Pill tone={tone}>{label}</Pill>
                          </RowLink>
                        );
                      }) : <Empty>还没有战报</Empty>;
                    })()}
                  </Card>
                </div>
              </div>
            </>
          )}
        </>
      )}
      {wide && drawer && <Drawer label="编辑计划" onClose={() => navigate(paths.accounts)}>{drawer}</Drawer>}
    </>
  );
}

/** The account at a glance: its state, partners, login snapshot, pop-up handling and paused tasks; 设置 opens the rest. */
function AccountSummary({ account, accounts, game }: { account: GameAccount; accounts: GameAccount[]; game?: Game }) {
  const { data } = useConsole();
  const [now, tone] = accountNow(account, data);
  const partners = (account.coopPartnerIds ?? []).map((id) => accounts.find((a) => a.id === id)?.name).filter(Boolean).join("、");
  const popup = game?.interruptions?.[0];
  const popupChoice = popup ? popup.choices.find((c) => c.id === (account.interruptions?.[popup.id] ?? popup.choices[0]?.id))?.name : null;
  const paused = (account.pausedTasks ?? []).map((p) => game?.tasks.find((t) => t.taskId === p.taskId)?.name ?? p.taskId);
  return (
    <Card flush as="section" aria-label="当前账号">
      <CardHead title={account.name} aside={<><Pill tone={tone}>{now}</Pill><ButtonLink small to={paths.account(account.id)}>设置</ButtonLink></>} />
      <Row><span style={{ flex: 1 }}>协战</span><span className={ui.tiny}>{partners || "不带"}</span></Row>
      <Row>
        <span style={{ flex: 1 }}>登录快照</span>
        <span className={ui.tiny}>{account.hasLoginSnapshot ? "已加密保存" : "未存"}</span>
        {account.hasLoginSnapshot
          ? <ApplyAccountLoginAction account={account} label="下发到设备" small />
          : <ReportDeviceLoginAction gameId={account.gameId} label="读取上传" small />}
      </Row>
      {popup && <Row><span style={{ flex: 1 }}>弹窗处理</span><span className={ui.tiny}>{popup.name}：{popupChoice ?? "—"}</span></Row>}
      <Row><span style={{ flex: 1 }}>暂停的任务</span>{paused.length ? paused.map((name) => <Pill key={name} tone="warn">{name}</Pill>) : <span className={ui.tiny}>无</span>}</Row>
    </Card>
  );
}

function AccountRow({ account }: { account: GameAccount }) {
  const { data } = useConsole();
  const [editing, setEditing] = useState(false);
  const [now, tone] = accountNow(account, data);
  const last = data.jobs.find((job) => job.accountId === account.id);
  const remove = () => {
    if (!confirm(`移除「${account.name}」和它的计划？`)) return;
    orAlert(() => api(`/api/accounts/${enc(account.id)}`, { method: "DELETE" }));
  };
  if (editing) return <tr><td colSpan={4}><EditAccount account={account} done={() => setEditing(false)} /></td></tr>;
  return (
    <tr>
      <td><Link to={paths.account(account.id)} className={s.name}>{account.name}</Link><br /><Muted as="span">{[account.uid ? `UID ${account.uid}` : null, account.nickname].filter(Boolean).join(" · ") || "—"}</Muted></td>
      <td className={tone === "info" ? s.runCell : undefined}>{now}</td>
      <td className={s.mutedCell}>{last ? `${shortTime(last.updatedAt)}${last.deviceName ? ` · ${last.deviceName}` : ""}` : "—"}</td>
      <td className={s.ops}><MoreMenu label={`${account.name} 的操作`} actions={[["编辑", () => setEditing(true)], ["移除", remove, true]]} /></td>
    </tr>
  );
}

export function EditAccount({ account, done }: { account: GameAccount; done: () => void }) {
  const [name, setName] = useState(account.name);
  const [uid, setUid] = useState(account.uid ?? "");
  const [nickname, setNickname] = useState(account.nickname ?? "");
  const { busy, message, run } = useAction();
  return (
    <>
      <Form inline onSubmit={() => run(async () => { await api(`/api/accounts/${enc(account.id)}`, { method: "PUT", body: { name, uid: uid || null, nickname: nickname || null } }); done(); })}>
        <Field label="名称"><input type="text" required maxLength={40} value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="昵称"><input type="text" maxLength={40} value={nickname} onChange={(e) => setNickname(e.target.value)} /></Field>
        <Field label="UID"><input type="text" maxLength={40} value={uid} onChange={(e) => setUid(e.target.value)} /></Field>
        <div className={s.formButtons}><Button variant="primary" type="submit" disabled={busy}>保存</Button><Button onClick={done}>取消</Button></div>
      </Form>
      <Message text={message?.text} ok={message?.ok} />
    </>
  );
}

function AddAccount({ games, gameId, done }: { games: Game[]; gameId: string; done: () => void }) {
  const [game, setGame] = useState(gameId);
  const [name, setName] = useState(""); const [uid, setUid] = useState(""); const [nickname, setNickname] = useState("");
  const { busy, message, run } = useAction();
  const target = games.some((item) => item.id === game) ? game : games[0]?.id ?? "";
  if (!games.length) return null;
  return (
    <Card as="section" aria-label="添加账号" style={{ marginBottom: 14 }}>
      <Form inline onSubmit={() => run(async () => {
        await api<GameAccount>("/api/accounts", { method: "POST", body: { gameId: target, name, uid: uid || null, nickname: nickname || null } });
        setName(""); setUid(""); setNickname(""); done();
      })}>
        {games.length > 1 && <Field label="游戏"><select value={target} onChange={(e) => setGame(e.target.value)}>{games.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>}
        <Field label="名称"><input type="text" placeholder="如：主号" required maxLength={40} value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="游戏昵称"><input type="text" placeholder="选填" maxLength={40} value={nickname} onChange={(e) => setNickname(e.target.value)} /></Field>
        <Field label="UID"><input type="text" placeholder="选填" maxLength={40} value={uid} onChange={(e) => setUid(e.target.value)} /></Field>
        <div className={s.formButtons}><Button variant="primary" type="submit" disabled={busy}>添加</Button></div>
      </Form>
      <Message text={message?.text} ok={message?.ok} />
    </Card>
  );
}
