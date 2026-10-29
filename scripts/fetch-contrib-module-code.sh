#!/usr/bin/env bash
# Clones (or updates) the source code of popular Drupal contrib modules using
# shallow git clones from git.drupalcode.org.
#
# Re-running is idempotent:
#   - Existing clones are updated with `fetch --depth=1 + reset --hard`
#   - New modules are cloned fresh with `--depth=1 --single-branch`
#   - Individual failures print a warning and continue (do not abort the script)
#
# Usage: bash scripts/fetch-contrib-module-code.sh

set -uo pipefail

DEST_DIR="data/sources/contrib-module-code"
mkdir -p "$DEST_DIR"

MODULES=(
  views
  token
  pathauto
  ctools
  entity
  paragraphs
  webform
  admin_toolbar
  metatag
  redirect
  simple_sitemap
  field_group
  devel
  smtp
  backup_migrate
  google_analytics
  captcha
  recaptcha
  better_exposed_filters
  module_filter
  twig_tweak
  scheduler
  linkit
  eck
  eca
  transliteration
  imce
  conditional_fields
  allowed_formats
  roleassign
  environment_indicator
  block_class
  field_validation
  jquery_update
  libraries
  date
  media
  media_entity
  colorbox
  slick
  views_bulk_operations
  queue_ui
  crop
  focal_point
  ai
  drupal_ai
  # Tier 1 — near-universal in modern builds
  search_api
  search_api_db
  facets
  migrate_plus
  migrate_tools
  migrate_source_csv
  inline_entity_form
  entity_browser
  entity_embed
  address
  smart_date
  gin
  honeypot
  diff
  select2
  # audit — site/code audit scores (security, performance, caching, config,
  # code quality) with JSON Drush commands; indexed so agents can ground
  # audit-driven fix loops against the module's own rule documentation.
  audit
  # coder — PHPCS Drupal/DrupalPractice sniffs; primary source for the
  # validation-tooling guidance (what phpcs catches on Drupal code).
  coder
  # Version-gated agent-ecosystem modules (research intake 2026-10-29, B1):
  # gates verified from each .info.yml core_version_requirement — Canvas is
  # 11.3+ (must never surface for 10.6 queries), AI is ^10.5 || ^11.2,
  # MCP Server is beta (^10 || ^11) with no stable release.
  canvas
  mcp_server
  # NOTE: "drupal/tool_api" from the research intake does NOT exist on
  # drupal.org (404) — fabricated/mis-attributed project name; do not add
  # until verified. The "Tool API" may ship inside the AI module ecosystem.
  # Tier 2 — common, project-dependent
  commerce
  simple_oauth
  openid_connect
  views_data_export
  csv_serialization
  ultimate_cron
  rabbit_hole
  coffee
  masquerade
  layout_builder_styles
  layout_builder_restrictions
  layout_library
)

SUCCEEDED=0
FAILED=0
TOTAL=${#MODULES[@]}

echo "=== Fetching contrib module source code ==="
echo "Destination : $DEST_DIR"
echo "Modules     : $TOTAL"
echo ""

for MODULE in "${MODULES[@]}"; do
  TARGET="$DEST_DIR/$MODULE"
  REPO_URL="https://git.drupalcode.org/project/${MODULE}.git"

  if [ -d "$TARGET/.git" ]; then
    echo "  ↻  Updating $MODULE..."
    if git -C "$TARGET" fetch --depth=1 origin HEAD 2>/dev/null \
      && git -C "$TARGET" reset --hard FETCH_HEAD 2>/dev/null; then
      SUCCEEDED=$((SUCCEEDED + 1))
    else
      echo "  ⚠  Could not update $MODULE — skipping"
      FAILED=$((FAILED + 1))
    fi
  else
    echo "  ↓  Cloning $MODULE..."
    if git clone --depth=1 --single-branch "$REPO_URL" "$TARGET" 2>/dev/null; then
      SUCCEEDED=$((SUCCEEDED + 1))
    else
      echo "  ⚠  Could not clone $MODULE — skipping"
      FAILED=$((FAILED + 1))
    fi
    # Polite delay between fresh clones to avoid hammering the server
    sleep 0.5
  fi
done

# Remove test fixture directory created during development (not a real module)
if [ -d "$DEST_DIR/test_module" ]; then
  echo ""
  echo "  🗑  Removing test fixture: $DEST_DIR/test_module"
  rm -rf "$DEST_DIR/test_module"
fi

echo ""
echo "=== Contrib module code fetch complete ==="
echo "  Succeeded : $SUCCEEDED / $TOTAL"
echo "  Failed    : $FAILED / $TOTAL"
echo "  Output    : $DEST_DIR"
