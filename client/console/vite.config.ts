import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";

// The console is its own site; it talks to the server only through /api. In development Vite forwards /api to the
// local server, so the page and the API share one origin and the session cookie works as in production, where a
// reverse proxy or CDN routes /api the same way.
const server = process.env.YYS_API ?? "http://127.0.0.1:8787";

// This deployment's code repository: HGB_CODE_REPO, else the repository Vercel is building (a fork's own project),
// else config/instance.json.
const instance = JSON.parse(readFileSync(new URL("../../config/instance.json", import.meta.url), "utf8"));
const vercelRepo = process.env.VERCEL_GIT_REPO_OWNER && process.env.VERCEL_GIT_REPO_SLUG
  ? `${process.env.VERCEL_GIT_REPO_OWNER}/${process.env.VERCEL_GIT_REPO_SLUG}` : "";
process.env.VITE_CODE_REPO = process.env.HGB_CODE_REPO || vercelRepo || instance.codeRepo;

export default defineConfig(({ command }) => {
  // Where a built console calls the API: VITE_API_ORIGIN when set (empty means this site's own /api, as
  // scripts/build-sites.sh may ask), else HGB_API_URL, else config/instance.json.
  if (command === "build" && process.env.VITE_API_ORIGIN === undefined) process.env.VITE_API_ORIGIN = process.env.HGB_API_URL || instance.apiUrl;
  // vercel.json's Content-Security-Policy for /admin names the API origin in connect-src, written out as
  // config/instance.json's apiUrl (JSON has no comments, so it is explained here). On Vercel, a build calling another
  // origin would be blocked by that policy in the browser: stop the build instead, so the two are changed together.
  const origin = (process.env.VITE_API_ORIGIN ?? "").replace(/\/$/, "");
  if (command === "build" && origin && process.env.VERCEL) {
    type Rule = { source: string; headers: { key: string; value: string }[] };
    const vercel = JSON.parse(readFileSync(new URL("../../vercel.json", import.meta.url), "utf8"));
    const rules = (vercel.services.console.headers as Rule[]).filter((rule) => rule.source.startsWith("/admin"));
    const policies = rules.flatMap((rule) => rule.headers).filter((header) => header.key === "Content-Security-Policy");
    for (const policy of policies) {
      const connect = policy.value.split(";").map((part) => part.trim()).find((part) => part.startsWith("connect-src"))?.split(/\s+/) ?? [];
      if (!connect.includes(origin)) throw new Error(`vercel.json 里 /admin 的 Content-Security-Policy connect-src 没有 ${origin}，请一起改`);
    }
  }
  return {
    plugins: [react()],
    // The console is the whole site but "/" (the home page) and /docs, which are the docs build's (C42); /admin is
    // part of it, as a bundle of its own.
    base: "/",
    server: { port: 5173, proxy: { "/api": { target: server, changeOrigin: false } } },
    build: { outDir: "dist", sourcemap: true },
  };
});
