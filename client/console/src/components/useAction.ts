import { useCallback, useEffect, useRef, useState } from "react";
import { failText, toast } from "./Toast";

/**
 * Runs one user action at a time and keeps what to tell the user about it: [busy] while it runs, then its success
 * text or the error's message.
 */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const running = useRef(false);
  const run = useCallback(async (action: () => Promise<string | void>) => {
    // A second click while the first is on its way does nothing.
    if (running.current) return;
    running.current = true; setBusy(true); setMessage(null);
    try { const done = await action(); if (done) setMessage({ text: done, ok: true }); }
    catch (error) { setMessage({ text: failText(error), ok: false }); }
    finally { running.current = false; setBusy(false); }
  }, []);
  return { busy, message, run, clear: () => setMessage(null) };
}

/** For a quick action with nowhere else to show its failure: the failure is a toast. [done] is a toast on success. */
export async function orToast(action: () => Promise<unknown>, done?: string): Promise<boolean> {
  try { await action(); if (done) toast(done, { tone: "ok" }); return true; }
  catch (error) { toast(failText(error), { tone: "bad" }); return false; }
}

/**
 * A value the user changes in place (a switch, a select) that the server confirms by the event stream: it shows the new
 * value at once, [pending] while the request is on its way, and on a refusal goes back to the server's value with
 * [error] beside the control for a few seconds.
 */
export function useOptimistic<T>(actual: T) {
  const [wanted, setWanted] = useState<{ value: T } | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const key = JSON.stringify(actual);
  // The stream caught up (or said something else since): the server's value is shown again.
  useEffect(() => { if (!pending) setWanted(null); }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!error) return;
    const timer = window.setTimeout(() => setError(null), 5000);
    return () => window.clearTimeout(timer);
  }, [error]);
  const commit = async (value: T, action: () => Promise<unknown>): Promise<boolean> => {
    if (pending) return false;
    setWanted({ value }); setPending(true); setError(null);
    try {
      await action();
      // Kept until the stream brings the new value, but not for ever.
      window.setTimeout(() => setWanted(null), 4000);
      return true;
    } catch (failure) { setWanted(null); setError(failText(failure)); return false; }
    finally { setPending(false); }
  };
  return { value: wanted ? wanted.value : actual, pending, error, commit };
}

/** Seconds left until a code may be asked for again; counts down once a second. */
export function useCountdown(): [number, (seconds: number) => void] {
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (left <= 0) return;
    const timer = window.setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [left]);
  return [left, setLeft];
}
