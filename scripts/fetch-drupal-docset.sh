#!/usr/bin/env bash
set -euo pipefail

DEST_DIR="data/sources/Drupal.docset"
INDEX_PATH="$DEST_DIR/Contents/Resources/docSet.dsidx"
DOCSET_URL="${DRUPAL_DOCSET_URL:-https://kapeli.com/feeds/Drupal.tgz}"
MAX_AGE_DAYS=30

echo "=== Drupal Docset Fetch ==="
echo "Destination: $DEST_DIR"
echo "Source URL: $DOCSET_URL"

if [ -f "$INDEX_PATH" ]; then
  now_epoch=$(date +%s)
  file_epoch=$(stat -f %m "$INDEX_PATH")
  age_days=$(( (now_epoch - file_epoch) / 86400 ))

  if [ "$age_days" -lt "$MAX_AGE_DAYS" ]; then
    echo "Existing Drupal docset index is recent (${age_days} days old); skipping download."
    exit 0
  fi

  echo "Existing Drupal docset index is stale (${age_days} days old); refreshing."
fi

tmp_dir="$(mktemp -d)"
archive_path="$tmp_dir/Drupal.tgz"
extract_dir="$tmp_dir/extracted"

cleanup() {
  rm -rf "$tmp_dir"
}
trap cleanup EXIT

mkdir -p "$extract_dir"

echo "Downloading Drupal docset archive..."
curl -fL "$DOCSET_URL" -o "$archive_path"

echo "Extracting archive..."
tar -xzf "$archive_path" -C "$extract_dir"

extracted_docset="$(find "$extract_dir" -type d -name 'Drupal.docset' -print -quit)"
if [ -z "$extracted_docset" ]; then
  echo "❌ Could not find Drupal.docset in extracted archive."
  exit 1
fi

if [ ! -f "$extracted_docset/Contents/Resources/docSet.dsidx" ]; then
  echo "❌ Extracted docset is missing Contents/Resources/docSet.dsidx"
  exit 1
fi

echo "Installing docset to $DEST_DIR..."
mkdir -p "data/sources"
rm -rf "$DEST_DIR"
mv "$extracted_docset" "$DEST_DIR"

if [ ! -f "$INDEX_PATH" ]; then
  echo "❌ Installed docset is missing $INDEX_PATH"
  exit 1
fi

echo "✅ Drupal docset ready at $DEST_DIR"
