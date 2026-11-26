import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiFailure } from "./api/client";
import type { Account } from "./api/types";
import { Empty } from "./components/ui";
import { orAlert } from "./components/useAction";
import { AuthPage } from "./features/auth/AuthPage";
import { ConsolePage } from "./features/ConsolePage";
import { HomePage } from "./features/site/HomePage";
import { LegalPage } from "./features/site/LegalPage";
import type { SiteSession } from "./features/site/SiteAccount";
import { navigate, paths, usePath } from "./router";

type Session = { kind: "loading" } | { kind: "signed-out" } | { kind: "signed-in"; account: Account } | { kind: "failed"; message: string };

/**
 * The whole site but /docs and /admin. "/" (the home page), /privacy and /terms open for anyone, signed in or not.
 * Signed in, every other address is the console (/login goes on to 任务); signed out, the sign-in page, which stays on
 * that address once signed in. The session is the server's cookie; this only asks who it is.
 */
export function App() {
  const path = usePath().replace(/(.)\/$/, "$1");
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
  // GitHub comes back to "/": "?error=github" after a failed sign-in (the sign-in page says so) or a failed link, and
  // "?merge=" to offer a merge. Signed in, both belong to the console, which reads them; once, on arrival.
  const [githubFailed] = useState(() => new URLSearchParams(location.search).has("error"));
  const fromGitHub = useRef(/[?&](error|merge)=/.test(location.search));
  const signedOutOnce = useRef(false);
  if (session.kind === "signed-out") signedOutOnce.current = true;
  const signedIn = session.kind === "signed-in";
  const leaveHome = signedIn && path === "/" && fromGitHub.current;
  useEffect(() => {
    if (!signedIn) return;
    if (path === paths.login) navigate(paths.tasks, { replace: true });
    else if (leaveHome) { fromGitHub.current = false; navigate(paths.tasks + (signedOutOnce.current ? "" : location.search), { replace: true }); }
  }, [signedIn, path, leaveHome]);

  const site: SiteSession = {
    account: session.kind === "loading" ? undefined : session.kind === "signed-in" ? session.account : null,
    admin,
    signOut: () => orAlert(async () => { await api("/api/auth/logout", { method: "POST", body: {} }); setSession({ kind: "signed-out" }); await check(); }),
  };
  if (path === paths.privacy || path === paths.terms) return <LegalPage page={path === paths.privacy ? "privacy" : "terms"} site={site} />;
  if (leaveHome) return <Empty>正在加载…</Empty>;
  const home = path === "/" && !(githubFailed && session.kind !== "signed-in");
  if (home) return <HomePage site={site} />;
  switch (session.kind) {
    case "loading": return <Empty>正在加载…</Empty>;
    case "failed": return <Empty>{session.message}</Empty>;
    case "signed-out": return <AuthPage signedIn={check} />;
    case "signed-in": return path === paths.login ? <Empty>正在加载…</Empty>
      : <ConsolePage key={session.account.userId} account={session.account} admin={admin} signedOut={() => setSession({ kind: "signed-out" })} />;
  }
}
