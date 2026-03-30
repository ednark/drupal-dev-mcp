#!/usr/bin/env bash

set -euo pipefail

DEST_DIR="data/sources/certification"
FETCHED_LINKS_FILE="$DEST_DIR/fetched-links.txt"
FAILED_LINKS_FILE="$DEST_DIR/failed-links.txt"
EXTRACTED_LINKS_FILE="$DEST_DIR/extracted-links.txt"
NEW_LINKS_FILE="$DEST_DIR/new-links.txt"

USER_AGENT='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
REQUEST_SLEEP_SECONDS="0.5"
MIN_BYTES=2000
PLAYWRIGHT_TIMEOUT_MS=90000
ENABLE_PLAYWRIGHT_FALLBACK="${ENABLE_PLAYWRIGHT_FALLBACK:-0}"
PLAYWRIGHT_HEADLESS="${PLAYWRIGHT_HEADLESS:-1}"
PLAYWRIGHT_MAX_RETRIES="${PLAYWRIGHT_MAX_RETRIES:-2}"

mkdir -p "$DEST_DIR"

TMP_DIR="$(mktemp -d)"
cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

URLS_FILE="$TMP_DIR/certification-urls.txt"

if ! command -v pandoc >/dev/null 2>&1; then
  echo "ERROR: pandoc is required for HTML -> Markdown conversion."
  exit 1
fi

url_to_filename_base() {
  local url="$1"
  printf '%s' "$url" \
    | sed -E 's#://#-#' \
    | sed -E 's#/#-#g' \
    | sed -E 's#-+#-#g' \
    | sed -E 's#-$##'
}

invalid_content() {
  local file="$1"
  [ -s "$file" ] || return 0
  grep -Eqi 'Access to this page has been denied|PerimeterX|you have been blocked|Wayback Machine has not archived|404 Not Found|Error [45][0-9]{2}' "$file"
}

fetch_with_playwright() {
  local url="$1"
  local output_html="$2"

  # Uses local devDependency playwright (installed via npm).
  node --input-type=module - "$url" "$output_html" "$PLAYWRIGHT_TIMEOUT_MS" "$PLAYWRIGHT_HEADLESS" "$USER_AGENT" "$PLAYWRIGHT_MAX_RETRIES" <<'NODE'
import fs from 'node:fs';

const url = process.argv[2];
const output = process.argv[3];
const timeout = Number(process.argv[4] || 90000);
const headless = process.argv[5] !== '0';
const userAgent = process.argv[6] || 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';
const maxRetries = Number(process.argv[7] || 2);

try {
  const playwright = await import('playwright');
  const browser = await playwright.chromium.launch({
    headless,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-default-browser-check',
      '--disable-dev-shm-usage',
      '--disable-features=TranslateUI',
    ],
  });

  const context = await browser.newContext({
    userAgent,
    viewport: { width: 1536, height: 960 },
    locale: 'en-US',
    timezoneId: 'America/New_York',
    colorScheme: 'light',
    extraHTTPHeaders: {
      'Accept-Language': 'en-US,en;q=0.9',
      'Upgrade-Insecure-Requests': '1',
      'DNT': '1',
    },
  });

  const page = await context.newPage();

  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined,
    });
  });

  let lastError = null;
  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout });

      // Human-like pacing + let hydrated content settle.
      await page.waitForTimeout(400 + Math.floor(Math.random() * 500));
      await page.mouse.move(200, 150);
      await page.mouse.wheel(0, 600);
      await page.waitForTimeout(350 + Math.floor(Math.random() * 600));

      try {
        await page.waitForLoadState('networkidle', { timeout: Math.floor(timeout / 2) });
      } catch {
        // Continue with partially loaded DOM.
      }

      // Prefer article/main content when available.
      const articleHtml = await page.evaluate(() => {
        const article = document.querySelector('article') || document.querySelector('main') || document.querySelector('[role="main"]');
        return article ? article.outerHTML : '';
      });

      const html = articleHtml && articleHtml.length > 500 ? articleHtml : await page.content();
      fs.writeFileSync(output, html, 'utf8');
      lastError = null;
      break;
    } catch (error) {
      lastError = error;
      if (attempt < maxRetries) {
        await page.waitForTimeout(800 * attempt);
      }
    }
  }

  if (lastError) {
    throw lastError;
  }

  await context.close();
  await browser.close();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
