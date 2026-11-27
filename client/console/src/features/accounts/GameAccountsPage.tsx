import { useEffect, useRef, useState, type ReactNode } from "react";
import { api, ApiFailure, enc } from "../../api/client";
import { ask } from "../../components/Confirm";
import type { Device, Game, GameAccount, LoginReportEvent } from "../../api/types";
import { Button, ButtonLink, Card, CardHead, Empty, Field, Form, join, Message, MoreMenu, Muted, PageHeader, Pill, Popover, Row, RowLink, Segments, ui } from "../../components/ui";
import { orToast, useAction } from "../../components/useAction";
import { toast } from "../../components/Toast";
import { jobHeadline, jobStatus, shortTime, type Tone } from "../../format";
import { leave, Link, navigate, paths } from "../../router";
import { awaitLoginReport, type ConsoleData } from "../../state/console";
import { useConsole } from "../../state/context";
import { Drawer } from "../../components/Drawer";
import { goPro, ProCount, ProLimitButton, ProLockRow, usePro } from "../../components/Pro";
import { InstallAppCard } from "../onboarding/Onboarding";
import { useWide } from "../../shell/useWidth";
import { PlanList } from "./Plans";
import { PlanTable } from "./PlansDesk";
import d from "../../shell/Desk.module.css";
import s from "./Accounts.module.css";

export function onlineGameDevices(devices: Device[], gameId: string, requireApp = false): Device[] {
  return devices.filter((d) => d.online && (d.apps.some((a) => a.gameId === gameId) || (!requireApp && d.apps.length === 0)));
}

/**
 * A text button that does [run] on the one device there is, or, with several, opens them to pick from (the button keeps
 * its words either way). With none it says what is missing.
 */
function DeviceAction({ label, devices, none, primary, small, link, run, itemText }: {
  label: string; devices: Device[]; none: string; primary?: boolean; small?: boolean; link?: boolean; run: (device: Device) => void; itemText: (device: Device) => string;
}) {
  if (devices.length <= 1) {
    return <Button small={small} variant={link ? "link" : primary ? "primary" : undefined} onClick={() => devices.length ? run(devices[0]) : toast(none, { tone: "bad" })}>{label}</Button>;
  }
  return (
    <Popover label={label} plain trigger={<span className={link ? ui.link : join(ui.button, small && ui.small, primary ? ui.primary : ui.ghost)}>{label} ▾</span>}>
      {(close) => (
        <>
          <span className={ui.menuLabel}>选设备</span>
          {devices.map((dev) => <button key={dev.id} type="button" role="menuitem" className={ui.menuItem} onClick={() => { close(); run(dev); }}>{itemText(dev)}</button>)}
        </>
      )}
    </Popover>
  );
}

/** 读取登录's outcome by the server's reason, in a few words. */
const LOGIN_REASONS: Record<string, string> = {
  no_root: "手机没 Root，读不了登录", no_role: "没读到角色，先进游戏再试", no_app: "这台设备没装这个游戏",
  quota: "账号已满，没存", capture_failed: "读取失败，再试一次", invalid: "读到的登录不对，再试一次",
};
type LoginState = { kind: "wait" } | { kind: "done"; report: LoginReportEvent } | { kind: "said"; text: string; ok: boolean };
function loginText(report: LoginReportEvent, accounts: GameAccount[]): [string, boolean] {
  if (!report.ok) return [LOGIN_REASONS[report.reason ?? ""] ?? (report.message || "读取失败"), false];
  const ids = [report.activeAccountId, ...report.created, ...report.synced].filter((id, i, all): id is string => !!id && all.indexOf(id) === i);
  const names = ids.map((id) => accounts.find((a) => a.id === id)?.name).filter(Boolean);
  const read = names.length ? `读到 ${names.join("、")}` : report.message || "已读取";
  // Others were kept, the one signed in was not: the quota.
  return report.skippedPrimary ? [`${read}；当前登录的没存，账号已满`, false] : [read, true];
}

/**
 * 读取登录 on a device: the phone reads who is signed in and the server makes or updates the account. The outcome comes
 * back as a login-report and is said beside the button (「读到 春樱共赏·归雨」, 「手机没 Root，读不了登录」).
 */
