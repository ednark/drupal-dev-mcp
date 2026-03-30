#!/usr/bin/env bash
set -euo pipefail

export GIT_TERMINAL_PROMPT=0

REPO_URL="https://git.drupalcode.org/project/examples.git"
DEST_DIR="data/sources/drupal-examples"

echo "=== Drupal Examples source fetch ==="
echo "Repository: $REPO_URL"
echo "Destination: $DEST_DIR"

mkdir -p "$(dirname "$DEST_DIR")"

if [ -d "$DEST_DIR/.git" ]; then
  echo "[update] Existing clone detected; syncing to origin/HEAD"
  git -C "$DEST_DIR" remote set-url origin "$REPO_URL"
  git -C "$DEST_DIR" fetch --depth=1 origin HEAD
  git -C "$DEST_DIR" reset --hard FETCH_HEAD
  echo "[ok] Updated Drupal Examples clone"
else
  if [ -d "$DEST_DIR" ]; then
    echo "[warn] Destination exists but is not a git clone: $DEST_DIR"
    echo "[action] Removing non-git directory to perform clean clone"
    rm -rf "$DEST_DIR"
  fi

  echo "[clone] Performing shallow clone"
  git clone --depth=1 --single-branch "$REPO_URL" "$DEST_DIR"
  echo "[ok] Cloned Drupal Examples"
fi

echo "=== Drupal Examples fetch complete ==="
