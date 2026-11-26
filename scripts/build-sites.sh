#!/usr/bin/env bash
# Builds the console with the home page, privacy and terms (client/console), the docs (client/docs) and the admin
# (client/admin) into one folder for a static host other than Vercel (Vercel builds them as services, see vercel.json):
# the console at "/", the docs under "/docs", the admin under "/admin". The host must answer an address with no file
# under /admin with /admin/index.html and any other address outside /docs (except /assets/...) with /index.html.
# VITE_API_ORIGIN, when set, is where the console and the admin call the API (for example https://api-hgb.l2cl.link);
# left empty, they call this site's own /api.
set -euo pipefail
cd "$(dirname "$0")/.."
out="${OUT_DIR:-dist-sites}"

pnpm --dir client/console install --frozen-lockfile
pnpm --dir client/admin install --frozen-lockfile
pnpm --dir client/docs install --frozen-lockfile
VITE_API_ORIGIN="${VITE_API_ORIGIN:-}" pnpm --dir client/console build
VITE_API_ORIGIN="${VITE_API_ORIGIN:-}" pnpm --dir client/admin build
pnpm --dir client/docs build

rm -rf "$out"
mkdir -p "$out/docs" "$out/admin"
cp -R client/console/dist/. "$out/"
cp -R client/docs/dist/docs/. "$out/docs/"
cp -R client/admin/dist/admin/. "$out/admin/"
# Source maps stay out of what is served.
find "$out" -name '*.map' -delete
echo "built into $out"
