#!/usr/bin/env bash
# Builds the console (client/console, with /admin, privacy and terms) and the docs (client/docs, with the home page)
# into one folder for a static host other than Vercel (Vercel builds them as services, see vercel.json): the home page
# at "/" (index.html), the docs under "/docs", and the console's files beside them. The host must answer any address
# outside /docs with no file of its own (except /assets/...) with console.html, the console's page; "/" is the home
# page's index.html.
# VITE_API_ORIGIN, when set, is where the console and the home page call the API (for example
# https://api-hgb.l2cl.link); left empty, they call this site's own /api.
set -euo pipefail
cd "$(dirname "$0")/.."
out="${OUT_DIR:-dist-sites}"

pnpm --dir client/console install --frozen-lockfile
pnpm --dir client/docs install --frozen-lockfile
VITE_API_ORIGIN="${VITE_API_ORIGIN:-}" pnpm --dir client/console build
VITE_API_ORIGIN="${VITE_API_ORIGIN:-}" pnpm --dir client/docs build

rm -rf "$out"
mkdir -p "$out"
cp -R client/console/dist/. "$out/"
# The console's page would be "/" too: it is console.html, and the home page is index.html.
mv "$out/index.html" "$out/console.html"
cp -R client/docs/dist/. "$out/"
# Source maps stay out of what is served.
find "$out" -name '*.map' -delete
echo "built into $out"
