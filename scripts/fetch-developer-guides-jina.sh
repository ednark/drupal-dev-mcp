#!/usr/bin/env bash
# Fetch Drupal developer guides via the Jina AI reader proxy (r.jina.ai).
#
# Drupal.org now serves a JavaScript "Client Challenge" anti-bot page that
# defeats plain curl and returns only a ~3KB stub. The Jina reader operates
# its own headless-browser fleet and returns clean Markdown for public pages,
# bypassing the challenge without requiring Playwright/Chromium locally.
#
# Output: data/sources/drupal-developer-guides/<slug>.md
#
# Usage: bash scripts/fetch-developer-guides-jina.sh

set -uo pipefail

DEST="data/sources/drupal-developer-guides"
mkdir -p "$DEST"

slug_from_url() {
  local url="$1"
  printf '%s' "$url" | sed 's#https\?://##' | sed 's#[/?=&:]#-#g' | sed 's#-\{2,\}#-#g' | sed 's#-$##'
}

is_low_quality() {
  local md_file="$1"
  # Jina prepends "Title:" / "URL Source:" / "Published Time:" metadata.
  # Strip those header lines before measuring real content length.
  local body_size
  body_size="$(sed '1,/^Markdown Content:/d' "$md_file" | tr -s '[:space:]' ' ' | wc -c | awk '{print $1}')"
  if [ "$body_size" -lt 350 ]; then
    return 0
  fi
  if grep -qiE 'error fetching|unable to fetch|access denied|page not found' "$md_file"; then
    return 0
  fi
  return 1
}

