#!/usr/bin/env bash
# Fetch api.drupal.org topic/groups pages for Drupal 11.x using Playwright.
#
# api.drupal.org is a JavaScript SPA — curl returns only a ~3KB shell page
# with no DOM content, so the original Track A (curl) approach yielded 0 results.
#
# This script delegates to a TypeScript Playwright helper that runs a headless
# Chromium browser, navigates the groups index, and saves each rendered topic
# page as a .html file (named after the group slug, e.g. hooks.html) in
# data/sources/api-drupal-org/.  Files are NOT prefixed with _ so the parser
# at etl/parse-api-drupal-org.ts picks them up automatically.
#
# Usage: bash scripts/fetch-api-drupal-org.sh
#   or:  npm run fetch:api-drupal-org

set -euo pipefail

DEST="data/sources/api-drupal-org"

mkdir -p "$DEST"

echo "=== Fetching api.drupal.org groups/topics for Drupal 11.x ==="
echo "  Strategy : Playwright (headless Chromium) — SPA rendering required"
echo "  Target   : https://api.drupal.org/api/drupal/groups/11.x"
echo "  Output   : $DEST/"
echo ""

npx tsx scripts/fetch-api-drupal-org-playwright.ts
