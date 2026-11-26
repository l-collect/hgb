import { useSyncExternalStore } from "react";
import { Link } from "../router";
import s from "./Toast.module.css";

/**
 * A short line at the bottom of the window after an action, instead of the browser's alert(): 「已保存」, 「已排进 手机 ·
 * 查看」, or what went wrong. [link] opens a page, [action] does something (撤销). It goes by itself after [ms]
 * (2 s for a plain success, longer with a link or an action, a failure until 8 s), or when ✕ is clicked.
 */
export interface ToastOptions { tone?: "ok" | "bad"; link?: { to: string; text: string }; action?: { text: string; run: () => void }; ms?: number }
interface Shown extends ToastOptions { id: number; text: string }

let shown: Shown[] = [];
let next = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());
const drop = (id: number) => { shown = shown.filter((item) => item.id !== id); emit(); };

export function toast(text: string, options: ToastOptions = {}): void {
  const id = next++;
  // At most three at a time; the oldest goes first.
  shown = [...shown.slice(-2), { ...options, id, text }];
  emit();
  const ms = options.ms ?? (options.tone === "bad" ? 8000 : options.link || options.action ? 6000 : 2000);
  window.setTimeout(() => drop(id), ms);
}
/** The message of a failure, as the server or the network put it. */
export const failText = (error: unknown) => error instanceof Error && error.message ? error.message : "操作失败，请稍后再试";
export const toastError = (error: unknown) => toast(failText(error), { tone: "bad" });

/** Where toasts are drawn; mounted once by each frame (the console, /admin). */
export function ToastHost() {
  const items = useSyncExternalStore((listener) => { listeners.add(listener); return () => listeners.delete(listener); }, () => shown);
  if (!items.length) return null;
  return (
    <div className={s.layer} aria-live="polite">
      {items.map((item) => (
        <div key={item.id} className={item.tone === "bad" ? `${s.toast} ${s.bad}` : s.toast} role={item.tone === "bad" ? "alert" : "status"}>
          <span className={s.text}>{item.text}</span>
          {item.link && <Link to={item.link.to} className={s.link} onClick={() => drop(item.id)}>{item.link.text}</Link>}
          {item.action && <button type="button" className={s.link} onClick={() => { drop(item.id); item.action!.run(); }}>{item.action.text}</button>}
          <button type="button" className={s.close} aria-label="关闭" onClick={() => drop(item.id)}>✕</button>
        </div>
      ))}
    </div>
  );
}
