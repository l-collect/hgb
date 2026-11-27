import { Card, join, ui } from "../../components/ui";
import s from "./Onboarding.module.css";

/** Where the App is downloaded: this deployment's latest release (the link 我的 uses too). */
export const APP_DOWNLOAD = `https://github.com/${import.meta.env.VITE_CODE_REPO}/releases/latest`;

/**
 * 新号引导: with no device yet, the one card the 任务, 账号 and 设备 pages show first — install the App on the phone and
 * sign in there with this account, and the device appears here.
 */
export function InstallAppCard({ className }: { className?: string }) {
  return (
    <Card as="section" aria-label="第一步" className={join(s.card, className)}>
      <span className={s.text}>
        <b className={s.title}>第一步：手机装护肝宝</b>
        <span className={ui.tiny}>装好后用这个账号登录，设备会出现在这里</span>
      </span>
      <a className={join(ui.button, ui.primary, s.button)} href={APP_DOWNLOAD} target="_blank" rel="noreferrer">下载 App</a>
    </Card>
  );
}
