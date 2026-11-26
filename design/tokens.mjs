// Writes the web theme (console, docs, admin) from design/tokens.json, the one place colours, type, spacing and breakpoints are set.
// The App's Kotlin theme is generated from the same file in the private repository, which has this repository as a submodule.
// Run by `pnpm dev` and `pnpm build`; the outputs are generated and must not be edited by hand.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = (path) => fileURLToPath(new URL(path, import.meta.url));
const tokens = JSON.parse(readFileSync(here("./tokens.json"), "utf8"));
const header = "/* Generated from design/tokens.json by design/tokens.mjs. Do not edit. */\n";

const scale = ["font", "text", "space", "radius", "control"]
  .flatMap((group) => Object.entries(tokens[group]).filter(([key]) => !key.startsWith("$")).map(([key, value]) => `  --${group}-${key}: ${value};`));
const colors = (mode) => Object.entries(tokens.color).map(([key, value]) => `  --color-${key}: ${value[mode]};`);
const dark = colors("dark").map((line) => `  ${line}`).join("\n");

const css = `${header}
:root {
  color-scheme: light;
${colors("light").join("\n")}
${scale.join("\n")}
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    color-scheme: dark;
${dark}
  }
}
:root[data-theme="dark"] {
  color-scheme: dark;
${colors("dark").join("\n")}
}
`;
writeFileSync(here("../client/console/src/theme/tokens.css"), css);
// The home page and docs use the same variables, and so does the admin when it is there.
writeFileSync(here("../client/docs/src/styles/tokens.css"), css);
if (existsSync(here("../client/admin/src/theme"))) writeFileSync(here("../client/admin/src/theme/tokens.css"), css);

const { medium, wide } = tokens.breakpoint;
writeFileSync(here("../client/console/src/theme/tokens.ts"), `${header}
/** Window widths where the layout changes: below medium is narrow (bottom bar), from wide on the full sidebar. */
export const BREAKPOINT = { medium: ${medium}, wide: ${wide} } as const;
`);