NODE
}

try_playwright_fallback() {
  local url="$1"
  local pw_html="$2"
  local target_md="$3"

  if [ "$ENABLE_PLAYWRIGHT_FALLBACK" != "1" ]; then
    return 1
  fi

  if fetch_with_playwright "$url" "$pw_html" && convert_and_validate_html_to_markdown "$url" "$pw_html" "$target_md"; then
    return 0
  fi

  return 1
}

convert_and_validate_html_to_markdown() {
  local url="$1"
  local html_in="$2"
  local target_md="$3"

  if invalid_content "$html_in"; then
    return 1
  fi

  if ! pandoc --from=html --to=markdown "$html_in" -o "$target_md" >/dev/null 2>&1; then
    return 1
  fi

  if [ ! -s "$target_md" ] || [ "$(wc -c < "$target_md" | tr -d ' ')" -lt "$MIN_BYTES" ] || invalid_content "$target_md"; then
    rm -f "$target_md"
    return 1
  fi

  return 0
}

extract_cdx_timestamp() {
  local cdx_file="$1"
  python3 - "$cdx_file" <<'PY'
import json
import sys

path = sys.argv[1]
try:
    with open(path, 'r', encoding='utf-8') as fh:
        data = json.load(fh)
except Exception:
    print("")
    sys.exit(0)

if not isinstance(data, list) or len(data) < 2:
    print("")
    sys.exit(0)

row = data[1]
if isinstance(row, list) and row:
    print(str(row[0]))
else:
    print("")
PY
}

strip_wayback_toolbar() {
  local input_html="$1"
  local output_html="$2"

  if grep -q '<!-- BEGIN WAYBACK TOOLBAR INSERT -->' "$input_html"; then
    awk '
      /<!-- END WAYBACK TOOLBAR INSERT -->/ { seen_end=1; next }
      seen_end { print }
    ' "$input_html" > "$output_html"
  else
    cp "$input_html" "$output_html"
  fi
}

