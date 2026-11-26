import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { api, ApiFailure } from "./api/client";
import type { Account } from "./api/types";
import { ErrorCard, Loading } from "./components/ui";
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
  if (path === "/admin" || path.startsWith("/admin/")) return <Suspense fallback={<Loading />}><AdminApp /></Suspense>;
  if (path === paths.privacy || path === paths.terms) return <LegalPage page={path === paths.privacy ? "privacy" : "terms"} />;
  return <Console path={path} />;
}

/**
 * Where to go once signed in, when the sign-in was asked for by another page (/admin's 去登录): /login?next=/admin, kept
 * in this tab too so a GitHub sign-in (which comes back to "/") still finds it. Only a path on this site.
 */
const NEXT = "hgb.login.next";
const safeNext = (value: string | null) => value && value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/login") ? value : null;
export function rememberNext(path: string) { try { sessionStorage.setItem(NEXT, path); } catch { /* the address still has it */ } }
function takeNext(): string | null {
  const asked = safeNext(new URLSearchParams(location.search).get("next"));
  let kept: string | null = null;
  try { kept = safeNext(sessionStorage.getItem(NEXT)); sessionStorage.removeItem(NEXT); } catch { /* none kept */ }
  return asked ?? kept;
}

/**
 * Signed in, every address is the console (/login goes on to 任务, or back to the page that sent there); signed out,
 * the sign-in page, which stays on that address once signed in. The session is the server's cookie; this only asks
 * who it is.
 */
function Console({ path }: { path: string }) {
  const [session, setSession] = useState<Session>({ kind: "loading" });
  const check = useCallback(async () => {
    try { setSession({ kind: "signed-in", account: await api<Account>("/api/me") }); }
    catch (error) {
      if (error instanceof ApiFailure && error.status === 401) setSession({ kind: "signed-out" });
      else setSession({ kind: "failed", message: error instanceof ApiFailure && error.status !== 0 ? error.message : "连不上服务器" });
    }
  }, []);
  useEffect(() => { void check(); }, [check]);
  // No answer for about five seconds: say so, with 重试.
  const [slow, setSlow] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    setSlow(false);
    if (session.kind !== "loading") return;
    const timer = window.setTimeout(() => setSlow(true), 5000);
    return () => window.clearTimeout(timer);
  }, [session.kind, attempt]);
  const retry = () => { setSession({ kind: "loading" }); setAttempt((n) => n + 1); void check(); };
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
    if (path === "/") { navigate(paths.tasks + location.search, { replace: true }); return; }
    if (!signedIn) return;
    const next = takeNext();
    if (next) navigate(next, { replace: true });
    else if (path === paths.login) navigate(paths.tasks, { replace: true });
  }, [signedIn, path]);
  // Asked to sign in for another page: remember it before the sign-in page (or GitHub) takes over the address.
  useEffect(() => {
    if (session.kind !== "signed-out") return;
    const asked = safeNext(new URLSearchParams(location.search).get("next"));
    if (asked) rememberNext(asked);
  }, [session.kind]);
  // An offer to merge belongs to the session that asked for it, not to whoever signs in next.
  useEffect(() => {
    if (session.kind === "signed-out" && new URLSearchParams(location.search).has("merge")) history.replaceState(null, "", location.pathname);
  }, [session.kind]);

  if (path === "/") return <Loading />;
  switch (session.kind) {
    case "loading": return slow ? <div style={{ padding: 16 }}><ErrorCard text="连不上服务器" retry={retry} /></div> : <Loading />;
    case "failed": return <div style={{ padding: 16 }}><ErrorCard text={session.message} retry={retry} /></div>;
    case "signed-out": return <AuthPage signedIn={check} />;
    case "signed-in": return path === paths.login ? <Loading />
      : <ConsolePage key={session.account.userId} account={session.account} admin={admin} signedOut={() => setSession({ kind: "signed-out" })} />;
  }
}
