import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ApiFailure } from "../../console/src/api/client";
import { Button, Empty, Mark, Pill, ui } from "../../console/src/components/ui";
import { Link, usePath } from "../../console/src/router";
import { admin, type Admin } from "./api";
import { who } from "./format";
import { CodesPage } from "./pages/Codes";
import { UsersPage } from "./pages/Users";
import s from "./App.module.css";

type Session = { kind: "loading" } | { kind: "signed-out" } | { kind: "denied" } | { kind: "failed"; message: string } | { kind: "admin"; me: Admin };

/** Raised by a page whose call came back 401 or 403: the session ended or is no longer an admin's, so ask again. */
const AUTH_LOST = "admin:auth-lost";
/** A failed call's text for the user; a lost session also sends the whole admin back to its gate. */
export function failure(error: unknown): string {
  if (error instanceof ApiFailure && (error.status === 401 || error.status === 403)) window.dispatchEvent(new Event(AUTH_LOST));
  if (error instanceof ApiFailure && FALLBACK[error.code] && (!error.message || error.message === "操作失败，请稍后再试")) return FALLBACK[error.code];
  return error instanceof Error ? error.message : "操作失败，请稍后再试";
}
/** Words for the contract's codes when the server sends no message of its own. */
const FALLBACK: Record<string, string> = {
  invalid_request: "填写的内容不对，请检查后再试", not_found: "找不到了，可能已被删除", rate_limited: "操作太频繁，请稍后再试", code_used: "已兑换的码不能作废", self: "不能改自己",
};

/**
 * /admin shares the console's sign-in (the same cookie). Whether someone is an admin is the server's answer alone:
 * 401 shows 去登录, 403 not_admin shows 没有权限.
 */
export function App() {
  const [session, setSession] = useState<Session>({ kind: "loading" });
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
    case "signed-out": return <Gate title="护肝宝 · 管理" text="用控制台的账号登录"><a className={buttonClass("primary")} href="/console/">去登录</a></Gate>;
    case "denied": return (
      <Gate title="没有权限" text="当前账号不是管理员">
        <a className={buttonClass("primary")} href="/console/">回控制台</a>
        <Button onClick={() => { admin.logout().catch(() => {}).finally(() => { location.href = "/console/"; }); }}>换个账号</Button>
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
  ["codes", "兑换码", "/", icon(<><circle cx="8" cy="15" r="4" /><path d="M11 12l9-9M17 6l3 3" /></>)],
  ["users", "用户", "/users", icon(<><circle cx="12" cy="8" r="4" /><path d="M5 20a7 7 0 0 1 14 0" /></>)],
];

function Shell({ me }: { me: Admin }) {
  const path = usePath();
  const section = path.startsWith("/users") ? "users" : "codes";
  return (
    <div className={s.shell}>
      <nav className={s.nav} aria-label="管理导航">
        <span className={s.brand}><Mark size={26} /><b>护肝宝</b><Pill tone="soft">管理</Pill></span>
        {LINKS.map(([id, label, to, svg]) => (
          <Link key={id} to={to} className={s.link} aria-current={id === section ? "page" : undefined}>{svg}{label}</Link>
        ))}
        <span className={s.me}><span className={s.meName}>{who(me)}</span><a href="/console/">← 控制台</a></span>
      </nav>
      <main className={s.main}>{section === "users" ? <UsersPage me={me.userId} /> : <CodesPage />}</main>
    </div>
  );
}
