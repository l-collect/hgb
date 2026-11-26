#!/usr/bin/env bash
# Builds the home page and docs (client/docs) and the console (client/console) into one folder for a static host other
# than Vercel (Vercel builds them as services, see vercel.json):
# the site at "/", the console under "/console". VITE_API_ORIGIN, when set, is where the console calls the API
# (for example https://api-hgb.l2cl.link); left empty, the console calls this site's own /api.
set -euo pipefail
cd "$(dirname "$0")/.."
out="${OUT_DIR:-dist-sites}"

pnpm --dir client/console install --frozen-lockfile
pnpm --dir client/docs install --frozen-lockfile
VITE_API_ORIGIN="${VITE_API_ORIGIN:-}" pnpm --dir client/console build
pnpm --dir client/docs build

rm -rf "$out"
mkdir -p "$out/console"
cp -R client/docs/dist/. "$out/"
cp -R client/console/dist/console/. "$out/console/"
# Source maps stay out of what is served.
find "$out" -name '*.map' -delete
echo "built into $out"
