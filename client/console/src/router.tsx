import { useEffect, useRef, useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent } from "react";
import { ask } from "./components/Confirm";

/**
 * A small history-API router: each page has its own address, links change it without reloading, and the back button
 * works. Vite serves index.html for any address, so deep links open the right page in development and preview.
 */
const CHANGE = "console:navigate";
const subscribe = (listener: () => void) => {
  window.addEventListener("popstate", listener); window.addEventListener(CHANGE, listener);
  return () => { window.removeEventListener("popstate", listener); window.removeEventListener(CHANGE, listener); };
};
const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
export const href = (to: string) => BASE + to;
const inside = (path: string) => path === BASE || path.startsWith(`${BASE}/`);
const read = () => (inside(location.pathname) ? location.pathname.slice(BASE.length) || "/" : location.pathname) + location.search;

export function usePath(): string { return useSyncExternalStore(subscribe, read).split("?")[0] || "/"; }
export function useQuery(): URLSearchParams {
  const qs = useSyncExternalStore(subscribe, () => read().split("?")[1] ?? "");
  return new URLSearchParams(qs);
}

/**
 * Unsaved edits: a form that has some registers itself with [useLeaveGuard]; then leaving it (a link, navigate, the back
 * button, a switch of account done through [leave]) asks「放弃修改？」first, and closing or reloading the tab gets the
 * browser's own warning.
 */
const guards = new Set<{ current: boolean }>();
let passing = false;
const unsaved = () => !passing && [...guards].some((guard) => guard.current);
export function useLeaveGuard(dirty: boolean) {
  const guard = useRef(dirty); guard.current = dirty;
  useEffect(() => { guards.add(guard); return () => { guards.delete(guard); }; }, []);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
}
/** Runs [proceed] now, or after the user agrees to drop the unsaved edits ([dirty] adds a reason of the caller's own). */
export function leave(proceed: () => void, dirty = false) {
  if (!dirty && !unsaved()) { proceed(); return; }
  void ask({ title: "放弃修改？", body: "改动还没保存", ok: "放弃", cancel: "继续编辑", danger: true }).then((yes) => {
    if (!yes) return;
    passing = true;
    try { proceed(); } finally { passing = false; }
  });
}

/** The address on screen, to put back when the back button is held for an answer. */
let shown = read();
// Registered before any page subscribes, so a held back button never reaches them.
window.addEventListener("popstate", (event) => {
  if (!unsaved()) { shown = read(); return; }
  event.stopImmediatePropagation();
  const target = read();
  history.pushState(null, "", href(shown));
  leave(() => navigate(target));
});

/** [force]: leave even with unsaved edits (after saving them, or deleting what they were about). */
export function navigate(to: string, options: { replace?: boolean; force?: boolean } = {}) {
  if (to === read()) return;
  if (!options.force && unsaved()) { leave(() => navigate(to, options)); return; }
  if (options.replace) history.replaceState(null, "", href(to)); else history.pushState(null, "", href(to));
  shown = read();
  window.dispatchEvent(new Event(CHANGE));
  if (!options.replace) window.scrollTo(0, 0);
}

export function Link({ to, onClick, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }) {
  const follow = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault(); navigate(to);
  };
  return <a href={href(to)} onClick={follow} {...rest} />;
}

export function match(pattern: string, path: string): Record<string, string> | null {
  const want = pattern.split("/").filter(Boolean); const have = path.split("/").filter(Boolean);
  if (want.length !== have.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < want.length; i++) {
    if (want[i].startsWith(":")) { try { params[want[i].slice(1)] = decodeURIComponent(have[i]); } catch { return null; } }
    else if (want[i] !== have[i]) return null;
  }
  return params;
}

const seg = encodeURIComponent;
export const paths = {
  tasks: "/tasks",
  taskDetail: (gameId: string, taskId: string, accountId?: string) =>
    `/tasks/${seg(gameId)}/${seg(taskId)}${accountId ? `?account=${seg(accountId)}` : ""}`,
  taskStep: (gameId: string, taskId: string, stepId: string, opts?: { accountId?: string; planId?: string }) => {
    const q = new URLSearchParams();
    if (opts?.accountId) q.set("account", opts.accountId);
    if (opts?.planId) q.set("plan", opts.planId);
    const qs = q.toString();
    return `/tasks/${seg(gameId)}/${seg(taskId)}/steps/${seg(stepId)}${qs ? `?${qs}` : ""}`;
  },
  devices: "/devices",
  device: (id: string) => `/devices/${seg(id)}`,
  app: (deviceId: string, key: string) => `/devices/${seg(deviceId)}/apps/${seg(key)}`,
  accounts: "/accounts",
  account: (id: string, tab?: "plans" | "runs", taskId?: string) =>
    `/accounts/${seg(id)}${tab ? `/${tab}` : ""}${taskId ? `?task=${seg(taskId)}` : ""}`,
  planNew: (accountId: string) => `/accounts/${seg(accountId)}/plans/new`,
  planEdit: (accountId: string, planId: string) => `/accounts/${seg(accountId)}/plans/${seg(planId)}`,
  presetEdit: (accountId: string, presetId: string) => `/accounts/${seg(accountId)}/presets/${seg(presetId)}`,
  planTaskConfig: (accountId: string, planId: string, taskId: string) =>
    `/accounts/${seg(accountId)}/plans/${seg(planId)}/tasks/${seg(taskId)}`,
  job: (id: string) => `/jobs/${seg(id)}`,
  library: "/tasks",
  notices: "/notices",
  me: "/me",
  meAccount: "/me/account",
  dev: "/dev",
  login: "/login",
  privacy: "/privacy",
  terms: "/terms",
};
