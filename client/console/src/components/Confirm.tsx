import { useEffect, useRef, useSyncExternalStore } from "react";
import { Button } from "./ui";
import s from "./Confirm.module.css";

/**
 * A light in-page confirmation instead of the browser's confirm(): one short question, an optional line under it, and
 * two buttons. [ask] opens it and resolves true on the confirming button, false on 取消 / Escape / a click outside.
 * One at a time; a second ask while one is open answers the first with false.
 */
export interface Ask { title: string; body?: string; ok?: string; cancel?: string; danger?: boolean }
type Open = Ask & { answer: (yes: boolean) => void };

let current: Open | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

export function ask(question: Ask): Promise<boolean> {
  current?.answer(false);
  return new Promise((resolve) => {
    const open: Open = { ...question, answer: (yes) => { if (current === open) { current = null; emit(); } resolve(yes); } };
    current = open; emit();
  });
}

/** Where the confirmation is drawn; mounted once by the console frame. */
export function ConfirmHost() {
  const open = useSyncExternalStore((listener) => { listeners.add(listener); return () => listeners.delete(listener); }, () => current);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const before = document.activeElement as HTMLElement | null;
    // A risky answer is not the one Enter gives.
    box.current?.querySelector<HTMLButtonElement>(open.danger ? "[data-cancel]" : "[data-ok]")?.focus({ preventScroll: true });
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") { event.stopPropagation(); open.answer(false); } };
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("keydown", key); before?.focus?.({ preventScroll: true }); };
  }, [open]);
  if (!open) return null;
  return (
    <div className={s.layer} onMouseDown={(event) => { if (event.target === event.currentTarget) open.answer(false); }}>
      <div ref={box} className={s.box} role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby={open.body ? "confirm-body" : undefined}>
        <b id="confirm-title" className={s.title}>{open.title}</b>
        {open.body && <p id="confirm-body" className={s.body}>{open.body}</p>}
        <div className={s.buttons}>
          <Button data-cancel onClick={() => open.answer(false)}>{open.cancel ?? "取消"}</Button>
          <Button data-ok variant={open.danger ? "destroy" : "primary"} onClick={() => open.answer(true)}>{open.ok ?? "确定"}</Button>
        </div>
      </div>
    </div>
  );
}
