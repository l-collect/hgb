import { useState, type ReactNode } from "react";
import { Popover } from "../components/ui";
import { Link, usePath } from "../router";
import { useWorkbenchMenu, workbenchPaths } from "../state/developer";
import s from "./Shell.module.css";

const OPEN_KEY = "hgb.nav.dev";
const TASKS_KEY = "hgb.nav.devTasks";
const read = (key: string, fallback: boolean) => { try { const v = localStorage.getItem(key); return v === null ? fallback : v === "1"; } catch { return fallback; } };
const write = (key: string, on: boolean) => { try { localStorage.setItem(key, on ? "1" : "0"); } catch { /* this visit only */ } };

const chevron = (open: boolean) => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true" className={s.devChev} data-open={open}><path d="M6 9l6 6 6-6" /></svg>
);
const CODE = <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M8 6l-6 6 6 6M16 6l6 6-6 6" /></svg>;
const RAIL_ICON = <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M8 6l-6 6 6 6M16 6l6 6-6 6" /></svg>;

/** Where in the workbench [path] is: which part, and which task. */
function at(path: string) {
  const task = /^\/dev\/tasks\/([^/]+)/.exec(path)?.[1];
  let current: string | undefined;
  try { current = task ? decodeURIComponent(task) : undefined; } catch { current = undefined; }
  return {
    scripts: path === "/dev" || path.startsWith("/dev/tasks") || path.startsWith("/dev/snippets"),
    assets: path.startsWith("/dev/assets") || path.startsWith("/dev/samples"),
    pages: path.startsWith("/dev/pages") || path === "/dev/game" || path === "/dev/states",
    publish: path === "/dev/publish",
    task: current,
  };
}

/** The 开发 group's items: 任务脚本 (with the draft's tasks under it), 素材, 页面, 发布 (with how many tasks changed). */
function Items({ wanted, onPick, alwaysOpen }: { wanted: boolean; onPick?: () => void; alwaysOpen?: boolean }) {
  const path = usePath();
  const where = at(path);
  const menu = useWorkbenchMenu(wanted);
  const [tasksOpen, setTasksOpen] = useState(() => alwaysOpen || read(TASKS_KEY, true));
  const toggleTasks = () => { const next = !tasksOpen; setTasksOpen(next); write(TASKS_KEY, next); };
  const unsaved = new Set(menu?.unsaved ?? []);
  const item = (to: string, label: ReactNode, on: boolean, extra?: ReactNode) => (
    <Link to={to} className={s.devItem} aria-current={on ? "page" : undefined} onClick={onPick}><span className={s.devLabel}>{label}</span>{extra}</Link>
  );
  return (
    <>
      <div className={s.devItemRow}>
        <Link to="/dev" className={s.devItem} aria-current={where.scripts && !where.task ? "page" : undefined} data-within={where.scripts ? "true" : undefined} onClick={onPick}>
          {CODE}<span className={s.devLabel}>任务脚本</span>
        </Link>
        <button type="button" className={s.devToggle} aria-expanded={tasksOpen} aria-label={tasksOpen ? "收起任务" : "展开任务"} onClick={toggleTasks}>{chevron(tasksOpen)}</button>
      </div>
      {tasksOpen && (
        <div className={s.devSubs} role="group" aria-label="任务脚本">
          {!menu || menu.loading ? <span className={s.devHint}>{wanted ? "读取中…" : ""}</span> : <>
            {menu.tasks.length === 0 && menu.repoOnly.length === 0 && <span className={s.devHint}>还没有任务</span>}
            {menu.tasks.map((t) => (
              <Link key={t.id} to={workbenchPaths.task(t.id)} className={s.devSub} aria-current={where.task === t.id ? "page" : undefined} onClick={onPick} title={t.name}>
                <span className={s.devLabel}>{t.name}</span>{unsaved.has(t.id) && <span className={s.devDot} role="img" aria-label="有未保存" title="有未保存" />}
              </Link>
            ))}
            {menu.repoOnly.map((t) => (
              <Link key={t.id} to="/dev" className={s.devSub} data-repo="true" onClick={onPick} title="仓库里有，草稿还没有 · 去同步">
                <span className={s.devLabel}>{t.name}</span><span className={s.devRepo}>仓库新</span>
              </Link>
            ))}
          </>}
        </div>
      )}
      {item("/dev/assets", "素材", where.assets)}
      {item("/dev/pages", "页面", where.pages)}
      {item("/dev/publish", "发布", where.publish, menu && menu.changed > 0 ? <span className={s.devCount} aria-label={`${menu.changed} 处改动`}>{menu.changed}</span> : null)}
    </>
  );
}

/** The full sidebar's 开发 group, under the main navigation; folded or not is kept in this browser. */
export function DevGroup() {
  const [open, setOpen] = useState(() => read(OPEN_KEY, true));
  const toggle = () => { const next = !open; setOpen(next); write(OPEN_KEY, next); };
  return (
    <div className={s.devGroup}>
      <button type="button" className={s.devHead} aria-expanded={open} onClick={toggle}><span>开发</span>{chevron(open)}</button>
      {open && <Items wanted />}
    </div>
  );
}

/** The rail's 开发: one icon; the same items float beside it. */
export function DevRail({ current }: { current: boolean }) {
  return (
    <Popover label="开发" plain side="right" role="dialog" trigger={
      <span className={s.link} data-current={current ? "true" : undefined} title="开发">
        <span className={s.linkIcon}>{RAIL_ICON}</span><span className={s.linkShort}>开发</span>
      </span>
    }>
      {(close) => <div className={s.devFloat}><Items wanted onPick={close} alwaysOpen /></div>}
    </Popover>
  );
}
