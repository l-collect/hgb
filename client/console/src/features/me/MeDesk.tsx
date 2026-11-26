import { useEffect, useState } from "react";
import { api, apiUrl } from "../../api/client";
import type { Account, MergeOffer } from "../../api/types";
import { Button, ButtonLink, Card, CardHead, Grow, MoreMenu, Pill, Row, RowLink, TextSelect, ui } from "../../components/ui";
import { platformName, shortTime } from "../../format";
import { Link, paths } from "../../router";
import { useConsole } from "../../state/context";
import { applyAppearance, readAppearance, type Appearance } from "../../theme/appearance";
import { JumpList } from "../accounts/Settings";
import { BindEmail, DeleteAccount, MergeCard } from "./AccountActions";
import { TimeZone, useMeActions } from "./MePage";
import s from "./MeDesk.module.css";

const GROUPS: [string, string][] = [
  ["me-account", "会员与账号"], ["me-look", "外观与时区"], ["me-devices", "设备"], ["me-notices", "通知"], ["me-dev", "开发者"], ["me-help", "帮助与关于"],
];

/**
 * 我的 on a wide window (网页桌面 · 我的): a settings page, the groups on the left and their content up to 820 wide on the
 * right. The phone's 我的 and 会员与账号 pages are groups of this one page (/me and /me/account both open it).
 */
