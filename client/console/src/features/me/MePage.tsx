import { useEffect, useMemo, useState } from "react";
import { api, apiUrl, enc } from "../../api/client";
import type { Account, MergeOffer } from "../../api/types";
import { Breadcrumb, Button, ButtonLink, Card, Grow, MoreMenu, Pill, Popover, Row, TextSelect, ui } from "../../components/ui";
import { applyAppearance, readAppearance, type Appearance } from "../../theme/appearance";
import { orToast, useOptimistic } from "../../components/useAction";
import { toast } from "../../components/Toast";
import { ask } from "../../components/Confirm";
import { platformName, shortTime } from "../../format";
import { Link, paths } from "../../router";
import { useConsole } from "../../state/context";
import { BindEmail, DeleteAccount, MergeCard } from "./AccountActions";
import s from "./Me.module.css";

/** 我的: the member summary, the developer workbench, preferences, and help; 会员 › opens 会员与账号. */
export function MePage() {
  const { data, account: initial } = useConsole();
  const [account, setAccount] = useState(initial);
  // Read again: a code redeemed on 会员与账号 changes the tier shown here.
  useEffect(() => { api<Account>("/api/me").then(setAccount).catch(() => {}); }, []);
  const [look, setLook] = useState<Appearance>(readAppearance);
  const who = account.email ?? account.githubLogin ?? "";
  const isPro = account.tier === "PRO";
  const pickLook = (next: Appearance) => { setLook(next); applyAppearance(next); };
  return (
    <div className={s.page}>
      <h1 className={s.hidden}>我的</h1>
      <Card flush as="section" aria-label="会员">
        <Link to={paths.meAccount} className={s.profile}>
          <span className={s.avatar} aria-hidden="true">{who.slice(0, 1).toUpperCase()}</span>
          <span className={s.who}>
            <span className={s.whoLine}><b className={s.email}>{who}</b>{isPro && <Pill tone="soft">Cloud Pro</Pill>}</span>
            <span className={ui.tiny}>{data.devices.length} 台设备 · {data.accounts.length} 个账号 · {data.plans.length} 个计划</span>
          </span>
          <span className={ui.tiny}>会员 ›</span>
        </Link>
      </Card>
      <Card flush as="section" aria-label="开发者工作台">
        <Row>
          <Grow><b className={s.semi}>开发者工作台</b><span className={ui.tiny} style={{ display: "block" }}>采样、试跑、联调</span></Grow>
          <ButtonLink small to={paths.dev}>进入</ButtonLink>
        </Row>
      </Card>
      <Card flush as="section" aria-label="偏好">
        <Row>
          <Grow>外观</Grow>
          <TextSelect label="外观" value={look} onChange={pickLook} options={[["auto", "跟随系统"], ["light", "浅色"], ["dark", "深色"]]} />
        </Row>
        <TimeZone zone={data.timeZone} />
      </Card>
      <Card flush as="section" aria-label="帮助与关于">
        <a className={s.linkRow} href="/docs/"><span>使用文档</span><span className={ui.tiny}>›</span></a>
        <a className={s.linkRow} href={`https://github.com/${import.meta.env.VITE_CODE_REPO}/issues`} target="_blank" rel="noreferrer"><span>反馈问题</span><span className={ui.tiny}>GitHub ↗</span></a>
        <Link className={s.linkRow} to={paths.privacy}><span>隐私政策</span><span className={ui.tiny}>›</span></Link>
        <Link className={s.linkRow} to={paths.terms}><span>服务条款</span><span className={ui.tiny}>›</span></Link>
      </Card>
    </div>
  );
}

const dayText = (at: number) => new Date(at).toLocaleDateString("sv-SE");

