import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { join } from "./ui";
import s from "./TimePicker.module.css";

const pad = (n: number) => String(n).padStart(2, "0");
const HOURS = Array.from({ length: 24 }, (_, i) => i);

/** "HH:MM" from what was typed: 2130, 21:30, 21：30, 21.30, 930, 9 (→ 09:00); null when it is not a time of day. */
export function parseTime(text: string): string | null {
  const t = text.trim().replace(/[：.\s]/g, ":");
  let h: number, m: number;
  const parts = /^(\d{1,2}):(\d{1,2})(?::\d{1,2})?$/.exec(t);
  if (parts) { h = Number(parts[1]); m = Number(parts[2]); }
  else if (/^\d{1,4}$/.test(t)) {
    if (t.length <= 2) { h = Number(t); m = 0; } else { h = Number(t.slice(0, -2)); m = Number(t.slice(-2)); }
  } else return null;
  return h < 24 && m < 60 ? `${pad(h)}:${pad(m)}` : null;
}
const split = (value: string) => { const t = parseTime(value); return t ? [Number(t.slice(0, 2)), Number(t.slice(3))] as const : null; };

/**
 * A time of day, 24-hour "HH:MM": a clock and the time in a box that can be typed into (2130 or 21:30, read on blur
 * or Enter; anything else puts the time back). Clicking it, or ↓, opens a panel under it: an hour and a minute
 * column (minutes every [minuteStep]) and [presets] below. ↑↓ move in a column and pick, ←→ or Tab change column,
 * Enter or Escape close it; closing puts the focus back in the box, as does clicking outside onto nothing.
 */
