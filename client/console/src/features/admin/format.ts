import type { Tone } from "../../format";
import type { CodeStatus, Person, User } from "./api";

const pad = (n: number) => String(n).padStart(2, "0");
/** MM-DD, with the year in front when it is not this year. */
export function day(value: number | null | undefined): string {
  if (!value) return "—";
  const at = new Date(value);
  const md = `${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
  return at.getFullYear() === new Date().getFullYear() ? md : `${at.getFullYear()}-${md}`;
}
/** MM-DD HH:mm, as the design's tables write a time. */
export function time(value: number | null | undefined): string {
  if (!value) return "—";
  const at = new Date(value);
  return `${day(value)} ${pad(at.getHours())}:${pad(at.getMinutes())}`;
}
/** 今天 / 昨天 / MM-DD, for 最近活跃. */
export function since(value: number | null | undefined): string {
  if (!value) return "—";
  const start = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((start(new Date()) - start(new Date(value))) / 86400000);
  return days === 0 ? "今天" : days === 1 ? "昨天" : day(value);
}
/**
 * A date input's value (YYYY-MM-DD) as the last moment of that day in Asia/Shanghai, as the server counts days, and
 * back; not the browser's time zone. Shanghai is UTC+8 all year (no daylight saving), so a fixed offset is exact.
 */
const SHANGHAI = 8 * 3600000;
export const endOfDay = (input: string) => { const [y, m, d] = input.split("-").map(Number); return Date.UTC(y, m - 1, d, 23, 59, 59, 999) - SHANGHAI; };
export const dateInput = (value: number) => { const at = new Date(value + SHANGHAI); return `${at.getUTCFullYear()}-${pad(at.getUTCMonth() + 1)}-${pad(at.getUTCDate())}`; };
/** The longest a tier or a code may run, as the server allows: 3650 days from now. */
export const MAX_DAYS = 3650;

/** A code as the list shows it: its first characters and …; an old code without them shows —. */
export const shortCode = (prefix: string) => prefix ? `${prefix}…` : "—";
export const duration = (days: number | null) => days == null ? "永久" : `${days} 天`;
/** A code's status and its tone: only 已用 is coloured; 未用, 作废 and 过期 need nobody to act, so they stay neutral. */
export const CODE_STATUS: Record<CodeStatus, [string, Tone]> = { unused: ["未用", ""], used: ["已用", "ok"], revoked: ["作废", ""], expired: ["过期", ""] };

/** Who someone is, short: their email, else their GitHub login. */
export const who = (person: Pick<Person, "email" | "githubLogin">) => person.email ?? (person.githubLogin ? `gh:${person.githubLogin}` : "—");
export const expiry = (user: Pick<User, "tier" | "proExpiresAt">) => user.tier !== "PRO" ? "—" : user.proExpiresAt == null ? "永久" : day(user.proExpiresAt);
