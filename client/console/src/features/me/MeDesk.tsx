import { useEffect, useRef, useState } from "react";
import { api, githubStart } from "../../api/client";
import type { Account, MergeOffer } from "../../api/types";
import { Button, ButtonLink, Card, CardHead, Grow, MoreMenu, Pill, Row, RowLink, TextSelect, ui } from "../../components/ui";
import { platformName, shortTime } from "../../format";
import { Link, paths } from "../../router";
import { useConsole } from "../../state/context";
import { useDeveloper } from "../../state/developer";
import { ProCount, ProLimitButton, usePro } from "../../components/Pro";
import { applyAppearance, readAppearance, type Appearance } from "../../theme/appearance";
import { JumpList } from "../accounts/Settings";
import { BindEmail, DeleteAccount, MergeCard } from "./AccountActions";
import { GithubUnlink, QuotaLine, TierPill, TimeZone, useMeActions, useNoticeLine, useRedeemAsked } from "./MePage";
import { APP_DOWNLOAD } from "../onboarding/Onboarding";
import s from "./MeDesk.module.css";

const GROUPS: [string, string][] = [
  ["me-account", "会员与账号"], ["me-look", "外观与时区"], ["me-devices", "设备"], ["me-notices", "通知"], ["me-help", "帮助与关于"], ["me-dev", "开发者"],
];

/**
 * 我的 on a wide window (网页桌面 · 我的): a settings page, the groups on the left and their content up to 820 wide on the
 * right. The phone's 我的 and 会员与账号 pages are groups of this one page (/me and /me/account both open it).
 */
export function MeDesk() {
  const { data } = useConsole();
  // 开发者工作台 only for developers (they also have the sidebar's 开发 group from 600 wide).
  const developer = useDeveloper();
  const { account, setAccount, codeInput, setCodeInput, redeem, redeeming, unlink, unbind, logout, expires, isPro, forever, signedOut } = useMeActions();
  // Read again: a code redeemed elsewhere changes the tier shown here.
  useEffect(() => { api<Account>("/api/me").then(setAccount).catch(() => {}); }, [setAccount]);
  const [binding, setBinding] = useState(false);
  const [offer, setOffer] = useState<MergeOffer | null>(null);
  const [look, setLook] = useState<Appearance>(readAppearance);
  const who = account.email ?? account.githubLogin ?? "";
  const pro = usePro();
  const devicesFull = pro.full("maxDevices", data.devices.length);
  // From a Pro lock: the code box in view and focused.
  const asked = useRedeemAsked();
  const notices = useNoticeLine();
  const codeBox = useRef<HTMLInputElement>(null);
  useEffect(() => { if (asked) { codeBox.current?.scrollIntoView({ block: "center" }); codeBox.current?.focus(); } }, [asked]);
  return (
    <div className={s.page}>
      <JumpList items={developer ? GROUPS : GROUPS.filter(([id]) => id !== "me-dev")} />
      <div className={s.content}>
        <h1 className={s.title}>我的</h1>
        <section id="me-account" className={s.group} aria-labelledby="me-account-h">
          <h2 id="me-account-h" className={s.groupTitle}>会员与账号</h2>
          <Card className={s.profile}>
            <span className={s.avatar} aria-hidden="true">{who.slice(0, 1).toUpperCase()}</span>
            <span className={s.who}>
              <span className={s.whoLine}><b>{who}</b><TierPill account={account} /></span>
              <span className={ui.tiny}>{data.devices.length} 台设备 · {data.accounts.length} 个账号 · {data.plans.length} 个计划</span>
            </span>
            <Button small onClick={logout}>退出登录</Button>
          </Card>
          <Card flush className={!forever ? s.halves : undefined} aria-label="会员">
            <div className={s.half}>
              {isPro ? <span className={s.whoLine}><b>Pro</b><Pill tone="ok">{expires ? `到期 ${expires}` : "永久"}</Pill></span> : <b>免费版</b>}
              <QuotaLine account={account} />
            </div>
            {!forever && <form className={s.half} onSubmit={(e) => { e.preventDefault(); void redeem(); }}>
              <label className={s.label} htmlFor="pro-code-desk">{isPro ? "续期激活码" : "激活码"}</label>
              <span className={s.codeLine}>
                <input id="pro-code-desk" ref={codeBox} type="text" autoCapitalize="characters" autoComplete="off" spellCheck={false} value={codeInput} onChange={(e) => setCodeInput(e.target.value)} placeholder="HGB-PRO-…" />
                <Button type="submit" variant="primary" disabled={!codeInput.trim() || redeeming}>{redeeming ? "兑换中…" : "兑换"}</Button>
              </span>
            </form>}
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
              {account.githubLogin ? <GithubUnlink account={account} unlink={unlink} /> : <a className={s.button} href={githubStart({ link: true })}>绑定</a>}
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
          <h2 id="me-devices-h" className={s.groupTitle}>设备 {pro.count("maxDevices", data.devices.length) ? <ProCount text={pro.count("maxDevices", data.devices.length)} /> : <span className={ui.tiny}>{data.devices.length} 台</span>}</h2>
          <Card flush>
            {data.devices.map((device) => (
              <Row key={device.id}>
                <Grow>{device.name}<span className={ui.tiny} style={{ display: "block" }}>{platformName(device.platform)} · {device.online ? "在线" : `上次 ${shortTime(device.lastSeenAt)}`}{device.appVersion ? ` · App ${device.appVersion}` : ""}</span></Grow>
                <MoreMenu label={`${device.name} 的操作`} actions={[["解绑", () => void unbind(device.id, device.name), true]]} />
              </Row>
            ))}
            {devicesFull
              ? <Row><Grow><span className={ui.tiny}>已达上限</span></Grow><ProLimitButton small text="添加" what="设备" /></Row>
              : <Row><Grow><span className={ui.tiny}>在别的设备装 App 并登录即可添加</span></Grow><a href={APP_DOWNLOAD}>下载</a></Row>}
          </Card>
        </section>

        <section id="me-notices" className={s.group} aria-labelledby="me-notices-h">
          <h2 id="me-notices-h" className={s.groupTitle}>通知</h2>
          <Card flush>
            <RowLink to={paths.notices}><Grow>{notices ?? "事件、规则、渠道"}</Grow><span className={ui.tiny}>设置 ›</span></RowLink>
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

        {developer && <section id="me-dev" className={s.group} aria-labelledby="me-dev-h">
          <h2 id="me-dev-h" className={s.groupTitle}>开发者</h2>
          <Card flush>
            <Row><Grow><b className={s.semi}>开发者工作台</b><span className={ui.tiny} style={{ display: "block" }}>采样、试跑、联调</span></Grow><ButtonLink small to={paths.dev}>进入</ButtonLink></Row>
          </Card>
        </section>}
      </div>
    </div>
  );
}