cat > "$URLS_FILE" <<'EOF'
https://www.drupal.org/docs/drupal-apis/cache-api
https://www.drupal.org/docs/drupal-apis/cache-api/cache-api-overview
https://www.drupal.org/docs/drupal-apis/database-api
https://www.drupal.org/docs/drupal-apis/database-api/database-abstraction-layer
https://www.drupal.org/docs/drupal-apis/queue-api
https://www.drupal.org/docs/drupal-apis/state-api
https://www.drupal.org/docs/drupal-apis/events-system
https://www.drupal.org/docs/drupal-apis/events-system/subscribing-and-dispatching-events
https://www.drupal.org/docs/drupal-apis/logging-api
https://www.drupal.org/docs/drupal-apis/typed-data-api
https://www.drupal.org/docs/drupal-apis/update-api
https://www.drupal.org/docs/drupal-apis/menu-api
https://www.drupal.org/docs/drupal-apis/access-api
https://www.drupal.org/docs/drupal-apis/access-api/access-checking-on-routes
https://www.drupal.org/docs/drupal-apis/batch-api
https://www.drupal.org/docs/drupal-apis/javascript-api
https://www.drupal.org/docs/drupal-apis/javascript-api/javascript-api-overview
https://www.drupal.org/docs/drupal-apis/asset-library-api
https://www.drupal.org/docs/drupal-apis/asset-library-api/adding-stylesheets-css-and-javascript-js-to-a-drupal-module
https://www.drupal.org/docs/drupal-apis/email-api
https://www.drupal.org/docs/drupal-apis/file-api
https://www.drupal.org/docs/drupal-apis/node-api
https://www.drupal.org/docs/drupal-apis/user-api
https://www.drupal.org/docs/drupal-apis/block-api
https://www.drupal.org/docs/drupal-apis/migrate-api
https://www.drupal.org/docs/drupal-apis/migrate-api/migrate-source-plugins
https://www.drupal.org/docs/drupal-apis/migrate-api/migrate-process-plugins
https://www.drupal.org/docs/drupal-apis/migrate-api/migrate-destination-plugins-examples
https://www.drupal.org/docs/theming-drupal
https://www.drupal.org/docs/theming-drupal/twig-in-drupal
https://www.drupal.org/docs/theming-drupal/twig-in-drupal/twig-template-naming-conventions
https://www.drupal.org/docs/theming-drupal/twig-in-drupal/twig-filters-modifying-variables-in-twig-templates
https://www.drupal.org/docs/theming-drupal/working-with-breakpoints-in-drupal
https://www.drupal.org/docs/theming-drupal/responsive-images-in-drupal
https://www.drupal.org/docs/theming-drupal/drupal-theme-developer-guide
https://www.drupal.org/docs/drupal-apis/render-api
https://www.drupal.org/docs/drupal-apis/render-api/render-arrays
https://www.drupal.org/docs/drupal-apis/render-api/cacheability-of-render-arrays
https://www.drupal.org/docs/theming-drupal/theming-drupal-9/drupal-9-theme-hooks
https://www.drupal.org/docs/theming-drupal/theming-drupal-9/adding-a-base-theme
https://www.drupal.org/docs/extend/installing-modules
https://www.drupal.org/docs/extend/updating
https://www.drupal.org/docs/develop/standards
https://www.drupal.org/docs/develop/automated-testing
https://www.drupal.org/docs/develop/automated-testing/phpunit-in-drupal
EOF

sort -u "$URLS_FILE" -o "$URLS_FILE"
cp "$URLS_FILE" "$EXTRACTED_LINKS_FILE"

: > "$FETCHED_LINKS_FILE"
: > "$FAILED_LINKS_FILE"
: > "$NEW_LINKS_FILE"

attempted=0
succeeded=0
failed=0

echo "== Certification docs fetch via Wayback Machine =="
echo "Curated URLs: $(wc -l < "$URLS_FILE" | tr -d ' ')"
echo "Playwright fallback enabled: $ENABLE_PLAYWRIGHT_FALLBACK"

