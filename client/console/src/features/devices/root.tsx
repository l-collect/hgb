import type { Device, DeviceRoot } from "../../api/types";
import type { Tone } from "../../format";
import { Card, CardHead, join, Pill, ui } from "../../components/ui";
import { Link, paths } from "../../router";
import s from "./Root.module.css";

/** The docs page on turning Root on, a section of it with [section] (its heading). */
export const rootDocs = (section?: string) => `/docs/start/root/${section ? `#${section}` : ""}`;

/** What Root means for a device: its pill, a note (the Root tool when ready), and what to do about it when not. */
export function rootView(root: DeviceRoot): { label: string; tone: Tone; note: string | null; fix: [string, string] | null } {
  if (root.state === "ready") return { label: "已就绪", tone: "ok", note: root.manager || null, fix: null };
  if (root.state === "denied") return { label: "没允许", tone: "warn", note: null, fix: ["在手机上允许护肝宝 ›", rootDocs("允许护肝宝")] };
  if (root.emulator) return { label: "没开（模拟器）", tone: "warn", note: null, fix: ["在模拟器设置里打开 ›", rootDocs("模拟器")] };
  return { label: "没有", tone: "warn", note: null, fix: ["怎么开 Root ›", rootDocs()] };
}

/** Root · 已就绪 · KernelSU, or Root · 没允许 · 在手机上允许护肝宝 ›; nothing for an App too old to say. */
export function RootLine({ device, className }: { device: Device; className?: string }) {
  if (!device.root) return null;
  const { label, tone, note, fix } = rootView(device.root);
  return (
    <p className={join(s.line, className)}>
      <span className={s.label}>Root</span>
      <Pill tone={tone}>{label}</Pill>
      {note && <span className={ui.tiny}>{note}</span>}
      {fix && <a className={s.fix} href={fix[1]}>{fix[0]}</a>}
    </p>
  );
}

/**
 * 账号与计划's bar: N 台设备里有 M 台没 Root, what that costs, and 怎么开 Root ›. Devices whose App does not report Root
 * count in N but never in M.
 */
export function RootBanner({ devices }: { devices: Device[] }) {
  const without = devices.filter((device) => device.root && device.root.state !== "ready");
  if (!without.length) return null;
  const who = without.length === 1 ? `${without[0].name} ` : "这些设备";
  // 没允许 is not 没 Root: the fix is on the phone's Root tool, so each is counted on its own.
  const none = without.filter((device) => device.root?.state === "none").length;
  const denied = without.length - none;
  const counts = [none && `${none} 台没 Root`, denied && `${denied} 台没允许护肝宝`].filter(Boolean).join("，");
  return (
    <div className={s.banner} role="status">
      <span className={s.bannerText}>
        <b className={s.bannerTitle}>{devices.length} 台设备里有 {counts}</b>
        <span className={s.bannerNote}>{who}登录游戏不会自动建号，也存不了登录快照、不能自动切号。</span>
      </span>
      <a className={join(ui.button, ui.small, ui.primary)} href={rootDocs()}>怎么开 Root ›</a>
    </div>
  );
}

/**
 * 账号与计划's 设备 card (设备 / 在线 / Root / 说明), shown once some device reports Root; one line a device on a narrow
 * window. A device whose App does not report Root leaves its Root and 说明 empty.
 */
export function RootDevicesCard({ devices }: { devices: Device[] }) {
  if (!devices.some((device) => device.root)) return null;
  return (
    <Card flush as="section" aria-labelledby="root-devices">
      <CardHead id="root-devices" title="设备" aside={<span className={ui.tiny}>Root 状态由手机上报</span>} />
      <div className={s.table} role="table" aria-labelledby="root-devices">
        <div className={join(s.tr, s.th)} role="row">
          <span role="columnheader">设备</span><span role="columnheader">在线</span><span role="columnheader">Root</span><span role="columnheader">说明</span>
        </div>
        {devices.map((device) => {
          const view = device.root ? rootView(device.root) : null;
          return (
            <div key={device.id} className={s.tr} role="row">
              <span role="cell" className={s.name}><Link to={paths.device(device.id)} className={s.nameLink}>{device.name}</Link></span>
              <span role="cell"><Pill tone={device.online ? "ok" : ""}>{device.online ? "在线" : "离线"}</Pill></span>
              <span role="cell">{view && <Pill tone={view.tone}>{view.label}</Pill>}</span>
              <span role="cell" className={s.note}>
                {view?.fix ? <a className={s.fix} href={view.fix[1]}>{view.fix[0]}</a> : view?.note && <span className={ui.tiny}>{view.note}</span>}
              </span>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
