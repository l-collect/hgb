import { useState, type ReactNode } from "react";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { Mark } from "../components/ui";
import { Link, paths, usePath } from "../router";
import { TopBarContext } from "./topBar";
import { DevGroup, DevMenu } from "./DevNav";
import { useDeveloper } from "../state/developer";
import { useNarrow, useWide } from "./useWidth";
import type { Connection } from "../state/console";
import s from "./Shell.module.css";

export type Section = "tasks" | "accounts" | "devices" | "me" | "dev";

const icon = (d: ReactNode) => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">{d}</svg>;
/** [section, label, short label for the rail and the bottom bar, path, icon]. 开发 (developers only) has a group of its own. */
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
/** The four pages of the bottom bar, which the top bar names. */
const PRIMARY = new Set<string>([paths.tasks, "/library", paths.accounts, paths.devices, paths.me]);

/**
 * The frame every console page sits in (UI v8): from 600 one row on top with the logo and the sections as pills (the
 * current one black with its name, the others round icons), below 600 a top bar with the section's name and the four
 * tabs floating at the bottom.
 * [full] lets a page with side-by-side columns (list, detail, context) use the whole width instead of 1200. [admin] adds
 * 后台管理 (/admin, with a frame of its own) beside the connection. A page that fails while drawing shows 「这页出错了」
 * in its place; the frame and its navigation stay. A developer also gets 开发, a round icon whose items float under it
 * (nothing on the bottom bar); in the workbench (section dev) those items also stand in a column on its left from 1024,
 * and the workbench fills the rest with no padding of its own.
 */
export function Shell({ section, connection, full, admin, stale, children }: { section: Section; connection: Connection; full?: boolean; admin?: boolean; stale?: boolean; children: ReactNode }) {
  const developer = useDeveloper();
  const narrow = useNarrow();
  const wide = useWide();
  // Someone who is not a developer can still open /dev by its address: it then sits under 我的, as before.
  const current = section === "dev" && !developer ? "me" : section;
  const path = usePath();
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const live = <><span className={s.liveDot} data-state={connection} aria-hidden="true" /><span className={s.liveText}>{LIVE_SHORT[connection]}</span></>;
  return (
    <div className={s.shell} data-wide={section === "dev" || full === true} data-dev={section === "dev" ? "true" : undefined}>
      {/* Narrow: a top bar naming the section; the four tabs float at the bottom. */}
      <header className={s.top}>
        <Mark size={26} /><b className={s.topTitle}>{TITLES[section]}</b>
        {admin && <Link className={s.topAdmin} to="/admin">后台</Link>}
        <span ref={setSlot} className={s.topSlot} />
        <span className={s.liveShort} role="status" title={LIVE[connection]}><span className={s.liveDot} data-state={connection} aria-hidden="true" /><span className={s.liveShortText}>{LIVE_SHORT[connection]}</span></span>
      </header>
      {/* Medium and wide (UI v8): one row on top — the logo, the current section as a black pill with its name, the
          others as round icons, 开发 for developers, then 后台 and the connection. */}
      <header className={s.deskTop}>
        <Link to={paths.tasks} className={s.navBrand}><Mark size={32} /><span className={s.brandName}>护肝宝</span></Link>
        <nav className={s.deskLinks} aria-label="主导航">
          {LINKS.map(([id, label, , to, svg]) => id === current ? (
            <Link key={id} to={to} className={s.navPill} aria-current="page">{svg}<span>{label}</span></Link>
          ) : (
            <Link key={id} to={to} className={s.navIcon} aria-label={label} title={label}>{svg}</Link>
          ))}
          {developer && !narrow && <DevMenu current={section === "dev"} />}
        </nav>
        <span className={s.deskSpacer} />
        {admin && <Link className={s.adminPill} to="/admin">{ADMIN_ICON}<span>后台管理</span></Link>}
        <div className={s.live} role="status" title={LIVE[connection]}>{live}</div>
      </header>
      <nav className={s.nav} aria-label="主导航">
        <div className={s.links}>
          {LINKS.map(([id, label, short, to, svg]) => (
            <Link key={id} to={to} className={s.link} aria-current={id === current ? "page" : undefined}>
              <span className={s.linkIcon}>{svg}</span><span className={s.linkLabel}>{label}</span><span className={s.linkShort}>{short}</span>
            </Link>
          ))}
        </div>
      </nav>
      <div className={s.body}>
        {developer && section === "dev" && wide && <aside className={s.devSide} aria-label="开发">{<DevGroup />}</aside>}
        <main className={s.main} data-stale={stale ? "true" : undefined}>
          <TopBarContext.Provider value={{ primary: PRIMARY.has(path), slot }}>
            <ErrorBoundary resetKey={path}>{children}</ErrorBoundary>
          </TopBarContext.Provider>
        </main>
      </div>
    </div>
  );
}