URLS=(
  # === Creating Modules ===
  "https://www.drupal.org/docs/develop/creating-modules"
  "https://www.drupal.org/docs/develop/creating-modules/getting-started-background-prerequisites"
  "https://www.drupal.org/docs/develop/creating-modules/naming-and-placing-your-drupal-module"
  "https://www.drupal.org/docs/develop/creating-modules/let-drupal-know-about-your-module-with-an-infoyml-file"
  "https://www.drupal.org/docs/develop/creating-modules/include-default-configuration-in-your-drupal-module"
  "https://www.drupal.org/docs/develop/creating-modules/defining-and-using-your-own-configuration-in-drupal"
  "https://www.drupal.org/docs/develop/creating-modules/create-a-custom-page-using-a-controller"
  "https://www.drupal.org/docs/creating-modules/creating-custom-blocks"
  "https://www.drupal.org/docs/creating-custom-modules/creating-custom-field-types-widgets-and-formatters"
  "https://www.drupal.org/docs/develop/creating-modules/subscribe-to-and-dispatch-events"
  "https://www.drupal.org/docs/develop/creating-modules/building-a-views-display-style-plugin-for-drupal"
  "https://www.drupal.org/docs/develop/creating-modules/adding-assets-css-js-to-a-drupal-module-via-librariesyml"
  "https://www.drupal.org/docs/develop/creating-modules/basic-module-building-tutorial-lorem-ipsum-generator"
  "https://www.drupal.org/docs/creating-custom-modules/step-by-step-tutorial-hello-world"
  "https://www.drupal.org/docs/develop/creating-modules/understanding-hooks"
  # === Drupal APIs — migrated to /docs/develop/drupal-apis/ ===
  "https://www.drupal.org/docs/develop/drupal-apis/access-policy-api"
  "https://www.drupal.org/docs/develop/drupal-apis/ajax-api"
  "https://www.drupal.org/docs/develop/drupal-apis/authentication-api"
  "https://www.drupal.org/docs/develop/drupal-apis/cache-api"
  "https://www.drupal.org/docs/develop/drupal-apis/database-api"
  "https://www.drupal.org/docs/develop/drupal-apis/form-api"
  "https://www.drupal.org/docs/develop/drupal-apis/javascript-api"
  "https://www.drupal.org/docs/develop/drupal-apis/restful-web-services-api"
  "https://www.drupal.org/docs/develop/drupal-apis/runtime-assertions"
  "https://www.drupal.org/docs/develop/drupal-apis/state-api"
  "https://www.drupal.org/docs/develop/drupal-apis/translation-api-code-text"
  "https://www.drupal.org/docs/develop/drupal-apis/typed-data-api"
  "https://www.drupal.org/docs/develop/drupal-apis/htmx"
  "https://www.drupal.org/docs/develop/drupal-apis/icon-api"
  "https://www.drupal.org/docs/develop/drupal-apis/token-api"
  # === Drupal APIs — still at /docs/drupal-apis/ ===
  "https://www.drupal.org/docs/drupal-apis/batch-api"
  "https://www.drupal.org/docs/drupal-apis/block-api"
  "https://www.drupal.org/docs/drupal-apis/ckeditor-5-api"
  "https://www.drupal.org/docs/drupal-apis/configuration-api"
  "https://www.drupal.org/docs/drupal-apis/entity-api"
  "https://www.drupal.org/docs/drupal-apis/entity-api/introduction-to-entity-api-in-drupal"
  "https://www.drupal.org/docs/drupal-apis/entity-api/creating-a-content-entity-type-in-drupal"
  "https://www.drupal.org/docs/drupal-apis/filter-api"
  "https://www.drupal.org/docs/drupal-apis/layout-api"
  "https://www.drupal.org/docs/drupal-apis/logging-api"
  "https://www.drupal.org/docs/drupal-apis/menu-api"
  "https://www.drupal.org/docs/drupal-apis/middleware-api"
  "https://www.drupal.org/docs/drupal-apis/migrate-api"
  "https://www.drupal.org/docs/drupal-apis/plugin-api"
  "https://www.drupal.org/docs/drupal-apis/render-api"
  "https://www.drupal.org/docs/drupal-apis/responses"
  "https://www.drupal.org/docs/drupal-apis/routing-system"
  "https://www.drupal.org/docs/drupal-apis/serialization-api"
  "https://www.drupal.org/docs/drupal-apis/services-and-dependency-injection"
  "https://www.drupal.org/docs/drupal-apis/text-editor-api"
  "https://www.drupal.org/docs/drupal-apis/tour-api"
  "https://www.drupal.org/docs/drupal-apis/update-api"
  # === Theming Drupal ===
  "https://www.drupal.org/docs/develop/theming-drupal"
  "https://www.drupal.org/docs/develop/theming-drupal/defining-a-theme-with-an-infoyml-file"
  "https://www.drupal.org/docs/develop/theming-drupal/drupal-theme-folder-structure"
  "https://www.drupal.org/docs/develop/theming-drupal/adding-regions-to-a-theme"
  "https://www.drupal.org/docs/develop/theming-drupal/adding-assets-css-js-to-a-drupal-theme-via-librariesyml"
  "https://www.drupal.org/docs/develop/theming-drupal/twig-in-drupal"
  "https://www.drupal.org/docs/develop/theming-drupal/creating-sub-themes"
  "https://www.drupal.org/docs/develop/theming-drupal/using-single-directory-components"
  "https://www.drupal.org/docs/develop/theming-drupal/working-with-breakpoints-in-drupal"
  # === Automated Testing ===
  "https://www.drupal.org/docs/develop/automated-testing"
  "https://www.drupal.org/docs/develop/automated-testing/phpunit-in-drupal"
  "https://www.drupal.org/docs/develop/automated-testing/browser-testing-using-cypress"
  "https://www.drupal.org/docs/develop/automated-testing/javascript-testing-using-nightwatch"
  "https://www.drupal.org/docs/develop/automated-testing/types-of-tests"
  "https://www.drupal.org/docs/develop/automated-testing/test-failures"
  "https://www.drupal.org/docs/develop/automated-testing/run-core-development-checks"
  "https://www.drupal.org/docs/develop/automated-testing/performance-tests"
)

OK=0
SKIPPED=0
FAILED=0
TOTAL=0

for url in "${URLS[@]}"; do
  TOTAL=$((TOTAL + 1))
  slug="$(slug_from_url "$url")"
  md_file="$DEST/${slug}.md"

  # Skip if already fetched with real content
  if [ -s "$md_file" ] && ! is_low_quality "$md_file"; then
    echo "[$TOTAL] SKIP $url"
    SKIPPED=$((SKIPPED + 1))
    continue
  fi

  echo "[$TOTAL] FETCH $url"
  if curl -s -L --max-time 45 \
    -H 'Accept: text/plain, text/markdown, */*' \
    -H 'Accept-Language: en-US,en;q=0.9' \
    -H 'X-Return-Format: markdown' \
    "https://r.jina.ai/${url}" > "$md_file"; then

    if is_low_quality "$md_file"; then
      echo "[$TOTAL] FAIL low-quality/blocked: $url"
      rm -f "$md_file"
      FAILED=$((FAILED + 1))
    else
      echo "[$TOTAL] OK   $(wc -c < "$md_file" | tr -d ' ') bytes"
      OK=$((OK + 1))
    fi
  else
    echo "[$TOTAL] FAIL fetch error: $url"
    rm -f "$md_file"
    FAILED=$((FAILED + 1))
  fi

  # Be polite to the free Jina tier
  sleep 2
done

echo ""
echo "Done. total=$TOTAL ok=$OK skipped=$SKIPPED failed=$FAILED"
