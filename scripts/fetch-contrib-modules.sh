#!/usr/bin/env bash
set -euo pipefail

DEST_DIR="data/sources/contrib-modules"
UA="Mozilla/5.0 (compatible; DrupalDevMCP/1.0; +https://github.com/example/drupal-dev-mcp)"
BULK_API_URL="https://www.drupal.org/api-d7/node.json?type=project_module&field_project_has_releases=1&sort=project_install_count&direction=DESC&limit=50"
PER_MODULE_API="https://www.drupal.org/api-d7/node.json?field_project_machine_name="

# Hardcoded list of popular Drupal contrib modules (~35+)
POPULAR_MODULES=(
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

mkdir -p "$DEST_DIR"

# ─── Helpers ─────────────────────────────────────────────────────────────────

write_fallback() {
  cat > "$DEST_DIR/README.md" <<'EOF'
# Contrib Modules (Fetch Fallback)

Unable to fetch contrib module metadata from Drupal.org API.

Expected endpoint:
- https://www.drupal.org/api-d7/node.json?type=project_module&field_project_has_releases=1&sort=project_install_count&direction=DESC&limit=30
EOF
}

# Process a single module JSON file and write module_name.md to DEST_DIR.
# Usage: process_module_json <machine_name> <json_path>
# Returns 0 on success, 1 on failure.
process_module_json() {
  local machine="$1"
  local json_file="$2"

  node --input-type=module - "$machine" "$json_file" "$DEST_DIR" <<'NODE'
import fs from 'node:fs';
import path from 'node:path';

const [machine, jsonPath, destDir] = process.argv.slice(2);

function first(v) {
  if (v == null) return null;
  if (Array.isArray(v)) return v.length ? first(v[0]) : null;
  if (typeof v === 'object') {
    if ('und' in v) return first(v.und);
    if ('en'  in v) return first(v.en);
    if ('value'      in v) return v.value      == null ? null : String(v.value);
    if ('safe_value' in v) return v.safe_value == null ? null : String(v.safe_value);
    if ('url'        in v) return v.url        == null ? null : String(v.url);
    if ('uri'        in v) return v.uri        == null ? null : String(v.uri);
  }
  return String(v);
}

function pick(obj, keys) {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      const value = first(obj[key]);
      if (value) return value;
    }
  }
  return null;
}

function stripHtml(html) {
  return String(html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi,  ' ')
    .replace(/&amp;/gi,   '&')
    .replace(/&lt;/gi,    '<')
    .replace(/&gt;/gi,    '>')
    .replace(/&quot;/gi,  '"')
    .replace(/&#39;/gi,   "'")
    .replace(/\s+/g, ' ')
    .trim();
}

let parsed;
try {
  parsed = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
} catch (err) {
  console.error(`Failed to parse JSON for ${machine}: ${err.message}`);
  process.exit(1);
}

const list = Array.isArray(parsed.list)
  ? parsed.list
  : Array.isArray(parsed.nodes)
    ? parsed.nodes
    : Array.isArray(parsed.data)
      ? parsed.data
      : [];

if (!list.length) {
  console.error(`No data in API response for module: ${machine}`);
  process.exit(1);
}

const item = list[0] && list[0].node ? list[0].node : list[0];

const machineName = pick(item, ['field_project_machine_name', 'machine_name']) || machine;
const title       = pick(item, ['title']) || machineName;
const url         = pick(item, ['url']) || `https://www.drupal.org/project/${machineName}`;

// Description from body field (HTML) or other description fields
const bodyHtml = (item.body && typeof item.body === 'object' && item.body.value)
  ? String(item.body.value)
  : pick(item, ['body', 'field_description', 'description']) || '';
const description = stripHtml(bodyHtml);

// Project usage stats
const usage = item.project_usage && typeof item.project_usage === 'object'
  ? item.project_usage
  : {};
const usageEntries = Object.entries(usage)
  .filter(([, count]) => Number(count) > 0)
  .sort(([, a], [, b]) => Number(b) - Number(a))
  .slice(0, 5);

const lines = [
  `# ${title}`,
  '',
  `Machine name: \`${machineName}\``,
  `Project page: ${url}`,
  '',
  '## Description',
  '',
  description || 'No description provided.',
  '',
];

if (usageEntries.length > 0) {
  lines.push('## Active Installations');
  lines.push('');
  for (const [version, count] of usageEntries) {
    lines.push(`- ${version}: ${Number(count).toLocaleString()} sites`);
  }
  lines.push('');
}

const outPath = path.join(destDir, `${machineName}.md`);
fs.writeFileSync(outPath, lines.join('\n'), 'utf8');
console.log(`  ✓ Wrote ${machineName}.md`);
NODE
}

