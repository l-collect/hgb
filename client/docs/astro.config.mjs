// @ts-check
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { repoUrl, siteUrl } from "./src/instance.mjs";

/**
 * The site's home page is src/pages/home.astro, built as /docs/home/ like any page under the base; once the build is
 * done it moves to dist/index.html, the site's "/" (vercel.json sends "/" to this build too), and the sitemap lists it
 * there. robots.txt at the site's root names the sitemap.
 * @type {import("astro").AstroIntegration}
 */
const homeAtRoot = {
  name: "home-at-root",
  hooks: {
    "astro:build:done": ({ dir }) => {
      const out = fileURLToPath(dir);
      const root = fileURLToPath(new URL("..", dir));
      renameSync(`${out}home/index.html`, `${root}index.html`);
      rmSync(`${out}home`, { recursive: true });
      // @astrojs/sitemap (added by Starlight) has written its files by now.
      const sitemap = `${out}sitemap-0.xml`;
      if (existsSync(sitemap)) writeFileSync(sitemap, readFileSync(sitemap, "utf8").replace(`<loc>${siteUrl}/docs/home/</loc>`, `<loc>${siteUrl}/</loc>`));
      writeFileSync(`${root}robots.txt`, `User-agent: *\nDisallow: /admin\nSitemap: ${siteUrl}/docs/sitemap-index.xml\n`);
    },
  },
};

// The docs under "/docs" and the home page at "/"; the console (privacy and terms included) and /admin are the
// console's (C42, C43).
export default defineConfig({
  site: siteUrl,
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
    homeAtRoot,
  ],
});
