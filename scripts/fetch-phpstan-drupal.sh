#!/usr/bin/env bash
# Clones (or updates) the mglaman/phpstan-drupal extension repository as a
# shallow git clone. Primary source for the validation-tooling guidance:
# what the Drupal PHPStan extension checks (service map, DI, entity APIs)
# and its canonical configuration.
#
# Re-running is idempotent: existing clones are updated, missing ones cloned.
set -uo pipefail

DEST_DIR="data/sources/phpstan-drupal"
REPO_URL="https://github.com/mglaman/phpstan-drupal.git"

mkdir -p "$(dirname "$DEST_DIR")"

if [ -d "$DEST_DIR/.git" ]; then
  echo "  ↻  Updating phpstan-drupal..."
  if git -C "$DEST_DIR" fetch --depth=1 origin HEAD 2>/dev/null \
    && git -C "$DEST_DIR" reset --hard FETCH_HEAD 2>/dev/null; then
    echo "  ✓  Updated"
  else
    echo "  ⚠  Could not update phpstan-drupal"
    exit 1
  fi
else
  echo "  ↓  Cloning phpstan-drupal..."
  if git clone --depth=1 --single-branch "$REPO_URL" "$DEST_DIR" 2>/dev/null; then
    echo "  ✓  Cloned"
  else
    echo "  ⚠  Could not clone phpstan-drupal"
    exit 1
  fi
fi