# Process a bulk API response JSON (list of modules) and write individual .md files.
process_bulk_json() {
  local json_file="$1"

  node --input-type=module - "$json_file" "$DEST_DIR" <<'NODE'
import fs from 'node:fs';
import path from 'node:path';

const [jsonPath, destDir] = process.argv.slice(2);

function first(v) {
  if (v == null) return null;
  if (Array.isArray(v)) return v.length ? first(v[0]) : null;
  if (typeof v === 'object') {
    if ('und' in v) return first(v.und);
    if ('en'  in v) return first(v.en);
    if ('value'      in v) return v.value      == null ? null : String(v.value);
    if ('safe_value' in v) return v.safe_value == null ? null : String(v.safe_value);
    if ('url'        in v) return v.url        == null ? null : String(v.url);
    if ('uri'        in v) return v.uri        == null ? null : String(v.uri);
  }
  return String(v);
}

function pick(obj, keys) {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      const value = first(obj[key]);
      if (value) return value;
    }
  }
  return null;
}

function stripHtml(html) {
  return String(html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi,  ' ')
    .replace(/&amp;/gi,   '&')
    .replace(/&lt;/gi,    '<')
    .replace(/&gt;/gi,    '>')
    .replace(/&quot;/gi,  '"')
    .replace(/&#39;/gi,   "'")
    .replace(/\s+/g, ' ')
    .trim();
}

let parsed;
try {
  parsed = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
} catch (err) {
  console.error(`Failed to parse bulk JSON: ${err.message}`);
  process.exit(1);
}

const rawList = Array.isArray(parsed.list)
  ? parsed.list
  : Array.isArray(parsed.nodes)
    ? parsed.nodes
    : Array.isArray(parsed.data)
      ? parsed.data
      : [];

if (!rawList.length) {
  console.error('Bulk API returned empty list');
  process.exit(1);
}

let written = 0;
for (const row of rawList) {
  const item = row && typeof row === 'object' && row.node ? row.node : row;
  if (!item || typeof item !== 'object') continue;

  const machineName = pick(item, ['field_project_machine_name', 'machine_name', 'name']);
  if (!machineName) continue;

  const title = pick(item, ['title']) || machineName;
  const url   = pick(item, ['url']) || `https://www.drupal.org/project/${machineName}`;

  const bodyHtml = (item.body && typeof item.body === 'object' && item.body.value)
    ? String(item.body.value)
    : pick(item, ['body', 'field_description', 'description']) || '';
  const description = stripHtml(bodyHtml);

  const usage = item.project_usage && typeof item.project_usage === 'object'
    ? item.project_usage
    : {};
  const usageEntries = Object.entries(usage)
    .filter(([, count]) => Number(count) > 0)
    .sort(([, a], [, b]) => Number(b) - Number(a))
    .slice(0, 5);

  const lines = [
    `# ${title}`,
    '',
    `Machine name: \`${machineName}\``,
    `Project page: ${url}`,
    '',
    '## Description',
    '',
    description || 'No description provided.',
    '',
  ];

  if (usageEntries.length > 0) {
    lines.push('## Active Installations');
    lines.push('');
    for (const [version, count] of usageEntries) {
      lines.push(`- ${version}: ${Number(count).toLocaleString()} sites`);
    }
    lines.push('');
  }

  const outPath = path.join(destDir, `${machineName}.md`);
  fs.writeFileSync(outPath, lines.join('\n'), 'utf8');
  written++;
}

console.log(`Bulk: wrote ${written} module files.`);
NODE
}

# ─── Step 1: Try the bulk sorted API (may be 503 / blocked) ──────────────────

echo "=== Fetch contrib module documentation from Drupal.org ==="
echo ""
echo "Step 1: Attempting bulk API endpoint..."

TMP_BULK="$(mktemp)"
BULK_OK=0