/** What 会员与账号 does, shared by the phone page and the wide settings page: redeem a code, unlink GitHub, unbind a device, sign out. */
export function useMeActions() {
  const { account: initial, signedOut } = useConsole();
  const [account, setAccount] = useState(initial);
  const [codeInput, setCodeInput] = useState("");
  const [redeeming, setRedeeming] = useState(false);
  const redeem = async (done?: () => void) => {
    const trimmed = codeInput.trim();
    if (!trimmed || redeeming) return;
    setRedeeming(true);
    try {
      await orToast(async () => {
        const updated = await api<Account>("/api/me/redeem", { method: "POST", body: { code: trimmed } });
        setAccount(updated);
        setCodeInput("");
        toast(updated.proExpiresAt ? `已续至 ${dayText(updated.proExpiresAt)}` : "已开通永久 Pro", { tone: "ok", ms: 4000 });
        done?.();
      });
    } finally { setRedeeming(false); }
  };
  const unlink = async () => {
    if (!await ask({ title: "解绑 GitHub？", body: "之后只能用邮箱登录", ok: "解绑", danger: true })) return;
    await orToast(async () => { await api("/api/auth/github", { method: "DELETE" }); setAccount(await api<Account>("/api/me")); }, "已解绑");
  };
  const unbind = async (id: string, name: string) => {
    if (!await ask({ title: `解绑「${name}」？`, body: "它会下线，在跑的作业记为待核对", ok: "解绑", danger: true })) return;
    await orToast(() => api(`/api/devices/${enc(id)}`, { method: "DELETE" }), "已解绑");
  };
  const logout = () => void orToast(async () => { await api("/api/auth/logout", { method: "POST", body: {} }); signedOut(); });
  const expires = account.proExpiresAt ? dayText(account.proExpiresAt) : null;
  const isPro = account.tier === "PRO";
  // A Pro without an end date has nothing to extend.
  const forever = isPro && !account.proExpiresAt;
  return { account, setAccount, codeInput, setCodeInput, redeem, redeeming, unlink, unbind, logout, expires, isPro, forever, signedOut };
}

/** 会员与账号: the tier when Pro and the activation code, how this account signs in, its devices, and signing out. */
export function MeAccountPage() {
  const { data } = useConsole();
  const { account, setAccount, codeInput, setCodeInput, redeem: redeemCode, redeeming: sending, unlink, unbind, logout, expires, isPro, forever, signedOut } = useMeActions();
  const [binding, setBinding] = useState(false);
  const [offer, setOffer] = useState<MergeOffer | null>(null);
  const [redeeming, setRedeeming] = useState(false);
  const [showDevices, setShowDevices] = useState(false);
  const redeem = () => void redeemCode(() => setRedeeming(false));
  return (
    <div className={s.page}>
      <Breadcrumb items={[["我的", paths.me], ["会员与账号", null]]} />
      <h1 className={s.title}>会员与账号</h1>
      <Card as="section" aria-label="会员" className={s.pro}>
        {isPro && <b className={s.proName}>Cloud Pro · {expires ? `到期 ${expires}` : "永久"}</b>}
        {!redeeming && !forever && <Button className={s.wide} onClick={() => setRedeeming(true)}>{isPro ? "用激活码续期" : "兑换激活码"}</Button>}
      </Card>
      {redeeming && (
        <Card as="section" aria-label="激活码" className={s.codeCard}>
          <label className={s.codeLabel} htmlFor="pro-code">激活码</label>
          <input id="pro-code" type="text" value={codeInput} onChange={(e) => setCodeInput(e.target.value)} placeholder="HGB-PRO-…" />
          <div className={s.twoButtons}>
            <Button onClick={() => { setRedeeming(false); setCodeInput(""); }}>取消</Button>
            <Button variant="primary" onClick={redeem} disabled={!codeInput.trim() || sending}>{sending ? "兑换中…" : "兑换"}</Button>
          </div>
        </Card>
      )}
      <Card flush as="section" aria-label="登录方式">
        <Row>
          <Grow>邮箱<span className={ui.tiny} style={{ display: "block" }}>{account.email ? `${account.email}${account.hasPassword ? "" : " · 验证码登录"}` : "未绑定"}</span></Grow>
          {account.email ? <span className={ui.tiny}>已绑定</span> : !binding && <Button small onClick={() => setBinding(true)}>绑定</Button>}
          {binding && !offer && <BindEmail done={(next) => { setAccount(next); setBinding(false); }} merge={setOffer} />}
        </Row>
        <Row>
          <Grow>GitHub<span className={ui.tiny} style={{ display: "block" }}>{account.githubLogin ?? "未绑定"}</span></Grow>
          {account.githubLogin ? <GithubUnlink account={account} unlink={unlink} /> : <a className={s.button} href={apiUrl("/api/auth/github/start?link=1")}>绑定</a>}
        </Row>
        <button type="button" className={s.linkRow} aria-expanded={showDevices} onClick={() => setShowDevices(!showDevices)}>
          <span>已绑定的设备</span><span className={ui.tiny}>{data.devices.length} 台 {showDevices ? "▴" : "›"}</span>
        </button>
        {showDevices && data.devices.map((device) => (
          <Row key={device.id} className={s.subRow}>
            <Grow>{device.name}<span className={ui.tiny} style={{ display: "block" }}>{platformName(device.platform)} · {device.online ? "在线" : `上次 ${shortTime(device.lastSeenAt)}`}</span></Grow>
            <MoreMenu label={`${device.name} 的操作`} actions={[["解绑", () => void unbind(device.id, device.name), true]]} />
          </Row>
        ))}
        {showDevices && <Row className={s.subRow}><Grow><span className={ui.tiny}>在别的设备装 App 并登录即可添加</span></Grow><a href={`https://github.com/${import.meta.env.VITE_CODE_REPO}/releases/latest`}>下载</a></Row>}
      </Card>
      {offer && <MergeCard token={offer.token} offer={offer} settled={(merged) => { setOffer(null); setBinding(false); if (merged) location.reload(); }} />}
      <Button variant="danger" className={s.wide} onClick={logout}>退出登录</Button>
      <div className={s.footer}><DeleteAccount account={account} deleted={signedOut} /></div>
    </div>
  );
}

