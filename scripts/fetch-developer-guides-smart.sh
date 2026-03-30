#!/usr/bin/env bash

set -euo pipefail

DEST_DIR="data/sources/drupal-developer-guides"
URLS_FILE="${DEST_DIR}/urls.txt"

if [ ! -f "$URLS_FILE" ]; then
  echo "ERROR: URL list not found at $URLS_FILE"
  exit 1
fi

mkdir -p "$DEST_DIR"

HAS_PANDOC=0
if command -v pandoc >/dev/null 2>&1; then
  HAS_PANDOC=1
fi

slug_from_url() {
  local url="$1"
  printf '%s' "$url" | sed 's#https\?://##' | sed 's#[/?=&:]#-#g' | sed 's#-\{2,\}#-#g' | sed 's#-$##'
}

convert_html_to_markdown() {
  local html_file="$1"
  local md_file="$2"
  local source_url="$3"

  if [ "$HAS_PANDOC" -eq 1 ]; then
    if pandoc -f html -t gfm --wrap=none -o "$md_file" "$html_file"; then
      {
        echo
        echo "---"
        echo ""
        echo "Source: ${source_url}"
      } >> "$md_file"
      return 0
    fi
  fi

  node -e '
const fs = require("fs");
const htmlPath = process.argv[1];
const mdPath = process.argv[2];
const sourceUrl = process.argv[3];
const html = fs.readFileSync(htmlPath, "utf8");
const cleaned = html
  .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
  .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
  .replace(/<h1[^>]*>(.*?)<\/h1>/gi, "\n# $1\n")
  .replace(/<h2[^>]*>(.*?)<\/h2>/gi, "\n## $1\n")
  .replace(/<h3[^>]*>(.*?)<\/h3>/gi, "\n### $1\n")
  .replace(/<li[^>]*>(.*?)<\/li>/gi, "\n- $1")
  .replace(/<a[^>]*href=["\x27]([^"\x27]+)["\x27][^>]*>(.*?)<\/a>/gi, "[$2]($1)")
  .replace(/<br\s*\/?>/gi, "\n")
  .replace(/<\/p>/gi, "\n\n")
  .replace(/<[^>]+>/g, " ")
  .replace(/&nbsp;/g, " ")
  .replace(/&amp;/g, "&")
  .replace(/&lt;/g, "<")
  .replace(/&gt;/g, ">")
  .replace(/\r/g, "")
  .replace(/\n{3,}/g, "\n\n")
  .replace(/[ \t]{2,}/g, " ")
  .trim();
const finalMd = `${cleaned}\n\n---\n\nSource: ${sourceUrl}\n`;
fs.writeFileSync(mdPath, finalMd, "utf8");
' "$html_file" "$md_file" "$source_url"
}

is_blocked_html() {
  local html_file="$1"
  grep -Eqi 'access denied|you have been blocked|captcha|attention required|cloudflare|perimeterx' "$html_file"
}

TOTAL=0
OK=0
SKIPPED=0
FAILED=0

while IFS= read -r url; do
  url="$(printf '%s' "$url" | xargs)"
  if [ -z "$url" ] || [ "${url#\#}" != "$url" ]; then
    continue
  fi

  TOTAL=$((TOTAL + 1))
  slug="$(slug_from_url "$url")"
  html_file="$DEST_DIR/${slug}.html"
  md_file="$DEST_DIR/${slug}.md"

  if [ -s "$md_file" ]; then
    echo "[$TOTAL] SKIP $url"
    SKIPPED=$((SKIPPED + 1))
    continue
  fi

  echo "[$TOTAL] FETCH $url"
  if curl -s -L \
    -H 'User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36' \
    -H 'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8' \
    -H 'Accept-Language: en-US,en;q=0.9' \
    -H 'Accept-Encoding: gzip, deflate, br' \
    -H 'Cache-Control: max-age=0' \
    -H 'Sec-Fetch-Dest: document' \
    -H 'Sec-Fetch-Mode: navigate' \
    -H 'Sec-Fetch-Site: none' \
    -H 'Sec-Fetch-User: ?1' \
    -H 'Upgrade-Insecure-Requests: 1' \
    -H 'sec-ch-ua: "Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"' \
    -H 'sec-ch-ua-mobile: ?0' \
    -H 'sec-ch-ua-platform: "macOS"' \
    -H 'Referer: https://www.drupal.org/docs' \
    --compressed \
    "$url" > "$html_file"; then
    if is_blocked_html "$html_file"; then
      echo "[$TOTAL] FAIL blocked response: $url"
      rm -f "$html_file"
      FAILED=$((FAILED + 1))
    elif convert_html_to_markdown "$html_file" "$md_file" "$url"; then
      rm -f "$html_file"
      echo "[$TOTAL] OK   $md_file"
      OK=$((OK + 1))
    else
      echo "[$TOTAL] FAIL conversion error: $url"
      rm -f "$html_file"
      FAILED=$((FAILED + 1))
    fi
  else
    echo "[$TOTAL] FAIL fetch error: $url"
    rm -f "$html_file"
    FAILED=$((FAILED + 1))
  fi

  sleep "$(( (RANDOM % 8) + 3 ))"
done < "$URLS_FILE"

echo "Done. total=$TOTAL ok=$OK skipped=$SKIPPED failed=$FAILED"