while IFS= read -r url; do
  [ -n "$url" ] || continue
  attempted=$((attempted + 1))
  printf '%s\n' "$url" >> "$NEW_LINKS_FILE"

  base="$(url_to_filename_base "$url")"
  cdx_json="$TMP_DIR/${base}.cdx.json"
  raw_html="$TMP_DIR/${base}.raw.html"
  clean_html="$TMP_DIR/${base}.clean.html"
  pw_html="$TMP_DIR/${base}.playwright.html"
  target_md="$DEST_DIR/${base}.md"

  cdx_url="https://web.archive.org/cdx/search/cdx?url=${url}&output=json&limit=1&fl=timestamp,original&filter=statuscode:200&from=20230101"

  echo "CDX   $url"
  if ! curl -sSL --user-agent "$USER_AGENT" --max-time 30 --retry 2 "$cdx_url" -o "$cdx_json"; then
    echo "WARN  $url (CDX lookup failed; trying optional Playwright fallback)"

    if try_playwright_fallback "$url" "$pw_html" "$target_md"; then
      succeeded=$((succeeded + 1))
      printf '%s\n' "$url" >> "$FETCHED_LINKS_FILE"
      echo "OK    $url -> $target_md (Playwright fallback)"
      sleep "$REQUEST_SLEEP_SECONDS"
      continue
    fi

    failed=$((failed + 1))
    printf '%s\n' "$url" >> "$FAILED_LINKS_FILE"
    rm -f "$target_md"
    echo "FAIL  $url (CDX + Playwright failed)"
    sleep "$REQUEST_SLEEP_SECONDS"
    continue
  fi

  timestamp="$(extract_cdx_timestamp "$cdx_json")"
  if [ -z "$timestamp" ]; then
    echo "WARN  $url (no Wayback snapshot from 2023+; trying optional Playwright fallback)"

    if try_playwright_fallback "$url" "$pw_html" "$target_md"; then
      succeeded=$((succeeded + 1))
      printf '%s\n' "$url" >> "$FETCHED_LINKS_FILE"
      echo "OK    $url -> $target_md (Playwright fallback)"
      sleep "$REQUEST_SLEEP_SECONDS"
      continue
    fi

    failed=$((failed + 1))
    printf '%s\n' "$url" >> "$FAILED_LINKS_FILE"
    rm -f "$target_md"
    echo "FAIL  $url (no Wayback snapshot; Playwright failed)"
    sleep "$REQUEST_SLEEP_SECONDS"
    continue
  fi

  snapshot_url="https://web.archive.org/web/${timestamp}/${url}"
  echo "FETCH $snapshot_url"
  if ! curl -sSL --user-agent "$USER_AGENT" --max-time 60 --retry 2 "$snapshot_url" -o "$raw_html"; then
    echo "WARN  $url (snapshot fetch failed; trying optional Playwright fallback)"

    if try_playwright_fallback "$url" "$pw_html" "$target_md"; then
      succeeded=$((succeeded + 1))
      printf '%s\n' "$url" >> "$FETCHED_LINKS_FILE"
      echo "OK    $url -> $target_md (Playwright fallback)"
      sleep "$REQUEST_SLEEP_SECONDS"
      continue
    fi

    failed=$((failed + 1))
    printf '%s\n' "$url" >> "$FAILED_LINKS_FILE"
    rm -f "$target_md"
    echo "FAIL  $url (snapshot + Playwright failed)"
    sleep "$REQUEST_SLEEP_SECONDS"
    continue
  fi

  strip_wayback_toolbar "$raw_html" "$clean_html"

  if convert_and_validate_html_to_markdown "$url" "$clean_html" "$target_md"; then
    succeeded=$((succeeded + 1))
    printf '%s\n' "$url" >> "$FETCHED_LINKS_FILE"
    echo "OK    $url -> $target_md"
    sleep "$REQUEST_SLEEP_SECONDS"
    continue
  fi

  echo "WARN  $url (Wayback HTML invalid/too small; trying optional Playwright fallback)"
  if try_playwright_fallback "$url" "$pw_html" "$target_md"; then
    succeeded=$((succeeded + 1))
    printf '%s\n' "$url" >> "$FETCHED_LINKS_FILE"
    echo "OK    $url -> $target_md (Playwright fallback)"
    sleep "$REQUEST_SLEEP_SECONDS"
    continue
  fi

  failed=$((failed + 1))
  printf '%s\n' "$url" >> "$FAILED_LINKS_FILE"
  rm -f "$target_md"
  echo "FAIL  $url (Wayback + Playwright invalid)"
  sleep "$REQUEST_SLEEP_SECONDS"
done < "$URLS_FILE"

sort -u "$FETCHED_LINKS_FILE" -o "$FETCHED_LINKS_FILE"
sort -u "$FAILED_LINKS_FILE" -o "$FAILED_LINKS_FILE"
sort -u "$NEW_LINKS_FILE" -o "$NEW_LINKS_FILE"

echo "== Certification docs Wayback fetch complete =="
echo "Curated total: $(wc -l < "$URLS_FILE" | tr -d ' ')"
echo "Attempted:     $attempted"
echo "Succeeded:     $succeeded"
echo "Failed:        $failed"
echo "Fetched links: $FETCHED_LINKS_FILE"
echo "Failed links:  $FAILED_LINKS_FILE"
