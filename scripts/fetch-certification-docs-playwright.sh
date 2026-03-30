#!/usr/bin/env bash

set -euo pipefail

DEST_DIR="data/sources/certification"
URLS_FILE_PRIMARY="${DEST_DIR}/urls.txt"
URLS_FILE_SECONDARY="${DEST_DIR}/extracted-links.txt"
URLS_FILE_FALLBACK="${DEST_DIR}/new-links.txt"

mkdir -p "$DEST_DIR"

URLS_FILE=""
if [ -f "$URLS_FILE_PRIMARY" ]; then
  URLS_FILE="$URLS_FILE_PRIMARY"
elif [ -f "$URLS_FILE_SECONDARY" ]; then
  URLS_FILE="$URLS_FILE_SECONDARY"
elif [ -f "$URLS_FILE_FALLBACK" ]; then
  URLS_FILE="$URLS_FILE_FALLBACK"
else
  echo "ERROR: URL list file not found. Expected one of:"
  echo "  - $URLS_FILE_PRIMARY"
  echo "  - $URLS_FILE_SECONDARY"
  echo "  - $URLS_FILE_FALLBACK"
  exit 1
fi

npx ts-node src/fetcher/index.ts batch "$URLS_FILE" \
  --output-dir "$DEST_DIR" \
  --skip-existing \
  --filename-pattern url

