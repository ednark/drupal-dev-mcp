#!/usr/bin/env bash

set -euo pipefail

DEST_DIR="data/sources/drupal-developer-guides"
URLS_FILE_PRIMARY="${DEST_DIR}/urls.txt"
URLS_FILE_FALLBACK="data/sources/developer-guides/urls.txt"

mkdir -p "$DEST_DIR"

URLS_FILE=""
if [ -f "$URLS_FILE_PRIMARY" ]; then
  URLS_FILE="$URLS_FILE_PRIMARY"
elif [ -f "$URLS_FILE_FALLBACK" ]; then
  URLS_FILE="$URLS_FILE_FALLBACK"
else
  echo "ERROR: URL list file not found. Expected one of:"
  echo "  - $URLS_FILE_PRIMARY"
  echo "  - $URLS_FILE_FALLBACK"
  exit 1
fi

npx ts-node src/fetcher/index.ts batch "$URLS_FILE" \
  --output-dir "$DEST_DIR" \
  --skip-existing \
  --filename-pattern url \
  --strategy multi-tier || {
    echo "⚠ Playwright/multi-tier fetch failed. Falling back to smart curl fetcher..."
    bash scripts/fetch-developer-guides-smart.sh
  }
