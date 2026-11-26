import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// The admin is its own site, served under /admin; like the console it talks to the server only through /api. In
// development Vite forwards /api to the local server, so the page and the API share one origin and the session cookie
// works as in production.
const server = process.env.YYS_API ?? "http://127.0.0.1:8787";
const repo = fileURLToPath(new URL("../..", import.meta.url));

export default defineConfig(({ command }) => {
  // Where a built admin calls the API: VITE_API_ORIGIN when set (empty means this site's own /api, as
  // scripts/build-sites.sh may ask), else HGB_API_URL, else config/instance.json.
  if (command === "build" && process.env.VITE_API_ORIGIN === undefined) {
    const instance = JSON.parse(readFileSync(new URL("../../config/instance.json", import.meta.url), "utf8"));
    process.env.VITE_API_ORIGIN = process.env.HGB_API_URL || instance.apiUrl;
  }
  // vercel.json's Content-Security-Policy for /admin names the API origin in connect-src, written out as
  // config/instance.json's apiUrl (JSON has no comments, so it is explained here). On Vercel, a build calling another
  // origin would be blocked by that policy in the browser: stop the build instead, so the two are changed together.
  const origin = (process.env.VITE_API_ORIGIN ?? "").replace(/\/$/, "");
  if (command === "build" && origin && process.env.VERCEL) {
    type Rule = { headers: { key: string; value: string }[] };
    const vercel = JSON.parse(readFileSync(new URL("../../vercel.json", import.meta.url), "utf8"));
    const policy = (vercel.services.admin.headers as Rule[]).flatMap((rule) => rule.headers).find((header) => header.key === "Content-Security-Policy")?.value ?? "";
    const connect = policy.split(";").map((part) => part.trim()).find((part) => part.startsWith("connect-src"))?.split(/\s+/) ?? [];
    if (!connect.includes(origin)) throw new Error(`vercel.json 里 /admin 的 Content-Security-Policy connect-src 没有 ${origin}，请一起改`);
  }
  return {
    plugins: [react()],
    base: "/admin/",
    // The pages are built from the console's components (../console/src); React must still be this project's one copy.
    resolve: { dedupe: ["react", "react-dom"] },
    server: { port: 5174, proxy: { "/api": { target: server, changeOrigin: false } }, fs: { allow: [repo] } },
    // Built under dist/admin, so a host serving dist sees the same /admin/... paths the pages ask for.
    build: { outDir: "dist/admin", sourcemap: true },
  };
});
