import { useEffect, useRef, type ReactNode } from "react";
import { leave } from "../router";
import s from "./Drawer.module.css";

/**
 * A panel sliding in from the right over a wide page (网页桌面 · 计划编辑): the page stays in view, faded, and closes
 * the drawer when clicked; Escape closes it too. Its content scrolls inside it, so [head] and [foot] can stick.
 * Only for wide windows: on a narrow one the same editor is its own page.
 * With unsaved edits (a form inside that called useLeaveGuard, or [dirty]) Escape, the faded page, ✕ and 取消 ask
 * 「放弃修改？」 first; the faded page never closes it by itself then.
 */
export function Drawer({ label, onClose, children, width = 520, dirty = false }: { label: string; onClose: () => void; children: ReactNode; width?: number; dirty?: boolean }) {
  const box = useRef<HTMLElement>(null);
  const close = useRef(() => leave(onClose, dirty)); close.current = () => leave(onClose, dirty);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    box.current?.focus({ preventScroll: true });
    const key = (event: KeyboardEvent) => {
      // A menu open inside the drawer, or a question over it, takes Escape first.
      if (event.key === "Escape" && !document.querySelector("[role=menu],[role=alertdialog]")) close.current();
    };
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("keydown", key); opener?.focus?.({ preventScroll: true }); };
  }, []);
  return (
    <>
      <div className={s.scrim} onClick={() => close.current()} aria-hidden="true" />
      <aside ref={box} className={s.drawer} style={{ width: `min(${width}px, 100vw)` }} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1}>
        {children}
      </aside>
    </>
  );
}

/** The drawer's title row, fixed at its top: the title, then [aside], then ✕. */
export function DrawerHead({ title, aside, onClose }: { title: ReactNode; aside?: ReactNode; onClose: () => void }) {
  return (
    <div className={s.head}>
      <b className={s.title}>{title}</b>{aside}
      <button type="button" className={s.close} aria-label="关闭" onClick={onClose}>✕</button>
    </div>
  );
}
export function DrawerBody({ children }: { children: ReactNode }) { return <div className={s.body}>{children}</div>; }
/** The bar fixed at the drawer's bottom (删除 / 取消 / 保存计划). */
export function DrawerFoot({ children }: { children: ReactNode }) { return <div className={s.foot}>{children}</div>; }
/** A labelled control in the drawer's two-column grid; not a <label>, so a stepper's buttons are not clicked by its name. */
export function DrawerField({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return <div className={wide ? `${s.field} ${s.fieldWide}` : s.field}><span className={s.label}>{label}</span>{children}</div>;
}
export function DrawerGrid({ children }: { children: ReactNode }) { return <div className={s.grid}>{children}</div>; }
export const drawerStyles = s;
