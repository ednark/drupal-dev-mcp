#!/usr/bin/env bash
# scripts/fetch-best-practices.sh
# Downloads the theodorosploumis/drupal-best-practices markdown files via shallow git clone.

set -euo pipefail

REPO="https://github.com/theodorosploumis/drupal-best-practices.git"
DEST="data/sources/drupal-best-practices"
BRANCH="main"

if [ -d "${DEST}/.git" ]; then
  echo "Repository already cloned. Pulling latest changes..."
  cd "${DEST}" && git pull origin "${BRANCH}"
  cd -
else
  echo "Cloning drupal-best-practices repository (shallow)..."
  git clone --depth 1 --branch "${BRANCH}" "${REPO}" "${DEST}"
fi

echo "Done. Files saved to ${DEST}/"
echo "Markdown files available:"
find "${DEST}/ai" -name "*.md" | sort
