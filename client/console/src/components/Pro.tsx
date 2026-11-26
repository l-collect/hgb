import type { ReactNode } from "react";
import type { SubscriptionQuota } from "../api/types";
import { navigate, paths } from "../router";
import { useConsole } from "../state/context";
import { join } from "./ui";
import p from "./Pro.module.css";

/**
 * What a free account sees of Pro: the feature drawn as usual but locked, and clicking the lock opens 会员与账号. A Pro
 * account (or a server that sends no quota) sees no lock at all; the server refuses either way (403 pro_required), so
 * the locks only say so beforehand.
 */
type Feature = "allowCoopTeam" | "allowAutoAccountSwitch" | "allowExternalChannels";
type Limit = "maxDevices" | "maxGameAccounts" | "maxPlans";

export function usePro() {
  const { account } = useConsole();
  const quota: SubscriptionQuota | undefined = account.tier === "PRO" ? undefined : account.quota;
  return {
    /** A free account whose quota is known. */
    free: !!quota,
    /** The feature is Pro only for this account. */
    locked: (feature: Feature) => !!quota && !quota[feature],
    /** [count] has reached the limit: adding one more needs Pro. */
    full: (limit: Limit, count: number) => !!quota && count >= quota[limit],
    /** 「2/2」 while a free account is at or one short of the limit; null otherwise. */
    count: (limit: Limit, count: number) => quota && quota[limit] > 0 && count >= quota[limit] - 1 ? `${count}/${quota[limit]}` : null,
  };
}

/** Opens 会员与账号 (activation code), asking first when a form has unsaved edits. */
export const goPro = () => navigate(paths.meAccount);

export function LockIcon({ size = 14 }: { size?: number }) {
  return (
    <svg className={p.lockIcon} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="4.5" y="10.5" width="15" height="10" rx="2.5" /><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
    </svg>
  );
}
/** The lock and Pro, in the Pro violet. */
export function ProBadge({ large }: { large?: boolean }) {
  return <span className={join(p.badge, large && p.badgeLarge)}><LockIcon size={large ? 16 : 12} />Pro</span>;
}
/** The badge alone as a button, where a switch would be (a channel card, a preset not yet copied). */
export function ProLockButton({ name }: { name: string }) {
  return <button type="button" className={p.badgeButton} aria-label={`Pro 功能：${name}，去开通`} onClick={goPro}><ProBadge /></button>;
}

/**
 * 整块锁: [children] drawn as usual under a veil, out of reach (not focusable, not clickable); the whole block is one
 * button to 会员与账号. Unlocked, [children] as they are.
 */
export function ProLockCard({ name, locked, children, className }: { name: string; locked: boolean; children: ReactNode; className?: string }) {
  if (!locked) return <>{children}</>;
  return (
    <div className={join(p.lockCard, className)}>
      <div className={p.under} inert>{children}</div>
      <button type="button" className={p.veil} aria-label={`Pro 功能：${name}，去开通`} onClick={goPro}><ProBadge large /></button>
    </div>
  );
}

/** 单行锁: one greyed list row, [label] (and [detail] under it), the lock and Pro at its end in place of a value. */
export function ProLockRow({ label, detail, name, compact }: { label: ReactNode; detail?: ReactNode; name?: string; compact?: boolean }) {
  return (
    <button type="button" className={join(p.row, compact && p.compact)} aria-label={`Pro 功能：${name ?? (typeof label === "string" ? label : "")}，去开通`} onClick={goPro}>
      <span className={p.rowText}>{label}{detail && <span className={p.rowDetail}>{detail}</span>}</span>
      <ProBadge />
    </button>
  );
}

/** 上限锁: the 新建 / 添加 button once the quota is used up: grey, locked, 「新建 · Pro」, and it opens 会员与账号. */
export function ProLimitButton({ text = "新建", what, small }: { text?: string; what: string; small?: boolean }) {
  return (
    <button type="button" className={join(p.limit, small && p.limitSmall)} aria-label={`${what}已达上限，${text}需 Pro，去开通`} onClick={goPro}>
      <LockIcon />{text} · <span className={p.pro}>Pro</span>
    </button>
  );
}

/** 「计划 2/2」's count, beside a title; nothing unless a free account is near its limit. */
export function ProCount({ text }: { text: string | null }) {
  if (!text) return null;
  const [, have, max] = /(\d+)\/(\d+)/.exec(text)?.map(Number) ?? [];
  return <span className={join(p.count, have >= max && p.countFull)}>{text}</span>;
}
