#!/usr/bin/env bash
set -euo pipefail

DEST="data/sources/symfony-docs"
REPO_URL="https://github.com/symfony/symfony-docs.git"

mkdir -p "data/sources"

write_fallback() {
  mkdir -p "$DEST"
  cat > "$DEST/README.md" <<'EOF'
# Symfony Docs (Fetch Fallback)

The Symfony docs repository could not be fetched from GitHub in this environment.

Expected source:
- https://github.com/symfony/symfony-docs
EOF
}

if [ -d "$DEST/.git" ]; then
  echo "Updating existing Symfony docs repository..."
  if git -C "$DEST" pull --rebase; then
    echo "Symfony docs updated at $DEST"
    exit 0
  fi

  echo "Warning: failed to update $DEST; writing fallback README"
  write_fallback
  exit 0
fi

echo "Cloning Symfony docs repository..."
if git clone --depth=1 "$REPO_URL" "$DEST"; then
  echo "Symfony docs cloned at $DEST"
  exit 0
fi

echo "Warning: clone failed; writing fallback README"
write_fallback

