import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ApiFailure } from "../../api/client";
import { Button, ErrorCard, Loading, Mark, ui, Tag } from "../../components/ui";
import { BackIcon, KeyIcon, UserIcon } from "./icons";
import { ConfirmHost } from "../../components/Confirm";
import { ToastHost } from "../../components/Toast";
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
  const path = usePath();
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
    case "loading": return <Loading />;
    case "failed": return <div style={{ padding: 16 }}><ErrorCard text={session.message} retry={() => { setSession({ kind: "loading" }); void check(); }} /></div>;
    // Signed in, the sign-in page comes back here (next).
    case "signed-out": return <Gate title="护肝宝 · 管理" text="用控制台的账号登录"><Link className={buttonClass("primary")} to={`${paths.login}?next=${encodeURIComponent(path)}`}>去登录</Link></Gate>;
    // The way out first, the main action last (on the right).
    case "denied": return (
      <Gate title="没有权限" text="当前账号不是管理员">
        <Button onClick={() => { admin.logout().catch(() => {}).finally(() => { location.href = paths.login; }); }}>换个账号</Button>
        <Link className={buttonClass("primary")} to={paths.tasks}>回控制台</Link>
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
        <Mark size={56} /><h1 className={s.gateTitle}>{title}</h1><span className={s.gateText}>{text}</span>
        <div className={s.gateActions}>{children}</div>
      </div>
    </main>
  );
}

const LINKS: ["codes" | "users", string, string, ReactNode][] = [
  ["codes", "兑换码", "/admin", <KeyIcon />],
  ["users", "用户", "/admin/users", <UserIcon />],
];

function Shell({ me }: { me: Admin }) {
  const path = usePath();
  const section = path.startsWith("/admin/users") ? "users" : "codes";
  return (
    <div className={s.shell}>
      <nav className={s.nav} aria-label="管理导航">
        <span className={s.brand}><Mark size={32} /><b className={s.brandName}>护肝宝</b><Tag className={s.brandTag}>管理</Tag></span>
        {LINKS.map(([id, label, to, svg]) => (
          <Link key={id} to={to} className={s.link} aria-current={id === section ? "page" : undefined}>{svg}{label}</Link>
        ))}
        <span className={s.me}><span className={s.meName}>{who(me)}</span><Link to={paths.tasks} className={s.back} aria-label="回控制台"><BackIcon /><span className={s.backText}>控制台</span></Link></span>
      </nav>
      <main className={s.main}>{section === "users" ? <UsersPage me={me.userId} /> : <CodesPage />}</main>
      <ConfirmHost />
      <ToastHost />
    </div>
  );
}