export function TimePicker({ value, onChange, label, minuteStep = 5, presets = ["07:00", "12:00", "21:00", "00:00"], disabled, clearable, required }: {
  value: string; onChange: (value: string) => void; label: string; minuteStep?: number; presets?: string[]; disabled?: boolean; clearable?: boolean; required?: boolean;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<CSSProperties>({});
  const now = split(value);
  const hour = now?.[0], minute = now?.[1];
  // The minute in use stays listed even off the step (21:07 with a step of 5).
  const minutes = Array.from({ length: Math.ceil(60 / minuteStep) }, (_, i) => i * minuteStep);
  if (minute !== undefined && !minutes.includes(minute)) { minutes.push(minute); minutes.sort((a, b) => a - b); }

  const pick = (h: number, m: number) => { const next = `${pad(h)}:${pad(m)}`; if (next !== value) onChange(next); };
  const close = (refocus = true) => { setOpen(false); if (refocus) input.current?.focus({ preventScroll: true }); };
  const commit = () => {
    if (draft === null) return;
    setDraft(null);
    if (draft.trim() === "") { if (clearable && value) onChange(""); return; }
    const t = parseTime(draft);
    if (t && t !== value) onChange(t);
  };

  // Placed on the page, as Popover is, so a card or the drawer does not clip it; above when there is no room below.
  useLayoutEffect(() => {
    if (!open) return;
    const at = () => {
      const rect = input.current?.getBoundingClientRect(); if (!rect) return;
      const width = panel.current?.offsetWidth ?? 240, height = panel.current?.offsetHeight ?? 300;
      const below = window.innerHeight - rect.bottom;
      const vertical: CSSProperties = below < height + 12 && rect.top > below ? { bottom: window.innerHeight - rect.top + 6 } : { top: rect.bottom + 6 };
      setPlace({ ...vertical, left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)) });
    };
    at();
    window.addEventListener("resize", at); window.addEventListener("scroll", at, true);
    return () => { window.removeEventListener("resize", at); window.removeEventListener("scroll", at, true); };
  }, [open]);
  // The chosen hour and minute in the middle of their columns when it opens.
  useLayoutEffect(() => {
    if (!open || !panel.current) return;
    for (const item of panel.current.querySelectorAll<HTMLElement>("[aria-selected=true]")) {
      const column = item.parentElement!; column.scrollTop = item.offsetTop - column.clientHeight / 2 + item.offsetHeight / 2;
    }
  }, [open, hour, minute]);
  useEffect(() => {
    if (!open) return;
    const away = (event: MouseEvent) => {
      if (box.current?.contains(event.target as Node)) return;
      setOpen(false);
      // Onto nothing that takes the focus: it comes back to the box rather than to the page.
      window.setTimeout(() => { if (document.activeElement === document.body) input.current?.focus({ preventScroll: true }); });
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);

  // A column to put the focus in once the panel has been drawn (opened, or a new item chosen).
  const want = useRef<"hour" | "minute" | null>(null);
  useEffect(() => { if (want.current && open) { const which = want.current; want.current = null; focusIn(which); } });
  const focusIn = (which: "hour" | "minute") => {
    const column = panel.current?.querySelector<HTMLElement>(`[data-column=${which}]`);
    (column?.querySelector<HTMLElement>("[aria-selected=true]") ?? column?.querySelector<HTMLElement>("button"))?.focus({ preventScroll: true });
  };
  const columnKeys = (which: "hour" | "minute", list: number[], at: number | undefined) => (e: KeyboardEvent) => {
    const i = at === undefined ? -1 : list.indexOf(at);
    const move = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : e.key === "PageDown" ? 6 : e.key === "PageUp" ? -6 : 0;
    if (move) {
      e.preventDefault();
      const next = list[Math.max(0, Math.min(list.length - 1, i < 0 ? 0 : i + move))];
      if (next === at) return;
      if (which === "hour") pick(next, minute ?? 0); else pick(hour ?? 0, next);
      // The new item takes the focus once it is drawn as chosen.
      want.current = which;
    } else if (e.key === "ArrowRight" && which === "hour") { e.preventDefault(); focusIn("minute"); }
    else if (e.key === "ArrowLeft" && which === "minute") { e.preventDefault(); focusIn("hour"); }
  };
  const column = (which: "hour" | "minute", list: number[], at: number | undefined) => (
    <div className={s.column} role="listbox" aria-label={which === "hour" ? "时" : "分"} data-column={which} onKeyDown={columnKeys(which, list, at)}>
      {list.map((n) => {
        const on = n === at;
        // One stop per column for Tab: the chosen item, or the first while none is.
        const stop = on || (at === undefined && n === list[0]) || (at !== undefined && !list.includes(at) && n === list[0]);
        return (
          <button key={n} type="button" role="option" aria-selected={on} tabIndex={stop ? 0 : -1} className={join(s.item, on && s.itemOn)}
            onClick={(e) => {
              if (which === "hour") pick(n, minute ?? 0); else pick(hour ?? 0, n);
              // A minute finishes the choice; an hour waits for its minute. Enter or Space on either closes.
              if (which === "minute" || e.detail === 0) close();
            }}>{pad(n)}</button>
        );
      })}
    </div>
  );

  return (
    <span ref={box} className={join(s.picker, disabled && s.off)}
      onKeyDown={(e) => {
        if (e.key === "Escape" && (open || draft !== null)) {
          // The drawer around it would take Escape as closing itself.
          e.preventDefault(); e.stopPropagation();
          if (open) close(); else setDraft(null);
        }
      }}
      onBlur={(e) => { if (open && !box.current?.contains(e.relatedTarget as Node | null) && e.relatedTarget) setOpen(false); }}>
      <span className={s.field}>
        <svg className={s.clock} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
        </svg>
        <input ref={input} type="text" inputMode="numeric" autoComplete="off" aria-label={label} aria-haspopup="dialog" aria-expanded={open}
          required={required} disabled={disabled} placeholder="--:--" maxLength={5} className={s.input}
          value={draft ?? value}
          onChange={(e) => setDraft(e.target.value.replace(/[^0-9:：.]/g, ""))}
          onBlur={commit}
          onClick={() => { if (!disabled) setOpen(true); }}
          onKeyDown={(e) => {
            if (e.key === "Enter") { if (draft !== null) { e.preventDefault(); commit(); } if (open) { e.preventDefault(); setOpen(false); } }
            else if (e.key === "ArrowDown" || (e.key === "ArrowUp" && open)) {
              e.preventDefault(); commit();
              want.current = "hour";
              if (!open) setOpen(true); else focusIn("hour");
            }
          }} />
      </span>
      {open && (
        <div ref={panel} className={s.panel} style={place} role="dialog" aria-label={`选择${label}`}>
          <div className={s.columns}>
            {column("hour", HOURS, hour)}
            <span className={s.colon} aria-hidden="true">:</span>
            {column("minute", minutes, minute)}
          </div>
          {presets.length > 0 && (
            <div className={s.presets} role="group" aria-label="常用时刻">
              {presets.map((p) => (
                <button key={p} type="button" className={join(s.preset, p === value && s.presetOn)} aria-pressed={p === value}
                  onClick={() => { const t = parseTime(p); if (t && t !== value) onChange(t); close(); }}>{p}</button>
              ))}
            </div>
          )}
        </div>
      )}
    </span>
  );
}
