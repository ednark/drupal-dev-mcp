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
