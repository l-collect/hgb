// @ts-check
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import { repoUrl } from "./src/instance.mjs";

// The docs alone, under "/docs"; the console (with the home page, privacy and terms) is a separate app at "/" (C42, C43).
export default defineConfig({
  base: "/docs",
  // Built under dist/docs, so a host serving dist (Vercel passes the path on as it is) finds the /docs/... it is asked for.
  outDir: "./dist/docs",
  server: { port: 4321, host: "127.0.0.1" },
  devToolbar: { enabled: false },
  // Only SVGs are used, so images are served as they are.
  image: { service: { entrypoint: "astro/assets/services/noop" } },
  integrations: [
    starlight({
      title: "护肝宝文档",
      logo: { light: "./src/assets/logo-light.svg", dark: "./src/assets/logo-dark.svg", replacesTitle: false },
      favicon: "/favicon.svg",
      defaultLocale: "root",
      locales: { root: { label: "简体中文", lang: "zh-CN" } },
      social: [{ icon: "github", label: "GitHub", href: repoUrl }],
      editLink: { baseUrl: `${repoUrl}/edit/main/client/docs/` },
      lastUpdated: true,
      customCss: ["./src/styles/tokens.css", "./src/styles/starlight.css"],
      components: { SiteTitle: "./src/components/DocsTitle.astro" },
      sidebar: [
        { label: "开始使用", items: [{ autogenerate: { directory: "start" } }] },
        { label: "日常使用", items: [{ autogenerate: { directory: "use" } }] },
        { label: "游戏", items: [{ autogenerate: { directory: "games" } }] },
        { label: "开发者", items: [{ autogenerate: { directory: "dev" } }] },
      ],
    }),
  ],
});
