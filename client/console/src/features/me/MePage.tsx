import { useEffect, useMemo, useState } from "react";
import { api, apiUrl, enc } from "../../api/client";
import type { Account, MergeOffer } from "../../api/types";
import { Breadcrumb, Button, ButtonLink, Card, Grow, MoreMenu, Pill, Row, TextSelect, ui } from "../../components/ui";
import { applyAppearance, readAppearance, type Appearance } from "../../theme/appearance";
import { orAlert } from "../../components/useAction";
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
        <a className={s.linkRow} href="/privacy/"><span>隐私政策</span><span className={ui.tiny}>›</span></a>
        <a className={s.linkRow} href="/terms/"><span>服务条款</span><span className={ui.tiny}>›</span></a>
      </Card>
    </div>
  );
}

/** 会员与账号: the tier when Pro and the activation code, how this account signs in, its devices, and signing out. */
export function MeAccountPage() {
  const { data, account: initial, signedOut } = useConsole();
  const [account, setAccount] = useState(initial);
  const [binding, setBinding] = useState(false);
  const [offer, setOffer] = useState<MergeOffer | null>(null);
  const [redeeming, setRedeeming] = useState(false);
  const [showDevices, setShowDevices] = useState(false);
  const [codeInput, setCodeInput] = useState("");
  const redeem = () => {
    const trimmed = codeInput.trim();
    if (!trimmed) return;
    orAlert(async () => {
      const updated = await api<Account>("/api/me/redeem", { method: "POST", body: { code: trimmed } });
      setAccount(updated);
      setCodeInput("");
      setRedeeming(false);
    });
  };
  const isPro = account.tier === "PRO";
  const unlink = () => {
    if (!confirm("解绑 GitHub？之后只能用邮箱登录。")) return;
    orAlert(async () => { await api("/api/auth/github", { method: "DELETE" }); setAccount(await api<Account>("/api/me")); });
  };
  const unbind = (id: string, name: string) => {
    if (!confirm(`解绑「${name}」？它会下线，在跑的作业记为结果未知。`)) return;
    orAlert(() => api(`/api/devices/${enc(id)}`, { method: "DELETE" }));
  };
  const logout = () => orAlert(async () => { await api("/api/auth/logout", { method: "POST", body: {} }); signedOut(); });
  const expires = account.proExpiresAt ? new Date(account.proExpiresAt).toLocaleDateString("sv-SE") : null;
  return (
    <div className={s.page}>
      <Breadcrumb items={[["我的", paths.me], ["会员与账号", null]]} />
      <h1 className={s.title}>会员与账号</h1>
      <Card as="section" aria-label="会员" className={s.pro}>
        {isPro && <b className={s.proName}>Cloud Pro · {expires ? `到期 ${expires}` : "永久"}</b>}
        {!redeeming && <Button className={s.wide} onClick={() => setRedeeming(true)}>{isPro ? "用激活码续期" : "兑换激活码"}</Button>}
      </Card>
      {redeeming && (
        <Card as="section" aria-label="激活码" className={s.codeCard}>
          <label className={s.codeLabel} htmlFor="pro-code">激活码</label>
          <input id="pro-code" type="text" value={codeInput} onChange={(e) => setCodeInput(e.target.value)} placeholder="HGB-PRO-…" />
          <div className={s.twoButtons}>
            <Button onClick={() => { setRedeeming(false); setCodeInput(""); }}>取消</Button>
            <Button variant="primary" onClick={redeem} disabled={!codeInput.trim()}>兑换</Button>
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
          {account.githubLogin ? <Button small onClick={unlink} disabled={!account.email}>解绑</Button> : <a className={s.button} href={apiUrl("/api/auth/github/start?link=1")}>绑定</a>}
        </Row>
        <button type="button" className={s.linkRow} aria-expanded={showDevices} onClick={() => setShowDevices(!showDevices)}>
          <span>已绑定的设备</span><span className={ui.tiny}>{data.devices.length} 台 {showDevices ? "▴" : "›"}</span>
        </button>
        {showDevices && data.devices.map((device) => (
          <Row key={device.id} className={s.subRow}>
            <Grow>{device.name}<span className={ui.tiny} style={{ display: "block" }}>{platformName(device.platform)} · {device.online ? "在线" : `上次 ${shortTime(device.lastSeenAt)}`}</span></Grow>
            <MoreMenu label={`${device.name} 的操作`} actions={[["解绑", () => unbind(device.id, device.name), true]]} />
          </Row>
        ))}
        {showDevices && <Row className={s.subRow}><Grow><span className={ui.tiny}>在别的设备装 App 并登录即可添加</span></Grow><a href="/#download">下载</a></Row>}
      </Card>
      {offer && <MergeCard token={offer.token} offer={offer} settled={(merged) => { setOffer(null); setBinding(false); if (merged) location.reload(); }} />}
      <Button variant="danger" className={s.wide} onClick={logout}>退出登录</Button>
      <div className={s.footer}><DeleteAccount account={account} deleted={signedOut} /></div>
    </div>
  );
}

/** The plan time zone, saved as soon as it is picked; every plan runs by it. */
function TimeZone({ zone }: { zone: string }) {
  const zones = useMemo(() => {
    const all = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.("timeZone") ?? [];
    return all.includes(zone) ? all : [zone, ...all];
  }, [zone]);
  return (
    <Row>
      <Grow>计划时区</Grow>
      <TextSelect label="计划时区" value={zone} options={zones.map((item): [string, string] => [item, item === "Asia/Shanghai" ? "北京时间" : item])}
        onChange={(next) => orAlert(() => api("/api/me/time-zone", { method: "PUT", body: { timeZone: next } }))} />
    </Row>
  );
}
