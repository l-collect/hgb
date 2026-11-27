import { useNextPlan } from "../../components/Hero";
import { join, ui } from "../../components/ui";
import s from "./Onboarding.module.css";

/** Where the App is downloaded: this deployment's latest release (the link 我的 uses too). */
export const APP_DOWNLOAD = `https://github.com/${import.meta.env.VITE_CODE_REPO}/releases/latest`;

const PHONE = <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true"><rect x="7" y="3" width="10" height="18" rx="3" /><path d="M11 17.5h2" /></svg>;
const DOWNLOAD = <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 4v10M8 10l4 4 4-4M5 19h14" /></svg>;

/**
 * 新号引导: with no device yet, the one card the 任务, 账号 and 设备 pages show first, as the page's light hero card —
 * install the App on the phone, and the device appears once it signs in with this account. On a page that shows
 * [NextPlanHero] for [nextPlanGame] (its game, "" for every game) and has a next plan, it is a plain white card instead:
 * one hero card per page.
 */
export function InstallAppCard({ className, nextPlanGame }: { className?: string; nextPlanGame?: string }) {
  const next = useNextPlan(nextPlanGame || undefined);
  const plain = nextPlanGame !== undefined && !!next;
  return (
    <section aria-label="第一步" className={join(plain ? s.plain : ui.hero, s.card, className)}>
      <span className={join(ui.tile, s.icon)}>{PHONE}</span>
      <b className={s.title}>在手机上装护肝宝</b>
      <a className={join(ui.button, ui.primary, s.button)} href={APP_DOWNLOAD} target="_blank" rel="noreferrer">{DOWNLOAD}下载 App</a>
    </section>
  );
}
