#!/usr/bin/env bash
# Fetch Drupal tutorials & examples sources.
#
# Sources (priority order):
# 1) Drupal.org docs/develop pages snapshot
# 2) Top contrib modules from Drupal.org API, cloned from drupalcode GitLab
# 3) Per-module Markdown fallback if clone/pull fails
#
# After adding this script, set executable permissions once:
#   chmod +x scripts/fetch-tutorials.sh

set -euo pipefail

BASE_DEST="data/sources/tutorials"
DOCS_DEST="$BASE_DEST/drupal-org-docs"
MODULES_API_URL="https://www.drupal.org/api-d7/node.json?type=project_module&field_project_has_releases=1&sort=project_install_count&direction=DESC&limit=20"

mkdir -p "$BASE_DEST"

write_docs_snapshot() {
  echo "→ Fetching Drupal.org docs snapshots..."
  mkdir -p "$DOCS_DEST"

  local urls=(
    "https://www.drupal.org/docs/develop"
    "https://www.drupal.org/docs/develop/creating-modules"
    "https://www.drupal.org/docs/drupal-apis/services-and-dependency-injection"
    "https://www.drupal.org/docs/develop/standards"
  )

  for url in "${urls[@]}"; do
    local slug
    slug="$(echo "$url" | sed -E 's#https?://##; s#[^a-zA-Z0-9]+#-#g; s#-+$##')"
    local html_file="$DOCS_DEST/${slug}.html"
    local md_file="$DOCS_DEST/${slug}.md"

    if curl -fsSL "$url" -o "$html_file"; then
      {
        echo "# Drupal docs snapshot"
        echo
        echo "Source: $url"
        echo
        echo '```html'
        sed -n '1,400p' "$html_file"
        echo '```'
      } > "$md_file"
      rm -f "$html_file"
      echo "  ✓ Saved $md_file"
    else
      echo "  ⚠ Failed to fetch $url"
    fi
  done
}

extract_modules_tsv() {
  node -e '
    const fs = require("fs");
    const input = fs.readFileSync(0, "utf8");
    let data = {};
    try { data = JSON.parse(input); } catch { process.exit(0); }

    const rows = Array.isArray(data.list) ? data.list : [];

    const getValue = (obj, keys) => {
      for (const key of keys) {
        if (obj && typeof obj === "object" && obj[key] != null) {
          return obj[key];
        }
      }
      return null;
    };

    for (const row of rows) {
      const node = row.node || row;
      const machine =
        getValue(node, ["field_project_machine_name", "project_machine_name", "machine_name", "name"]) ||
        (typeof node.path === "string" ? node.path.split("/").filter(Boolean).pop() : null) ||
        `module-${Math.random().toString(36).slice(2, 8)}`;

      const title = getValue(node, ["title", "name"]) || machine;
      const description = getValue(node, ["body", "description", "field_summary"]) || "No description provided.";

      const directRepo =
        getValue(node, ["field_project_repository", "project_repository", "repository", "repo_url"]) || "";

      const repo = directRepo && String(directRepo).startsWith("http")
        ? String(directRepo)
        : `https://git.drupalcode.org/project/${machine}.git`;

      const safeDescription = String(description).replace(/\s+/g, " ").trim();
      process.stdout.write(`${machine}\t${title}\t${safeDescription}\t${repo}\n`);
    }
  '
}

write_module_fallback() {
  local module_name="$1"
  local module_title="$2"
  local module_description="$3"

  local module_dir="$BASE_DEST/$module_name"
  mkdir -p "$module_dir"
  cat > "$module_dir/README.fallback.md" <<EOF
# ${module_title}

Machine name: ${module_name}

${module_description}

This fallback file was generated because the module repository could not be cloned or updated.
EOF
  echo "  ↳ Wrote fallback Markdown for ${module_name}"
}

fetch_modules() {
  echo "→ Fetching top contrib modules list from Drupal.org API..."
  local payload
  if ! payload="$(curl -fsSL "$MODULES_API_URL")"; then
    echo "⚠ Failed to fetch module list from Drupal.org API"
    return 0
  fi

  local count=0
  while IFS=$'\t' read -r module_name module_title module_description repo_url; do
    [ -n "$module_name" ] || continue
    count=$((count + 1))
    local module_dir="$BASE_DEST/$module_name"

    echo "  [${count}] ${module_name}"

    if [ -d "$module_dir/.git" ]; then
      echo "    → Updating existing repository"
      if git -C "$module_dir" pull --rebase; then
        echo "    ✓ Updated ${module_name}"
        continue
      fi

      echo "    ⚠ Could not update ${module_name}; keeping existing content"
      if find "$module_dir" -maxdepth 2 -type f \( -iname 'README*' -o -iname '*.md' \) | grep -q .; then
        continue
      fi

      write_module_fallback "$module_name" "$module_title" "$module_description"
      continue
    fi

    rm -rf "$module_dir"
    echo "    → Cloning from ${repo_url}"
    if git clone --depth=1 "$repo_url" "$module_dir"; then
      echo "    ✓ Cloned ${module_name}"
      continue
    fi

    echo "    ⚠ Clone failed for ${module_name}"
    write_module_fallback "$module_name" "$module_title" "$module_description"
  done < <(printf '%s' "$payload" | extract_modules_tsv)

  echo "→ Processed ${count} modules"
}

echo "=== Drupal Tutorials Fetch ==="
echo "Destination: $BASE_DEST"

write_docs_snapshot
fetch_modules

echo "✓ Tutorials sources ready at $BASE_DEST"
