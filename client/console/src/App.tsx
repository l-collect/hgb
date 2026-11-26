import { useCallback, useEffect, useState } from "react";
import { api, ApiFailure } from "./api/client";
import type { Account } from "./api/types";
import { Empty } from "./components/ui";
import { AuthPage } from "./features/auth/AuthPage";
import { ConsolePage } from "./features/ConsolePage";
import { HomePage } from "./features/site/HomePage";
import { LegalPage } from "./features/site/LegalPage";
import { navigate, paths, usePath } from "./router";

type Session = { kind: "loading" } | { kind: "signed-out" } | { kind: "signed-in"; account: Account } | { kind: "failed"; message: string };

/**
 * The whole site but /docs and /admin. /privacy and /terms open for anyone. Signed in, every other address is the
 * console ("/" its first page; /login goes back to it); signed out, "/" is the home page and any other address the
 * sign-in page, which stays on that address once signed in. The session is the server's cookie; this only asks who it is.
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
  // GitHub sends a failed sign-in back to "/?error=github": that opens the sign-in page, which says so.
  const [githubFailed] = useState(() => new URLSearchParams(location.search).has("error"));
  const signedIn = session.kind === "signed-in";
  useEffect(() => { if (signedIn && path === paths.login) navigate("/", { replace: true }); }, [signedIn, path]);

  if (path === paths.privacy || path === paths.terms) return <LegalPage page={path === paths.privacy ? "privacy" : "terms"} />;
  const home = path === "/" && !githubFailed;
  switch (session.kind) {
    case "loading": return <Empty>正在加载…</Empty>;
    case "failed": return home ? <HomePage /> : <Empty>{session.message}</Empty>;
    case "signed-out": return home ? <HomePage /> : <AuthPage signedIn={check} />;
    case "signed-in": return path === paths.login ? <Empty>正在加载…</Empty>
      : <ConsolePage key={session.account.userId} account={session.account} signedOut={() => setSession({ kind: "signed-out" })} />;
  }
}