/** 解绑 GitHub; without an email it would leave no way to sign in, so it is grey with the reason beside it. */
export function GithubUnlink({ account, unlink }: { account: Account; unlink: () => void | Promise<void> }) {
  if (account.email) return <Button small onClick={() => void unlink()}>解绑</Button>;
  return <span className={s.inlineNote}><span className={ui.tiny}>先绑邮箱</span><Button small disabled>解绑</Button></span>;
}

/** The zones most players pick, first in the list; the rest follow, searchable. */
const COMMON_ZONES: [string, string][] = [
  ["Asia/Shanghai", "北京时间"], ["Asia/Hong_Kong", "香港"], ["Asia/Taipei", "台北"], ["Asia/Tokyo", "东京"], ["Asia/Seoul", "首尔"],
  ["Asia/Singapore", "新加坡"], ["Europe/London", "伦敦"], ["Europe/Berlin", "柏林"], ["America/Los_Angeles", "洛杉矶"], ["America/New_York", "纽约"],
  ["Australia/Sydney", "悉尼"],
];
const zoneName = (zone: string) => COMMON_ZONES.find(([id]) => id === zone)?.[1] ?? zone;

/**
 * The plan time zone: the common ones first, a search box for the rest, and a question before it changes, since every
 * plan then runs by it.
 */
export function TimeZone({ zone }: { zone: string }) {
  const [query, setQuery] = useState("");
  const live = useOptimistic(zone);
  const zones = useMemo(() => {
    const all = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.("timeZone") ?? [];
    const common = new Set(COMMON_ZONES.map(([id]) => id));
    return [...COMMON_ZONES, ...(all.includes(zone) || common.has(zone) ? [] : [[zone, zone] as [string, string]]),
      ...all.filter((id) => !common.has(id)).map((id): [string, string] => [id, id])];
  }, [zone]);
  const needle = query.trim().toLowerCase();
  const shown = needle ? zones.filter(([id, name]) => id.toLowerCase().includes(needle) || name.includes(query.trim())) : zones;
  const pick = async (next: string) => {
    if (next === zone) return;
    if (!await ask({ title: `计划时区改成${zoneName(next)}？`, body: "所有计划按新时区的时间跑", ok: "改" })) return;
    if (await live.commit(next, () => api("/api/me/time-zone", { method: "PUT", body: { timeZone: next } }))) toast("已保存", { tone: "ok" });
  };
  return (
    <Row>
      <Grow>计划时区</Grow>
      {live.error && <span className={s.zoneError} role="alert">{live.error}</span>}
      <Popover label="计划时区" plain align="end" trigger={<span className={ui.textSelect} aria-busy={live.pending || undefined}>{zoneName(live.value)}<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg></span>}>
        {(close) => (
          <div className={s.zonePanel}>
            <input type="search" autoFocus className={s.zoneSearch} placeholder="搜时区，如 Tokyo" aria-label="搜时区" value={query} onChange={(e) => setQuery(e.target.value)} />
            <div role="listbox" aria-label="计划时区" className={ui.options}>
              {shown.length === 0 && <span className={ui.menuLabel}>没有匹配的时区</span>}
              {shown.slice(0, 120).map(([id, name], i) => (
                <button key={id} type="button" role="option" aria-selected={id === live.value}
                  className={`${ui.option}${id === live.value ? ` ${ui.optionOn}` : ""}${!needle && i === COMMON_ZONES.length ? ` ${s.zoneRest}` : ""}`}
                  onClick={() => { close(); setQuery(""); void pick(id); }}>{name}{name !== id && <span className={ui.tiny}> {id}</span>}</button>
              ))}
            </div>
          </div>
        )}
      </Popover>
    </Row>
  );
}