export function ReportDeviceLoginAction({ gameId, label = "读取登录", primary = false, small = true, link = false }: {
  gameId: string; label?: string; primary?: boolean; small?: boolean; link?: boolean;
}) {
  const { data } = useConsole();
  const pro = usePro();
  const candidates = onlineGameDevices(data.devices, gameId, false);
  const [state, setState] = useState<LoginState | null>(null);
  const stop = useRef<() => void>(() => {});
  useEffect(() => () => stop.current(), []);
  const trigger = async (dev: Device) => {
    stop.current();
    const appKey = dev.apps.find((a) => a.gameId === gameId)?.key;
    const qs = new URLSearchParams({ gameId });
    if (appKey) qs.set("appKey", appKey);
    setState({ kind: "wait" });
    let reply: { requestId?: string | null } | null;
    try { reply = await api<{ requestId?: string | null } | null>(`/api/devices/${enc(dev.id)}/report-login?${qs.toString()}`, { method: "POST" }); }
    catch (error) { setState({ kind: "said", text: error instanceof Error ? error.message : "读取失败", ok: false }); return; }
    const requestId = reply?.requestId;
    // A server that sends no id says nothing more.
    if (!requestId) { setState({ kind: "said", text: `已让「${dev.name}」读取`, ok: true }); return; }
    const timer = window.setTimeout(() => { stopListening(); setState({ kind: "said", text: "手机没回应", ok: false }); }, 60000);
    const stopListening = awaitLoginReport(requestId, (report) => { window.clearTimeout(timer); setState({ kind: "done", report }); });
    stop.current = () => { window.clearTimeout(timer); stopListening(); };
  };
  const [text, ok] = state?.kind === "done" ? loginText(state.report, data.accounts) : state?.kind === "said" ? [state.text, state.ok] : ["读取中…", true];
  const quota = state?.kind === "done" && (state.report.reason === "quota" || state.report.skippedPrimary) && pro.free;
  return (
    <span className={s.loginAction}>
      <DeviceAction label={label} devices={candidates} none="没有在线设备，先在手机打开护肝宝" primary={primary} small={small} link={link} run={(dev) => void trigger(dev)} itemText={(dev) => dev.name} />
      {state && <span role="status" className={join(s.loginNote, state.kind === "wait" ? ui.tiny : ok ? s.statusOk : s.statusBad)}>
        {text}{quota && <> · <button type="button" className={s.configLink} onClick={goPro}>开通 Pro</button></>}
      </span>}
    </span>
  );
}

export function ApplyAccountLoginAction({ account, label = "下发登录", primary = false, small = true, onNotice }: {
  account: GameAccount; label?: string; primary?: boolean; small?: boolean; onNotice?: (msg: string) => void;
}) {
  const { data } = useConsole();
  const candidates = onlineGameDevices(data.devices, account.gameId, true);
  // Logging the game in as another account replaces whoever is signed in there: ask first, and again when the server
  // says the device is running something (device_busy), then send it anyway.
  const trigger = async (dev: Device) => {
    const appKey = dev.apps.find((a) => a.gameId === account.gameId)?.key ?? null;
    if (!await ask({ title: `下发「${account.name}」到「${dev.name}」？`, body: "游戏会换成这个账号登录", ok: "下发" })) return;
    const send = (force: boolean) => api(`/api/accounts/${enc(account.id)}/apply-login`, { method: "POST", body: { deviceId: dev.id, appKey, ...(force ? { force: true } : {}) } });
    void orToast(async () => {
      try { await send(false); }
      catch (error) {
        if (!(error instanceof ApiFailure && error.status === 409 && error.code === "device_busy")) throw error;
        if (!await ask({ title: `${error.message || "设备正在运行"}，仍要下发？`, body: "正在跑的任务会被打断", ok: "仍要下发", danger: true })) return;
        await send(true);
      }
      const text = `已向「${dev.name}」下发登录`;
      if (onNotice) onNotice(text); else toast(text, { tone: "ok" });
    });
  };
  return <DeviceAction label={label} devices={candidates} none="没有装这个游戏的在线设备" primary={primary} small={small} run={(dev) => void trigger(dev)} itemText={(dev) => dev.name} />;
}

/**
 * The account's state in a few words, as the job page and the device say it: paused first, then what the phone waits for
 * (已暂停 · 设备 / 卡住 · 等无障碍 / 运行中 · 设备), else where it is signed in.
 */
export function accountNow(account: GameAccount, data: ConsoleData): [string, Tone] {
  const running = data.jobs.find((job) => job.accountId === account.id && job.state === "RUNNING");
  if (running) return jobHeadline(running, data.devices);
  const signedIn = data.devices.flatMap((device) => device.apps.filter((app) => app.accountId === account.id).map((app) => device.apps.length > 1 ? `${device.name} · ${app.name}` : device.name));
  if (signedIn.length) return [`已绑 ${signedIn.join("、")}`, "ok"];
  return ["空闲", ""];
}

/**
 * The dot on an account's chip: red with failures or runs to check, orange when stuck or paused, blue while running;
 * [title] counts them (「1 失败 · 1 待核对」). Null when there is nothing to mark.
 */
