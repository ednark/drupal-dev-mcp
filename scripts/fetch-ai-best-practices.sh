#!/usr/bin/env bash
# scripts/fetch-ai-best-practices.sh
# Clones or updates the drupal.org ai_best_practices repository into
# data/sources/drupal-ai-best-practices/ — skills/ ONLY (sparse checkout).
#
# Why sparse: the repo is a composer plugin whose src/, tests/, evals/, and
# .agents/ trees must NOT enter the corpus (evals/*.md+json would otherwise be
# ingested as documents; src/ is plugin code, not Drupal module code). See
# plans/active/ai-best-practices-corpus.md.

set -euo pipefail

REPO="https://git.drupalcode.org/project/ai_best_practices.git"
DEST="data/sources/drupal-ai-best-practices"
# drupal.org default branch is the release branch (1.0.x), not 'main'.
BRANCH="1.0.x"

if [ -d "${DEST}/.git" ]; then
  echo "Repository already cloned. Pulling latest changes..."
  cd "${DEST}"
  git pull origin "${BRANCH}"
else
  echo "Cloning ai_best_practices (shallow, sparse: skills/ only)..."
  git clone --depth 1 --filter=blob:none --sparse -b "${BRANCH}" "${REPO}" "${DEST}"
  cd "${DEST}"
fi

git sparse-checkout set skills
cd -

echo "Done. Skill documents available at ${DEST}/skills/:"
find "${DEST}/skills" -name "*.md" | sort
