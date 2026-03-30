#!/usr/bin/env bash
# Fetch Drupal developer guides directly from Drupal.org docs pages.

set -uo pipefail

DEST="data/sources/drupal-developer-guides"
USER_AGENT="Mozilla/5.0"

mkdir -p "$DEST"

PANDOC_AVAILABLE=0
if command -v pandoc >/dev/null 2>&1; then
  PANDOC_AVAILABLE=1
fi

slug_from_url() {
  local url="$1"
  local slug
  slug="$(printf '%s' "$url" | sed 's#https\?://##' | sed 's#[/?=&:]#-#g' | sed 's#-\{2,\}#-#g' | sed 's#-$##')"
  printf '%s' "$slug"
}

convert_html_to_markdown() {
  local html_file="$1"
  local md_file="$2"

  if [ "$PANDOC_AVAILABLE" -eq 1 ]; then
    if pandoc -f html -t gfm --wrap=none -o "$md_file" "$html_file"; then
      return 0
    fi
  fi

  if cat "$html_file" | sed 's/<[^>]*>//g' | sed 's/^[[:space:]]*$//' | grep -v '^$' > "$md_file"; then
    return 0
  fi

  return 1
}

sanitize_markdown_file() {
  local md_file="$1"
  local tmp_file
  tmp_file="${md_file}.tmp"

  sed 's/\r$//' "$md_file" \
    | sed '/^[[:space:]]*<[^>][^>]*>[[:space:]]*$/d' \
    | awk 'BEGIN{blank=0} { if ($0 ~ /^[[:space:]]*$/) { blank++; if (blank<=1) print; } else { blank=0; print; } }' \
    > "$tmp_file"

  mv "$tmp_file" "$md_file"
}

is_blocked_or_low_quality_html() {
  local html_file="$1"

  if grep -qi 'Access to this page has been denied' "$html_file"; then
    return 0
  fi

  if grep -qi 'drupalorg/images/qmark-400x684-2x.png' "$html_file"; then
    return 0
  fi

  local text_size
  text_size="$(sed 's/<[^>]*>//g' "$html_file" | tr -s '[:space:]' ' ' | wc -c | awk '{print $1}')"
  if [ "$text_size" -lt 350 ]; then
    return 0
  fi

  return 1
}

write_minimal_fallback() {
  local md_file="$1"
  local url="$2"

  {
    echo "# Drupal Developer Guide (Fetch Failed)"
    echo
    echo "Source: $url"
    echo
    echo "Unable to fetch this page in the current environment."
  } > "$md_file"
}

write_develop_landing_fallback() {
  echo "Falling back to Drupal.org develop landing page snapshot..."

  cat > "$DEST/README.md" <<'EOF'
# Drupal Developer Guides (Fallback Snapshot)

This fallback snapshot is generated when direct page fetches fail in the current environment.

Primary developer docs landing page:
- https://www.drupal.org/docs/develop
EOF

  if curl -s -L --max-time 30 -A "$USER_AGENT" -o "$DEST/develop.html" "https://www.drupal.org/docs/develop"; then
    if convert_html_to_markdown "$DEST/develop.html" "$DEST/develop.md"; then
      rm -f "$DEST/develop.html"
      return 0
    fi
  fi

  write_minimal_fallback "$DEST/develop.md" "https://www.drupal.org/docs/develop"
  rm -f "$DEST/develop.html"
  return 0
}

is_recent_markdown() {
  local md_file="$1"
  if [ -s "$md_file" ] && find "$md_file" -mtime -7 | grep -q .; then
    return 0
  fi
  return 1
}

is_fallback_markdown() {
  local md_file="$1"
  if [ ! -f "$md_file" ]; then
    return 1
  fi

  if grep -q 'Drupal Developer Guide (Fetch Failed)' "$md_file"; then
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

SUCCESS_COUNT=0
FALLBACK_COUNT=0

for url in "${URLS[@]}"; do
  slug="$(slug_from_url "$url")"
  html_file="$DEST/${slug}.html"
  md_file="$DEST/${slug}.md"

  if is_recent_markdown "$md_file" && ! is_fallback_markdown "$md_file"; then
    echo "Skipping recent file: $md_file"
    SUCCESS_COUNT=$((SUCCESS_COUNT + 1))
    continue
  fi

  echo "Fetching: ${url}..."
  if curl -s -L --max-time 30 -A "$USER_AGENT" -o "$html_file" "$url"; then
    if is_blocked_or_low_quality_html "$html_file"; then
      echo "Warning: blocked/low-quality response for ${url}"
      write_minimal_fallback "$md_file" "$url"
      rm -f "$html_file"
      FALLBACK_COUNT=$((FALLBACK_COUNT + 1))
    elif convert_html_to_markdown "$html_file" "$md_file"; then
      sanitize_markdown_file "$md_file"
      rm -f "$html_file"
      SUCCESS_COUNT=$((SUCCESS_COUNT + 1))
    else
      echo "Warning: conversion failed for ${url}"
      write_minimal_fallback "$md_file" "$url"
      rm -f "$html_file"
      FALLBACK_COUNT=$((FALLBACK_COUNT + 1))
    fi
  else
    echo "Warning: fetch failed for ${url}"
    write_minimal_fallback "$md_file" "$url"
    rm -f "$html_file"
    FALLBACK_COUNT=$((FALLBACK_COUNT + 1))
  fi
done

if [ "$SUCCESS_COUNT" -eq 0 ]; then
  write_develop_landing_fallback
else
  # Remove legacy fallback snapshot files so ETL indexes real guide pages.
  rm -f "$DEST/develop.md" "$DEST/README.md"
fi

echo "Developer Guides fetch complete. Successful pages: $SUCCESS_COUNT, fallback pages: $FALLBACK_COUNT"
