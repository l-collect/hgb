import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ApiFailure } from "../../api/client";
import { Button, Empty, Mark, Pill, ui } from "../../components/ui";
import { Link, paths, usePath } from "../../router";
import { admin, type Admin } from "./api";
import { AUTH_LOST } from "./failure";
import { who } from "./format";
import { CodesPage } from "./pages/Codes";
import { UsersPage } from "./pages/Users";
import s from "./Admin.module.css";

type Session = { kind: "loading" } | { kind: "signed-out" } | { kind: "denied" } | { kind: "failed"; message: string } | { kind: "admin"; me: Admin };

/**
 * The console's /admin, a bundle of its own loaded only when that address is opened (App.tsx), with its own sidebar
 * instead of the console's. It shares the console's sign-in (the same cookie). Whether someone is an admin is the
 * server's answer alone: 401 shows 去登录, 403 not_admin shows 没有权限.
 */
export default function AdminApp() {
  const [session, setSession] = useState<Session>({ kind: "loading" });
  useEffect(() => { document.title = "护肝宝管理"; return () => { document.title = "护肝宝控制台"; }; }, []);
  const check = useCallback(async () => {
    try { setSession({ kind: "admin", me: await admin.me() }); }
    catch (error) {
      if (error instanceof ApiFailure && error.status === 401) setSession({ kind: "signed-out" });
      else if (error instanceof ApiFailure && error.status === 403) setSession({ kind: "denied" });
      else setSession({ kind: "failed", message: error instanceof Error ? error.message : "无法连接服务器" });
    }
  }, []);
  useEffect(() => {
    void check();
    const again = () => void check();
    window.addEventListener(AUTH_LOST, again);
    return () => window.removeEventListener(AUTH_LOST, again);
  }, [check]);
  switch (session.kind) {
    case "loading": return <Empty>正在加载…</Empty>;
    case "failed": return <Empty>{session.message}</Empty>;
    case "signed-out": return <Gate title="护肝宝 · 管理" text="用控制台的账号登录"><Link className={buttonClass("primary")} to={paths.login}>去登录</Link></Gate>;
    case "denied": return (
      <Gate title="没有权限" text="当前账号不是管理员">
        <Link className={buttonClass("primary")} to={paths.tasks}>回控制台</Link>
        <Button onClick={() => { admin.logout().catch(() => {}).finally(() => { location.href = paths.login; }); }}>换个账号</Button>
      </Gate>
    );
    case "admin": return <Shell me={session.me} />;
  }
}

const buttonClass = (variant: "primary" | "ghost") => `${ui.button} ${ui[variant]}`;

function Gate({ title, text, children }: { title: string; text: string; children: ReactNode }) {
  return (
    <main className={s.gate}>
      <div className={s.gateCard}>
        <Mark size={40} /><b className={s.gateTitle}>{title}</b><span className={ui.tiny}>{text}</span>
        <div className={s.gateActions}>{children}</div>
      </div>
    </main>
  );
}

const icon = (d: ReactNode) => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">{d}</svg>;
const LINKS: ["codes" | "users", string, string, ReactNode][] = [
  ["codes", "兑换码", "/admin", icon(<><circle cx="8" cy="15" r="4" /><path d="M11 12l9-9M17 6l3 3" /></>)],
  ["users", "用户", "/admin/users", icon(<><circle cx="12" cy="8" r="4" /><path d="M5 20a7 7 0 0 1 14 0" /></>)],
];

function Shell({ me }: { me: Admin }) {
  const path = usePath();
  const section = path.startsWith("/admin/users") ? "users" : "codes";
  return (
    <div className={s.shell}>
      <nav className={s.nav} aria-label="管理导航">
        <span className={s.brand}><Mark size={26} /><b>护肝宝</b><Pill tone="soft">管理</Pill></span>
        {LINKS.map(([id, label, to, svg]) => (
          <Link key={id} to={to} className={s.link} aria-current={id === section ? "page" : undefined}>{svg}{label}</Link>
        ))}
        <span className={s.me}><span className={s.meName}>{who(me)}</span><Link to={paths.tasks}>← 控制台</Link></span>
      </nav>
      <main className={s.main}>{section === "users" ? <UsersPage me={me.userId} /> : <CodesPage />}</main>
    </div>
  );
}
