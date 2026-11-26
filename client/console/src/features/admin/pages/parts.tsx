import { useEffect, useState, type ReactNode } from "react";
import { Button, join, Popover, ui } from "../../../components/ui";
import { PAGE } from "../api";
import s from "./pages.module.css";

/** The page's title row, the design's 22px heading with its actions at the end. */
export function Title({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return <div className={s.titleRow}><h1>{children}</h1>{aside}</div>;
}

/** A filter shown as a chip, 批次 ▾; its options open under it, the chosen one highlighted. */
export function FilterChip<T extends string | number>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange: (value: T) => void }) {
  const current = options.find(([id]) => id === value);
  const on = current !== undefined && current !== options[0];
  return (
    <Popover label={label} plain trigger={<span className={join(ui.chip, on && ui.chipOn, s.filterChip)}>{on ? `${label} · ${current![1]}` : label} ▾</span>}>
      {(close) => (
        <div role="listbox" aria-label={label} className={ui.options}>
          {options.map(([id, text]) => (
            <button key={String(id)} type="button" role="option" aria-selected={id === value} className={join(ui.option, id === value && ui.optionOn)}
              onClick={() => { close(); if (id !== value) onChange(id); }}>{text}</button>
          ))}
        </div>
      )}
    </Popover>
  );
}

/** A search box that reports what was typed once typing pauses. */
export function Search({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  useEffect(() => {
    if (text === value) return;
    const timer = setTimeout(() => onChange(text), 300);
    return () => clearTimeout(timer);
  }, [text, value, onChange]);
  return <input type="search" className={s.search} aria-label={placeholder} placeholder={placeholder} value={text} onChange={(e) => setText(e.target.value)} />;
}

/** 1–50 / 120, then the previous and next pages. */
export function Pager({ offset, total, onChange }: { offset: number; total: number; onChange: (offset: number) => void }) {
  if (total <= PAGE && offset === 0) return null;
  return (
    <div className={s.pager}>
      <span className={ui.tiny}>{total === 0 ? 0 : offset + 1}–{Math.min(offset + PAGE, total)} / {total}</span>
      <Button small disabled={offset === 0} onClick={() => onChange(Math.max(0, offset - PAGE))}>上一页</Button>
      <Button small disabled={offset + PAGE >= total} onClick={() => onChange(offset + PAGE)}>下一页</Button>
    </div>
  );
}

/** The design's right-hand drawer over the page: a heading row with ✕, the body, and a row of buttons at the foot. */
export function Drawer({ title, onClose, children, foot }: { title: string; onClose: () => void; children: ReactNode; foot: ReactNode }) {
  useEffect(() => {
    // A question open over the drawer takes Escape itself.
    const key = (event: KeyboardEvent) => { if (event.key === "Escape" && !document.querySelector("[role=alertdialog]")) onClose(); };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [onClose]);
  return (
    <>
      <div className={s.scrim} onClick={onClose} aria-hidden="true" />
      <aside className={s.drawer} role="dialog" aria-modal="true" aria-label={title}>
        <div className={s.drawerHead}><b>{title}</b><button type="button" className={ui.iconButton} aria-label="关闭" onClick={onClose}>✕</button></div>
        <div className={s.drawerBody}>{children}</div>
        <div className={s.drawerFoot}>{foot}</div>
      </aside>
    </>
  );
}
