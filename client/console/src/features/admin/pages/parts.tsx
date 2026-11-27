import { useEffect, useId, useState, type ReactNode } from "react";
import { join, Popover, ui } from "../../../components/ui";
import { PAGE } from "../api";
import { BackIcon, CloseIcon, DownIcon, NextIcon, SearchIcon } from "../icons";
import s from "./pages.module.css";

/** The page's title row: the 26 heading with its actions at the end. */
export function Title({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return <div className={s.titleRow}><h1>{children}</h1>{aside}</div>;
}

/** The status tabs, kept at their width and scrolled sideways when the row is narrower. */
export function TabsRow({ children }: { children: ReactNode }) {
  return <div className={s.seg}>{children}</div>;
}

/** A filter shown as a white pill, 批次 全部 ▾; its options open under it, the chosen one highlighted. */
export function FilterChip<T extends string | number>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange: (value: T) => void }) {
  const current = options.find(([id]) => id === value) ?? options[0];
  const on = current !== options[0];
  return (
    <Popover label={`${label}：${current[1]}`} plain trigger={<span className={join(s.pick, on && s.pickOn)}>{label}<span className={s.pickValue}>{current[1]}</span><DownIcon /></span>}>
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
  return (
    <label className={s.search}>
      <SearchIcon />
      <input type="search" aria-label={placeholder} placeholder={placeholder} value={text} onChange={(e) => setText(e.target.value)} />
    </label>
  );
}

/** 1–50 / 120, then the previous and next pages as round buttons. */
export function Pager({ offset, total, onChange }: { offset: number; total: number; onChange: (offset: number) => void }) {
  if (total <= PAGE && offset === 0) return null;
  return (
    <div className={s.pager}>
      <span className={ui.tiny}>{total === 0 ? 0 : offset + 1}–{Math.min(offset + PAGE, total)} / {total}</span>
      <button type="button" className={s.pageButton} aria-label="上一页" disabled={offset === 0} onClick={() => onChange(Math.max(0, offset - PAGE))}><BackIcon size={18} /></button>
      <button type="button" className={s.pageButton} aria-label="下一页" disabled={offset + PAGE >= total} onClick={() => onChange(offset + PAGE)}><NextIcon /></button>
    </div>
  );
}

/**
 * The drawer over the page: its title with ✕, the body, and the buttons at the foot, right-aligned with the main one
 * last. On wide it is the full height on the right (480); narrower it takes the whole window.
 */
export function Drawer({ title, onClose, children, foot }: { title: string; onClose: () => void; children: ReactNode; foot: ReactNode }) {
  const heading = useId();
  useEffect(() => {
    // A question open over the drawer takes Escape itself.
    const key = (event: KeyboardEvent) => { if (event.key === "Escape" && !document.querySelector("[role=alertdialog]")) onClose(); };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [onClose]);
  return (
    <>
      <div className={s.scrim} onClick={onClose} aria-hidden="true" />
      <aside className={s.drawer} role="dialog" aria-modal="true" aria-labelledby={heading}>
        <div className={s.drawerHead}><h2 id={heading}>{title}</h2><button type="button" className={s.close} aria-label="关闭" onClick={onClose}><CloseIcon /></button></div>
        <div className={s.drawerBody}>{children}</div>
        <div className={s.drawerFoot}>{foot}</div>
      </aside>
    </>
  );
}
