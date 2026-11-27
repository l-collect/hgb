import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { join } from "../../../components/ui";
import k from "./config.module.css";

/**
 * A dialog over the workbench: Escape (or [onClose]'s button) closes it, the first field takes the keyboard, and the
 * keyboard goes back where it was after. A click outside does nothing: what was typed is not lost by a stray click.
 */
export function Dialog({ label, onClose, children, className, style }: { label: string; onClose: () => void; children: ReactNode; className?: string; style?: CSSProperties }) {
  const box = useRef<HTMLDivElement>(null);
  const close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const first = box.current?.querySelector<HTMLElement>("[data-autofocus]") ?? box.current?.querySelector<HTMLElement>("input:not([type=radio]):not([type=checkbox]), select, textarea, button");
    first?.focus({ preventScroll: true });
    const key = (e: KeyboardEvent) => {
      // A confirmation over this one answers its own Escape.
      if (e.key !== "Escape" || document.querySelector("[role=alertdialog]")) return;
      e.stopPropagation(); close.current();
    };
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("keydown", key); before?.focus?.({ preventScroll: true }); };
  }, []);
  return createPortal(
    <div className={k.layer}>
      <div ref={box} role="dialog" aria-modal="true" aria-label={label} className={join(k.dialog, className)} style={style}
        // Keys typed here stay here (the workbench's own shortcuts do not see them); Escape closes.
        onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Escape" && !e.defaultPrevented && !document.querySelector("[role=alertdialog]")) close.current(); }}>{children}</div>
    </div>, document.body);
}