export function accountMark(account: GameAccount, data: ConsoleData): { tone: Tone; title: string } | null {
  const mine = data.jobs.filter((job) => job.accountId === account.id);
  // A task counts as failed while its latest run failed (a later success clears it); the jobs come newest first.
  const latest = new Map<string, (typeof mine)[number]>();
  for (const job of mine) { const key = `${job.targetId}:${job.taskId}`; if (!latest.has(key)) latest.set(key, job); }
  const failed = [...latest.values()].filter((job) => job.state === "FAILED").length;
  const pending = mine.filter((job) => job.state === "UNKNOWN").length;
  if (failed || pending) return { tone: "bad", title: [failed && `${failed} 失败`, pending && `${pending} 待核对`].filter(Boolean).join(" · ") };
  const [now, tone] = accountNow(account, data);
  if (tone === "warn" || tone === "info") return { tone, title: now };
  return null;
}

/** 切换账号: the account chips, each with its [accountMark] dot; [end] closes the row (the limit's 「＋ · Pro」). */
function AccountChips({ accounts, value, onChange, end }: { accounts: GameAccount[]; value: string; onChange: (id: string) => void; end?: ReactNode }) {
  const { data } = useConsole();
  return (
    <div className={ui.chips} role="radiogroup" aria-label="切换账号">
      {accounts.map((account) => {
        const mark = accountMark(account, data);
        return (
          <button key={account.id} type="button" role="radio" aria-checked={account.id === value} title={mark?.title}
            className={join(ui.chip, s.chip, account.id === value && ui.chipOn)} onClick={() => onChange(account.id)}>
            {mark && <span className={join(s.mark, s[`mark_${mark.tone}`])} aria-hidden="true" />}
            {account.name}
            {mark && <span className="visually-hidden">（{mark.title}）</span>}
          </button>
        );
      })}
      {end}
    </div>
  );
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
  // Opening a plan of another account (its address) shows that account behind the drawer, and keeps it after closing.
  const routed = accountId ? data.accounts.find((a) => a.id === accountId) : undefined;
  useEffect(() => { if (routed) { setSelectedId(routed.id); setChosen(routed.gameId); } }, [routed]);
  const activeAccount = accounts.find((a) => a.id === (routed?.id ?? selectedId)) ?? accounts[0];
  const isOnmyoji = !gameId || gameId === "onmyoji";
  const pro = usePro();
  // Game accounts count over all games, as the server counts them.
  const accountsFull = pro.full("maxGameAccounts", data.accounts.length);
  const accountCount = pro.count("maxGameAccounts", data.accounts.length);
  // Onmyoji accounts are made by reading a phone's login, so there is no 添加 to lock: the chips end with 「＋ · Pro」.
  const moreAccounts = isOnmyoji && accountsFull && <ProLimitButton small text="＋" what="游戏账号" className={s.chipLimit} />;
  const noDevice = data.devices.length === 0;

  return (
    <>
      <PageHeader title="账号与计划" aside={
        <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {!isOnmyoji && <ProCount text={accountCount} />}
          {accounts.length > 0 && <Button small onClick={() => setManaging(!managing)}>{managing ? "回到计划" : "管理账号"}</Button>}
          {isOnmyoji
            // The empty state says how accounts come in; with some, reading the phone's login is a second way.
            ? accounts.length > 0 && <ReportDeviceLoginAction gameId={gameId || "onmyoji"} label="读取设备登录" small />
            : accountsFull && !adding ? <ProLimitButton small text="添加账号" what="游戏账号" />
            : <Button small variant="primary" aria-expanded={adding} onClick={() => setAdding(!adding)}>{adding ? "收起" : "＋ 添加账号"}</Button>}
        </span>
      } />
      {!isOnmyoji && adding && <AddAccount games={data.games} gameId={gameId} done={() => setAdding(false)} />}
      {noDevice && <InstallAppCard />}
      {data.games.length === 0 ? !noDevice && <Card><Empty>先连一台设备</Empty></Card> : (
        <>
          {data.games.length > 1 && <Segments label="游戏" value={gameId} onChange={(id) => leave(() => { setChosen(id); if (accountId) navigate(paths.accounts, { force: true }); })}
            items={data.games.map((g) => [g.id, g.name])} />}
          {accounts.length === 0 ? (
            <Card>
              {isOnmyoji ? (
                <div className={s.emptyHow}>
                  <b>还没有阴阳师账号</b>
                  <Muted>在手机护肝宝里进游戏，会自动识别角色</Muted>
                  {!noDevice && <span className={s.emptyAlt}><span className={ui.tiny}>手机已 Root？</span><ReportDeviceLoginAction gameId={gameId} label="读取设备登录" link /></span>}
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
              {moreAccounts && <div className={s.tableEnd}>{moreAccounts}</div>}
            </Card>
          ) : activeAccount && (
            <>
              <AccountChips accounts={accounts} value={activeAccount.id} end={moreAccounts}
                onChange={(id) => leave(() => { setSelectedId(id); if (accountId) navigate(paths.accounts, { force: true }); })} />
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
                        const [label, tone] = jobStatus(job, data.devices);
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
  const pro = usePro();
  const [now, tone] = accountNow(account, data);
  const partners = (account.coopPartnerIds ?? []).map((id) => accounts.find((a) => a.id === id)?.name).filter(Boolean).join("、");
  const popup = game?.interruptions?.[0];
  const popupChoice = popup ? popup.choices.find((c) => c.id === (account.interruptions?.[popup.id] ?? popup.choices[0]?.id))?.name : null;
  const paused = (account.pausedTasks ?? []).map((p) => game?.tasks.find((t) => t.taskId === p.taskId)?.name ?? p.taskId);
  return (
    <Card flush as="section" aria-label="当前账号">
      <CardHead title={account.name} aside={<><Pill tone={tone} live>{now}</Pill><ButtonLink small to={paths.account(account.id)}>设置</ButtonLink></>} />
      {pro.locked("allowCoopTeam")
        ? <ProLockRow label="协战" />
        : <Row><span style={{ flex: 1 }}>协战</span><span className={ui.tiny}>{partners || "不带"}</span></Row>}
      <Row>
        <span style={{ flex: 1 }}>登录快照</span>
        <span className={ui.tiny}>{account.hasLoginSnapshot ? "已存" : "未存"}</span>
        {/* 下发 replaces the game's login on a phone, so it lives in 设置, not on this card. */}
        {!account.hasLoginSnapshot && <ReportDeviceLoginAction gameId={account.gameId} label="读取登录" small />}
      </Row>
      {popup && <Row><span style={{ flex: 1 }}>弹窗处理</span><span className={ui.tiny}>{popup.name}：{popupChoice ?? "—"}</span></Row>}
      <Row><span style={{ flex: 1 }}>失败停用</span>{paused.length ? paused.map((name) => <Pill key={name} tone="warn">{name}</Pill>) : <span className={ui.tiny}>—</span>}</Row>
    </Card>
  );
}

function AccountRow({ account }: { account: GameAccount }) {
  const { data } = useConsole();
  const [editing, setEditing] = useState(false);
  const [now, tone] = accountNow(account, data);
  const last = data.jobs.find((job) => job.accountId === account.id);
  const remove = () => removeAccount(account);
  if (editing) return <tr><td colSpan={4}><EditAccount account={account} done={() => setEditing(false)} /></td></tr>;
  return (
    <tr>
      <td><Link to={paths.account(account.id)} className={s.name}>{account.name}</Link><br /><Muted as="span">{[account.uid ? `UID ${account.uid}` : null, account.nickname].filter(Boolean).join(" · ") || "—"}</Muted></td>
      <td className={tone === "info" ? s.runCell : tone === "warn" ? s.warnCell : undefined}>{now}</td>
      <td className={s.mutedCell}>{last ? `${shortTime(last.updatedAt)}${last.deviceName ? ` · ${last.deviceName}` : ""}` : "—"}</td>
      <td className={s.ops}><MoreMenu label={`${account.name} 的操作`} actions={[["编辑", () => setEditing(true)], ["移除", remove, true]]} /></td>
    </tr>
  );
}

/** 移除账号, once the user agrees: its plans go with it. */
export async function removeAccount(account: GameAccount, after?: () => void) {
  if (!await ask({ title: `移除「${account.name}」？`, body: "它的计划一起删除，不能恢复", ok: "移除", danger: true })) return;
  await orToast(async () => { await api(`/api/accounts/${enc(account.id)}`, { method: "DELETE" }); after?.(); }, "已移除");
}

export function EditAccount({ account, done }: { account: GameAccount; done: () => void }) {
  const [name, setName] = useState(account.name);
  const [uid, setUid] = useState(account.uid ?? "");
  const [nickname, setNickname] = useState(account.nickname ?? "");
  const { busy, message, run } = useAction();
  return (
    <>
      <Form inline onSubmit={() => run(async () => { await api(`/api/accounts/${enc(account.id)}`, { method: "PUT", body: { name, uid: uid || null, nickname: nickname || null } }); toast("已保存", { tone: "ok" }); done(); })}>
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
