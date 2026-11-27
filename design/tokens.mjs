// Writes the web theme (console, docs) from design/tokens.json, the one place colours, type, spacing and breakpoints are set.
// The App's Kotlin theme is generated from the same file in the private repository, which has this repository as a submodule.
// Run by `pnpm dev` and `pnpm build`; the outputs are generated and must not be edited by hand.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const here = (path) => fileURLToPath(new URL(path, import.meta.url));
const tokens = JSON.parse(readFileSync(here("./tokens.json"), "utf8"));
const header = "/* Generated from design/tokens.json by design/tokens.mjs. Do not edit. */\n";

const scale = ["font", "text", "space", "radius", "control", "motion"]
  .flatMap((group) => Object.entries(tokens[group]).filter(([key]) => !key.startsWith("$")).map(([key, value]) => `  --${group}-${key}: ${value};`));
const colors = (mode) => [
  ...Object.entries(tokens.color).map(([key, value]) => `  --color-${key}: ${value[mode]};`),
  ...Object.entries(tokens.shadow).filter(([key]) => !key.startsWith("$")).map(([key, value]) => `  --shadow-${key}: ${value[mode]};`),
];
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
// The docs use the same variables.
writeFileSync(here("../client/docs/src/styles/tokens.css"), css);

const { medium, wide } = tokens.breakpoint;
writeFileSync(here("../client/console/src/theme/tokens.ts"), `${header}
/** Window widths where the layout changes: below medium is narrow (bottom bar), from wide lists and details side by side. */
export const BREAKPOINT = { medium: ${medium}, wide: ${wide} } as const;
`);
