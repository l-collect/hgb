import type { ReactNode } from "react";
import { Mark } from "../components/ui";
import { Link, paths } from "../router";
import type { Connection } from "../state/console";
import s from "./Shell.module.css";

export type Section = "tasks" | "accounts" | "devices" | "me" | "dev";

const icon = (d: ReactNode) => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">{d}</svg>;
/** [section, label, short label for the rail and the bottom bar, path, icon]. 开发工作台 is entered from 我的. */
const LINKS: [Section, string, string, string, ReactNode][] = [
  ["tasks", "任务与日常", "任务", paths.tasks, icon(<path d="M4 5h6v14H4zM14 5l5 1.5-3.5 13L11 18" />)],
  ["accounts", "账号与计划", "账号计划", paths.accounts, icon(<><rect x="3" y="6" width="18" height="12" rx="3" /><path d="M8 10v4M6 12h4M15 11h.01M17 13h.01" /></>)],
  ["devices", "设备与战报", "设备战报", paths.devices, icon(<><rect x="7" y="2" width="10" height="20" rx="2" /><path d="M11 18h2" /></>)],
  ["me", "我的", "我的", paths.me, icon(<><circle cx="12" cy="8" r="4" /><path d="M5 20a7 7 0 0 1 14 0" /></>)],
];
const ADMIN_ICON = icon(<path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6zM9 12l2 2 4-4" />);
const TITLES: Record<Section, string> = { tasks: "任务", accounts: "账号计划", devices: "设备战报", me: "我的", dev: "开发工作台" };
const LIVE: Record<Connection, string> = { live: "实时连接中", connecting: "连接中…", lost: "已断开，重连中…" };
const LIVE_SHORT: Record<Connection, string> = { live: "已连接", connecting: "连接中", lost: "已断开" };

/**
 * The frame every console page sits in, in the widths of the design: from 1280 a 240 sidebar with full names, from 600 a
 * rail of icons with short labels, and below that a top bar with the section's name and four tabs at the bottom.
 * [full] lets a page with side-by-side columns (list, detail, context) use the whole width instead of 1200. [admin] adds
 * 后台管理 (/admin, with a frame of its own) above the connection, or to the top bar when narrow.
 */
export function Shell({ section, connection, full, admin, children }: { section: Section; connection: Connection; full?: boolean; admin?: boolean; children: ReactNode }) {
  // The workbench lives under 我的.
  const current = section === "dev" ? "me" : section;
  return (
    <div className={s.shell} data-wide={section === "dev" || full === true}>
      <header className={s.top}>
        <Mark size={26} /><b className={s.topTitle}>{TITLES[section]}</b>
        {admin && <Link className={s.topAdmin} to="/admin">后台</Link>}
        <span className={s.liveShort} role="status"><span className={s.liveDot} data-state={connection} aria-hidden="true" />{LIVE_SHORT[connection]}</span>
      </header>
      <nav className={s.nav} aria-label="主导航">
        <Link to={paths.tasks} className={s.navBrand}><Mark size={26} /><span className={s.brandName}>护肝宝</span></Link>
        <div className={s.links}>
          {LINKS.map(([id, label, short, to, svg]) => (
            <Link key={id} to={to} className={s.link} aria-current={id === current ? "page" : undefined}>
              <span className={s.linkIcon}>{svg}</span><span className={s.linkLabel}>{label}</span><span className={s.linkShort}>{short}</span>
            </Link>
          ))}
        </div>
        <div className={s.foot}>
          {admin && (
            <Link className={s.link} to="/admin">
              <span className={s.linkIcon}>{ADMIN_ICON}</span><span className={s.linkLabel}>后台管理</span><span className={s.linkShort}>后台</span>
            </Link>
          )}
          <div className={s.live} role="status" title={LIVE[connection]}>
            <span className={s.liveDot} data-state={connection} aria-hidden="true" /><span className={s.liveText}>{LIVE[connection]}</span>
          </div>
        </div>
      </nav>
      <main className={s.main}>{children}</main>
    </div>
  );
}
