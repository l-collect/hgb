import { useEffect, useReducer, useRef } from "react";
import { api, ApiFailure, apiUrl } from "../api/client";
import type { Account, ConsoleSnapshot, Device, GameAccount, Game, Job, LoginReportEvent, Plan } from "../api/types";

/** Everything the console shows, as the server's event stream last described it. */
export interface ConsoleData {
  devices: Device[]; jobs: Job[]; accounts: GameAccount[]; plans: Plan[]; games: Game[]; timeZone: string;
  /** Bumped when a job's log grows, so an open log knows to read it again. */
  logVersion: Record<string, number>;
  /** Bumped when a rule notices something or the rules change, so the 通知 page knows to read them again. */
  noticeVersion: number;
  /** Bumped by every snapshot: after a gap, anything read before may be stale. */
  epoch: number;
}
export type Connection = "connecting" | "live" | "lost";

type Action =
  | { type: "snapshot"; snapshot: ConsoleSnapshot }
  | { type: "device"; device: Device }
  | { type: "device-removed"; id: string }
  | { type: "jobs"; jobs: Job[] }
  | { type: "accounts"; accounts: GameAccount[] }
  | { type: "plans"; plans: Plan[] }
  | { type: "games"; games: Game[] }
  | { type: "time-zone"; timeZone: string }
  | { type: "job-log"; id: string }
  | { type: "notices" };

const empty: ConsoleData = { devices: [], jobs: [], accounts: [], plans: [], games: [], timeZone: "Asia/Shanghai", logVersion: {}, noticeVersion: 0, epoch: 0 };
const byName = (a: Device, b: Device) => a.name.localeCompare(b.name, "zh-CN") || a.id.localeCompare(b.id);

function reduce(state: ConsoleData, action: Action): ConsoleData {
  switch (action.type) {
    case "snapshot": return { ...action.snapshot, devices: [...action.snapshot.devices].sort(byName), logVersion: {}, noticeVersion: state.noticeVersion + 1, epoch: state.epoch + 1 };
    case "device": return { ...state, devices: [...state.devices.filter((d) => d.id !== action.device.id), action.device].sort(byName) };
    case "device-removed": return { ...state, devices: state.devices.filter((d) => d.id !== action.id) };
    case "jobs": return { ...state, jobs: action.jobs };
    case "accounts": return { ...state, accounts: action.accounts };
    case "plans": return { ...state, plans: action.plans };
    case "games": return { ...state, games: action.games };
    case "time-zone": return { ...state, timeZone: action.timeZone };
    case "notices": return { ...state, noticeVersion: state.noticeVersion + 1 };
    case "job-log": return { ...state, logVersion: { ...state.logVersion, [action.id]: (state.logVersion[action.id] ?? 0) + 1 } };
  }
}

/**
 * 读取登录's results as they come (login-report). The latest few are kept, so one that arrives before its request has
 * returned its id is still found.
 */
const loginReports: LoginReportEvent[] = [];
const loginListeners = new Set<(report: LoginReportEvent) => void>();
function heardLoginReport(report: LoginReportEvent) {
  loginReports.unshift(report); loginReports.length = Math.min(loginReports.length, 20);
  loginListeners.forEach((listen) => listen(report));
}
/** Calls [listen] with the result of request [requestId], now if it is already here; returns how to stop. */
export function awaitLoginReport(requestId: string, listen: (report: LoginReportEvent) => void): () => void {
  const seen = loginReports.find((report) => report.requestId === requestId);
  if (seen) { listen(seen); return () => {}; }
  const one = (report: LoginReportEvent) => { if (report.requestId === requestId) { loginListeners.delete(one); listen(report); } };
  loginListeners.add(one);
  return () => { loginListeners.delete(one); };
}

/**
 * Follows the server's event stream: a snapshot first, then changes. The browser retries a dropped stream by itself,
 * but not after an error status (a proxy's 502 during a deploy); then it is opened again here, a little later each time.
 * [signedOut] is called when the session turns out to be gone.
 */
/** [accountChanged]: the server pushed a newer copy of the account (a code redeemed elsewhere, an admin changing the tier). */
export function useConsoleStream(signedOut: () => void, accountChanged: (account: Account) => void = () => {}): { data: ConsoleData; connection: Connection; loaded: boolean; retry: () => void } {
  const [data, dispatch] = useReducer(reduce, empty);
  const [connection, setConnection] = useReducer((_: Connection, next: Connection) => next, "connecting" as Connection);
  const [loaded, setLoaded] = useReducer(() => true, false);
  const leave = useRef(signedOut); leave.current = signedOut;
  const changed = useRef(accountChanged); changed.current = accountChanged;
  const again = useRef(() => {});

  useEffect(() => {
    let stream: EventSource | null = null;
    let retryMs = 2000;
    let timer: number | undefined;
    let stopped = false;
    const json = (event: Event) => JSON.parse((event as MessageEvent<string>).data);
    function connect() {
      stream?.close();
      const current = new EventSource(apiUrl("/api/events"), { withCredentials: true });
      stream = current;
      current.addEventListener("snapshot", (event) => { retryMs = 2000; dispatch({ type: "snapshot", snapshot: json(event) }); setLoaded(); });
      current.addEventListener("device", (event) => dispatch({ type: "device", device: json(event) }));
      current.addEventListener("device-removed", (event) => dispatch({ type: "device-removed", id: json(event).id }));
      current.addEventListener("jobs", (event) => dispatch({ type: "jobs", jobs: json(event) }));
      current.addEventListener("accounts", (event) => dispatch({ type: "accounts", accounts: json(event) }));
      current.addEventListener("plans", (event) => dispatch({ type: "plans", plans: json(event) }));
      current.addEventListener("games", (event) => dispatch({ type: "games", games: json(event) }));
      current.addEventListener("time-zone", (event) => dispatch({ type: "time-zone", timeZone: json(event).timeZone }));
      current.addEventListener("job-log", (event) => dispatch({ type: "job-log", id: json(event).id }));
      current.addEventListener("login-report", (event) => heardLoginReport(json(event)));
      current.addEventListener("account", (event) => changed.current(json(event)));
      current.addEventListener("notice", () => dispatch({ type: "notices" }));
      current.addEventListener("rules", () => dispatch({ type: "notices" }));
      current.addEventListener("delivery", () => dispatch({ type: "notices" }));
      current.onopen = () => setConnection("live");
      current.onerror = async () => {
        setConnection("lost");
        try { await api("/api/me"); } catch (error) { if (error instanceof ApiFailure && error.status === 401) { current.close(); leave.current(); return; } }
        if (!stopped && stream === current && current.readyState === EventSource.CLOSED) {
          timer = window.setTimeout(() => { if (!stopped && stream === current) connect(); }, retryMs);
          retryMs = Math.min(retryMs * 2, 60000);
        }
      };
    }
    connect();
    // 重试 / 重连: now, not after the growing wait.
    again.current = () => { if (stopped) return; window.clearTimeout(timer); retryMs = 2000; setConnection("connecting"); connect(); };
    return () => { stopped = true; window.clearTimeout(timer); stream?.close(); };
  }, []);
  return { data, connection, loaded, retry: () => again.current() };
}