if curl -fsSL \
    -H "User-Agent: $UA" \
    -H "Accept: application/json" \
    --max-time 30 \
    "$BULK_API_URL" \
    -o "$TMP_BULK" 2>/dev/null; then
  # Validate it's JSON with a non-empty list
  if node --input-type=module --eval "
import fs from 'node:fs';
try {
  const d = JSON.parse(fs.readFileSync('$TMP_BULK', 'utf8'));
  const list = d.list || d.nodes || d.data || [];
  process.exit(list.length > 0 ? 0 : 1);
} catch { process.exit(1); }
" 2>/dev/null; then
    echo "  Bulk API returned valid data — processing..."
    if process_bulk_json "$TMP_BULK"; then
      BULK_OK=1
      echo "  Bulk API processing succeeded."
    else
      echo "  Warning: Failed to process bulk API response."
    fi
  else
    echo "  Warning: Bulk API returned invalid or empty JSON."
  fi
else
  echo "  Warning: Bulk API request failed (likely 503 / blocked)."
fi

rm -f "$TMP_BULK"

# ─── Step 2: Per-module fallback from hardcoded list ──────────────────────────

if [ "$BULK_OK" -eq 0 ]; then
  echo ""
  echo "Step 2: Fetching per-module documentation for ${#POPULAR_MODULES[@]} popular modules..."
  echo "        Using: ${PER_MODULE_API}<module_name>"
  echo ""

  TMP_MOD_JSON="$(mktemp)"
  FETCHED=0
  FAILED=0

  for module in "${POPULAR_MODULES[@]}"; do
    printf "  %-35s " "${module}..."

    if curl -fsSL \
        -H "User-Agent: $UA" \
        -H "Accept: application/json" \
        --max-time 20 \
        "${PER_MODULE_API}${module}" \
        -o "$TMP_MOD_JSON" 2>/dev/null; then
      if process_module_json "$module" "$TMP_MOD_JSON" 2>/dev/null; then
        FETCHED=$((FETCHED + 1))
      else
        echo "  ✗ (could not process API response)"
        FAILED=$((FAILED + 1))
      fi
    else
      echo "  ✗ (curl failed)"
      FAILED=$((FAILED + 1))
    fi

    # Polite delay to avoid hammering Drupal.org
    sleep 0.4
  done

  rm -f "$TMP_MOD_JSON"

  echo ""
  echo "Per-module fetch complete: ${FETCHED} succeeded, ${FAILED} failed."

  if [ "$FETCHED" -eq 0 ]; then
    echo "Warning: All per-module fetches failed; writing fallback README."
    write_fallback
  fi
fi

# ─── Always fetch key AI ecosystem modules regardless of bulk API result ──────

AI_MODULES=(
  ai
  drupal_ai
)

echo ""
echo "Step 3: Fetching AI ecosystem modules (always fetched)..."
echo ""

TMP_AI_JSON="$(mktemp)"
AI_FETCHED=0
AI_FAILED=0

for module in "${AI_MODULES[@]}"; do
  printf "  %-35s " "${module}..."

  if curl -fsSL \
      -H "User-Agent: $UA" \
      -H "Accept: application/json" \
      --max-time 20 \
      "${PER_MODULE_API}${module}" \
      -o "$TMP_AI_JSON" 2>/dev/null; then
    if process_module_json "$module" "$TMP_AI_JSON" 2>/dev/null; then
      AI_FETCHED=$((AI_FETCHED + 1))
    else
      echo "  ✗ (could not process API response)"
      AI_FAILED=$((AI_FAILED + 1))
    fi
  else
    echo "  ✗ (curl failed)"
    AI_FAILED=$((AI_FAILED + 1))
  fi

  # Polite delay to avoid hammering Drupal.org
  sleep 0.4
done

rm -f "$TMP_AI_JSON"

echo ""
echo "AI ecosystem fetch complete: ${AI_FETCHED} succeeded, ${AI_FAILED} failed."

# ─── Summary ──────────────────────────────────────────────────────────────────

echo ""
MD_COUNT="$(find "$DEST_DIR" -maxdepth 1 -name '*.md' | wc -l | tr -d ' ')"
echo "Contrib modules fetch complete."
echo "Output directory : $DEST_DIR"
echo "Markdown files   : ${MD_COUNT}"