export function MeDesk() {
  const { data } = useConsole();
  const { account, setAccount, codeInput, setCodeInput, redeem, unlink, unbind, logout, expires, isPro, signedOut } = useMeActions();
  // Read again: a code redeemed elsewhere changes the tier shown here.
  useEffect(() => { api<Account>("/api/me").then(setAccount).catch(() => {}); }, [setAccount]);
  const [binding, setBinding] = useState(false);
  const [offer, setOffer] = useState<MergeOffer | null>(null);
  const [look, setLook] = useState<Appearance>(readAppearance);
  const who = account.email ?? account.githubLogin ?? "";
  return (
    <div className={s.page}>
      <JumpList items={GROUPS} />
      <div className={s.content}>
        <h1 className={s.title}>我的</h1>
        <section id="me-account" className={s.group} aria-labelledby="me-account-h">
          <h2 id="me-account-h" className={s.groupTitle}>会员与账号</h2>
          <Card className={s.profile}>
            <span className={s.avatar} aria-hidden="true">{who.slice(0, 1).toUpperCase()}</span>
            <span className={s.who}>
              <span className={s.whoLine}><b>{who}</b>{isPro && <Pill tone="soft">Cloud Pro</Pill>}</span>
              <span className={ui.tiny}>{data.devices.length} 台设备 · {data.accounts.length} 个账号 · {data.plans.length} 个计划</span>
            </span>
            <Button small onClick={logout}>退出登录</Button>
          </Card>
          <Card flush className={isPro ? s.halves : undefined} aria-label="会员">
            {isPro && <div className={s.half}><span className={s.whoLine}><b>Cloud Pro</b><Pill tone="ok">{expires ? `到期 ${expires}` : "永久"}</Pill></span></div>}
            <form className={s.half} onSubmit={(e) => { e.preventDefault(); redeem(); }}>
              <label className={s.label} htmlFor="pro-code-desk">{isPro ? "续期激活码" : "激活码"}</label>
              <span className={s.codeLine}>
                <input id="pro-code-desk" type="text" value={codeInput} onChange={(e) => setCodeInput(e.target.value)} placeholder="HGB-PRO-…" />
                <Button type="submit" variant="primary" disabled={!codeInput.trim()}>兑换</Button>
              </span>
            </form>
          </Card>
          <Card flush as="section" aria-label="登录方式">
            <CardHead soft title="登录方式" />
            <Row>
              <span className={s.key}>邮箱</span>
              <Grow><span className={ui.tiny}>{account.email ? `${account.email}${account.hasPassword ? "" : " · 验证码登录"}` : "未绑定"}</span></Grow>
              {account.email ? <span className={ui.tiny}>已绑定</span> : !binding && <Button small onClick={() => setBinding(true)}>绑定</Button>}
              {binding && !offer && <BindEmail done={(next) => { setAccount(next); setBinding(false); }} merge={setOffer} />}
            </Row>
            <Row>
              <span className={s.key}>GitHub</span>
              <Grow><span className={ui.tiny}>{account.githubLogin ?? "未绑定"}</span></Grow>
              {account.githubLogin ? <Button small onClick={unlink} disabled={!account.email}>解绑</Button> : <a className={s.button} href={apiUrl("/api/auth/github/start?link=1")}>绑定</a>}
            </Row>
          </Card>
          {offer && <MergeCard token={offer.token} offer={offer} settled={(merged) => { setOffer(null); setBinding(false); if (merged) location.reload(); }} />}
          <div className={s.danger}><DeleteAccount account={account} deleted={signedOut} /></div>
        </section>

        <section id="me-look" className={s.group} aria-labelledby="me-look-h">
          <h2 id="me-look-h" className={s.groupTitle}>外观与时区</h2>
          <Card flush>
            <Row>
              <Grow>外观</Grow>
              <TextSelect label="外观" value={look} onChange={(next) => { setLook(next); applyAppearance(next); }} options={[["auto", "跟随系统"], ["light", "浅色"], ["dark", "深色"]]} />
            </Row>
            <TimeZone zone={data.timeZone} />
          </Card>
        </section>

        <section id="me-devices" className={s.group} aria-labelledby="me-devices-h">
          <h2 id="me-devices-h" className={s.groupTitle}>设备 <span className={ui.tiny}>{data.devices.length} 台</span></h2>
          <Card flush>
            {data.devices.map((device) => (
              <Row key={device.id}>
                <Grow>{device.name}<span className={ui.tiny} style={{ display: "block" }}>{platformName(device.platform)} · {device.online ? "在线" : `上次 ${shortTime(device.lastSeenAt)}`}{device.appVersion ? ` · App ${device.appVersion}` : ""}</span></Grow>
                <MoreMenu label={`${device.name} 的操作`} actions={[["解绑", () => unbind(device.id, device.name), true]]} />
              </Row>
            ))}
            <Row><Grow><span className={ui.tiny}>在别的设备装 App 并登录即可添加</span></Grow><a href={`https://github.com/${import.meta.env.VITE_CODE_REPO}/releases/latest`}>下载</a></Row>
          </Card>
        </section>

        <section id="me-notices" className={s.group} aria-labelledby="me-notices-h">
          <h2 id="me-notices-h" className={s.groupTitle}>通知</h2>
          <Card flush>
            <RowLink to={paths.notices}><Grow>事件、规则、渠道</Grow><span className={ui.tiny}>设置 ›</span></RowLink>
          </Card>
        </section>

        <section id="me-dev" className={s.group} aria-labelledby="me-dev-h">
          <h2 id="me-dev-h" className={s.groupTitle}>开发者</h2>
          <Card flush>
            <Row><Grow><b className={s.semi}>开发者工作台</b><span className={ui.tiny} style={{ display: "block" }}>采样、试跑、联调</span></Grow><ButtonLink small to={paths.dev}>进入</ButtonLink></Row>
          </Card>
        </section>

        <section id="me-help" className={s.group} aria-labelledby="me-help-h">
          <h2 id="me-help-h" className={s.groupTitle}>帮助与关于</h2>
          <Card flush>
            <a className={s.linkRow} href="/docs/"><span>使用文档</span><span className={ui.tiny}>›</span></a>
            <a className={s.linkRow} href={`https://github.com/${import.meta.env.VITE_CODE_REPO}/issues`} target="_blank" rel="noreferrer"><span>反馈问题</span><span className={ui.tiny}>GitHub ↗</span></a>
            <Link className={s.linkRow} to={paths.privacy}><span>隐私政策</span><span className={ui.tiny}>›</span></Link>
            <Link className={s.linkRow} to={paths.terms}><span>服务条款</span><span className={ui.tiny}>›</span></Link>
          </Card>
        </section>
      </div>
    </div>
  );
}
