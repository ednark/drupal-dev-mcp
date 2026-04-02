#!/usr/bin/env bash
# scripts/fetch-drupal-skills.sh
# Clones or updates the grasmash/drupal-claude-skills repository into data/sources/drupal-skills/.

set -euo pipefail

REPO="https://github.com/grasmash/drupal-claude-skills.git"
DEST="data/sources/drupal-skills"
BRANCH="main"

if [ -d "${DEST}/.git" ]; then
  echo "Repository already cloned. Pulling latest changes..."
  cd "${DEST}" && git pull origin "${BRANCH}"
  cd -
else
  echo "Cloning drupal-claude-skills repository (shallow)..."
  git clone --depth 1 --branch "${BRANCH}" "${REPO}" "${DEST}"
fi

echo "Done. Files saved to ${DEST}/"
echo "Skill files available:"
find "${DEST}/skills" -name "*.md" | sort
