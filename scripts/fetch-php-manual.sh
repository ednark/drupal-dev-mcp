#!/usr/bin/env bash
set -euo pipefail

DEST_DIR="data/sources/php-manual"
GZ_PATH="$DEST_DIR/php_manual_en.html.gz"
HTML_PATH="$DEST_DIR/php_manual_en.html"
URL="https://www.php.net/distributions/manual/php_manual_en.html.gz"
MAX_AGE_DAYS=30

mkdir -p "$DEST_DIR"

write_fallback() {
  cat > "$DEST_DIR/README.md" <<'EOF'
# PHP Manual (Fetch Fallback)

The PHP manual download failed in this environment.

Expected source URL:
- https://www.php.net/distributions/manual/php_manual_en.html.gz
EOF
}

if [ -f "$HTML_PATH" ]; then
  now_epoch=$(date +%s)
  file_epoch=$(stat -f %m "$HTML_PATH")
  age_days=$(( (now_epoch - file_epoch) / 86400 ))

  if [ "$age_days" -lt "$MAX_AGE_DAYS" ]; then
    echo "Existing PHP manual is recent (${age_days} days old); skipping download."
    exit 0
  fi
fi

echo "Downloading PHP manual..."
if curl -L -o "$GZ_PATH" "$URL"; then
  gunzip -f "$GZ_PATH"
  echo "PHP manual ready at $HTML_PATH"
  exit 0
fi

echo "Warning: PHP manual download failed; writing fallback README"
write_fallback

