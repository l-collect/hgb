import { useEffect } from "react";
import { apiUrl } from "../../api/client";
import type { DevRun } from "./api";

/**
 * The `dev-run` events the server pushes on the account's event stream (/api/events) whenever a workbench command
 * starts or changes: a trial started on the phone, a sample taken there. The workbench keeps its own connection to the
 * stream while it is open ([useDevRunStream]); pages listen with [onDevRun].
 */
type Listener = (run: DevRun) => void;
const listeners = new Set<Listener>();

/** Calls [listener] with every run pushed while the workbench is open; returns the unsubscribe. */
export function onDevRun(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** The same, for the life of a component. */
export function useDevRun(listener: Listener, deps: unknown[]) {
  useEffect(() => onDevRun(listener), deps); // eslint-disable-line react-hooks/exhaustive-deps
}

/** Runs this page started (as opposed to the phone, or another window). */
export const startedHere = new Set<string>();

/** Opens the stream while the workbench is shown; a stream closed by an error status is opened again a little later. */
export function useDevRunStream() {
  useEffect(() => {
    let stream: EventSource | null = null;
    let timer: number | undefined;
    let stopped = false;
    let retryMs = 3000;
    const connect = () => {
      stream?.close();
      const current = new EventSource(apiUrl("/api/events"), { withCredentials: true });
      stream = current;
      current.addEventListener("snapshot", () => { retryMs = 3000; });
      current.addEventListener("dev-run", (event) => {
        let run: DevRun;
        try { run = JSON.parse((event as MessageEvent<string>).data); } catch { return; }
        listeners.forEach((listener) => { try { listener(run); } catch { /* one page's failure is not the others' */ } });
      });
      current.onerror = () => {
        if (stopped || stream !== current || current.readyState !== EventSource.CLOSED) return;
        timer = window.setTimeout(() => { if (!stopped && stream === current) connect(); }, retryMs);
        retryMs = Math.min(retryMs * 2, 60_000);
      };
    };
    connect();
    return () => { stopped = true; window.clearTimeout(timer); stream?.close(); };
  }, []);
}
