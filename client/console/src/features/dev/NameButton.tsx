import { useState, type CSSProperties, type ReactNode } from "react";
import w from "./Wb.module.css";

/** An id from what was typed: letters, digits and "-", starting with a letter; "" when there are none (a Chinese name). */
export const idOf = (name: string) => {
  const trimmed = name.trim();
  // Written as an id (collectRealm): kept as it is; anything else lower-cased with "-" between words.
  if (/^[A-Za-z][A-Za-z0-9-]*$/.test(trimmed)) return trimmed;
  return trimmed.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").replace(/^[0-9-]+/, "");
};

/**
 * A button that asks for a name in place: it turns into a field with 确定 and 取消 (Enter and Esc work too). In
 * place of the browser's own prompt, which a page cannot style and which the browser may dismiss on its own.
 * With [askId], an id is asked beside it: taken from the name when the name has letters, required when it has none,
 * so a Chinese name never becomes "field" or "step".
 */
export function NameButton({ label, placeholder, className, style, askId, onName }: { label: ReactNode; placeholder: string; className?: string;
  style?: CSSProperties; askId?: boolean; onName: (name: string, id: string) => unknown }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [id, setId] = useState("");
  const close = () => { setOpen(false); setName(""); setId(""); };
  const chosen = idOf(id) || idOf(name);
  const ready = name.trim() !== "" && (!askId || chosen !== "");
  const submit = async () => {
    const value = name.trim(); if (!ready) return; close();
    try { await onName(value, chosen); } catch (error) { console.error(error); }
  };
  const keys = (e: React.KeyboardEvent) => {
    // Enter while an input method composes (pinyin) only commits the composition.
    if (e.key === "Enter" && !e.nativeEvent.isComposing && e.keyCode !== 229) void submit();
    if (e.key === "Escape") { e.stopPropagation(); close(); }
  };
  if (!open) return <button type="button" className={className ?? w.btn} style={style} onClick={() => setOpen(true)}>{label}</button>;
  const field: CSSProperties = { minHeight: 34, padding: "0 10px", borderRadius: 8, border: "1px solid var(--color-line)", background: "var(--color-control)", color: "inherit", font: "inherit", minWidth: 140 };
  return (
    <span style={{ display: "inline-flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
      <input autoFocus aria-label={placeholder} placeholder={placeholder} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={keys} style={field} />
      {askId && <input aria-label="编号（英文字母、数字、-）" placeholder={idOf(name) || "编号，如 collect-realm"} value={id} onChange={(e) => setId(e.target.value)} onKeyDown={keys}
        title="编号用英文：写进任务包、配置里，以后不好改" style={{ ...field, minWidth: 160 }} />}
      <button type="button" className={`${w.btn} ${w.primary}`} style={{ minHeight: 34 }} disabled={!ready} onClick={() => void submit()}>确定</button>
      <button type="button" className={w.btn} style={{ minHeight: 34 }} onClick={close}>取消</button>
    </span>
  );
}
