import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { api, ApiFailure } from "./api/client";
import type { Account } from "./api/types";
import { Empty } from "./components/ui";
import { AuthPage } from "./features/auth/AuthPage";
import { ConsolePage } from "./features/ConsolePage";
import { LegalPage } from "./features/site/LegalPage";
import { navigate, paths, usePath } from "./router";

/** /admin is a bundle of its own, fetched only when that address is opened. */
const AdminApp = lazy(() => import("./features/admin/AdminApp"));

type Session = { kind: "loading" } | { kind: "signed-out" } | { kind: "signed-in"; account: Account } | { kind: "failed"; message: string };

/**
 * The whole site but "/" (the home page) and /docs, which the docs build serves. /admin has its own gate and frame;
 * /privacy and /terms open for anyone, signed in or not.
 */
export function App() {
  const path = usePath().replace(/(.)\/$/, "$1");
  if (path === "/admin" || path.startsWith("/admin/")) return <Suspense fallback={<Empty>正在加载…</Empty>}><AdminApp /></Suspense>;
  if (path === paths.privacy || path === paths.terms) return <LegalPage page={path === paths.privacy ? "privacy" : "terms"} />;
  return <Console path={path} />;
}

/**
 * Signed in, every address is the console (/login goes on to 任务); signed out, the sign-in page, which stays on that
 * address once signed in. The session is the server's cookie; this only asks who it is.
 */
function Console({ path }: { path: string }) {
  const [session, setSession] = useState<Session>({ kind: "loading" });
  const check = useCallback(async () => {
    try { setSession({ kind: "signed-in", account: await api<Account>("/api/me") }); }
    catch (error) {
      if (error instanceof ApiFailure && error.status === 401) setSession({ kind: "signed-out" });
      else setSession({ kind: "failed", message: error instanceof Error ? error.message : "无法连接服务器" });
    }
  }, []);
  useEffect(() => { void check(); }, [check]);
  const userId = session.kind === "signed-in" ? session.account.userId : null;
  // Whether to show 后台管理: asked once per signed-in user; anything but 200 means no.
  const [admin, setAdmin] = useState(false);
  useEffect(() => {
    setAdmin(false);
    if (!userId) return;
    let live = true;
    api("/api/admin/me").then(() => { if (live) setAdmin(true); }, () => {});
    return () => { live = false; };
  }, [userId]);
  // "/" is the docs' home page on the site; one reaching the console (the dev server) goes on to 任务, keeping GitHub's
  // ?error= or ?merge= as the home page does.
  const signedIn = session.kind === "signed-in";
  useEffect(() => {
    if (path === "/") navigate(paths.tasks + location.search, { replace: true });
    else if (signedIn && path === paths.login) navigate(paths.tasks, { replace: true });
  }, [signedIn, path]);
  // An offer to merge belongs to the session that asked for it, not to whoever signs in next.
  useEffect(() => {
    if (session.kind === "signed-out" && new URLSearchParams(location.search).has("merge")) history.replaceState(null, "", location.pathname);
  }, [session.kind]);

  if (path === "/") return <Empty>正在加载…</Empty>;
  switch (session.kind) {
    case "loading": return <Empty>正在加载…</Empty>;
    case "failed": return <Empty>{session.message}</Empty>;
    case "signed-out": return <AuthPage signedIn={check} />;
    case "signed-in": return path === paths.login ? <Empty>正在加载…</Empty>
      : <ConsolePage key={session.account.userId} account={session.account} admin={admin} signedOut={() => setSession({ kind: "signed-out" })} />;
  }
}
