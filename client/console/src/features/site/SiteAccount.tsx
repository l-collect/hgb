import type { Account } from "../../api/types";
import { Pill, Popover, ui } from "../../components/ui";
import { Link, paths } from "../../router";
import s from "./Home.module.css";

/** Who is signed in, for the site's own pages: undefined while asking, null when nobody is. */
export interface SiteSession { account: Account | null | undefined; admin: boolean; signOut: () => void }

/** The right end of the site's top bar: 登录 when signed out, the account and its menu when signed in. */
export function SiteAccount({ site }: { site: SiteSession }) {
  const { account, admin, signOut } = site;
  if (account === undefined) return null;
  if (!account) return <Link className={`${s.cta} ${s.small} ${s.primary}`} to={paths.login}>登录</Link>;
  const who = account.email ?? account.githubLogin ?? "我的账号";
  const isPro = account.tier === "PRO";
  return (
    <Popover label="我的账号" plain align="end" trigger={
      <span className={s.account}><span className={s.accountName}>{who}</span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg></span>
    }>
      {(close) => (
        <>
          <div className={s.accountHead}>
            <span className={s.accountName}>{account.email ?? (account.githubLogin ? `GitHub · ${account.githubLogin}` : "我的账号")}</span>
            {isPro && <Pill tone="soft">Cloud Pro</Pill>}
          </div>
          <div className={ui.menuRule} />
          <Link role="menuitem" className={ui.menuItem} to={paths.tasks} onClick={close}>打开控制台</Link>
          <Link role="menuitem" className={ui.menuItem} to={paths.me} onClick={close}>我的</Link>
          {admin && <a role="menuitem" className={ui.menuItem} href="/admin/">后台管理</a>}
          <div className={ui.menuRule} />
          <button type="button" role="menuitem" className={ui.menuItem} onClick={() => { close(); signOut(); }}>退出登录</button>
        </>
      )}
    </Popover>
  );
}

/** Where the console is from the site: 任务 when signed in, else the sign-in page. */
export const consoleLink = (site: SiteSession) => (site.account ? paths.tasks : paths.login);
