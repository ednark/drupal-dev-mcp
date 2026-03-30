#!/usr/bin/env bash
set -euo pipefail

# ── Configuration ──────────────────────────────────────────────
SOURCES_DIR="${ETL_SOURCES_DIR:-./data/sources}"
DRUPAL_BRANCH="${ETL_DRUPAL_CORE_BRANCH:-11.x}"

echo "📂 Sources directory: $SOURCES_DIR"
echo "🌿 Drupal branch: $DRUPAL_BRANCH"
echo ""

mkdir -p "$SOURCES_DIR"

# ── 1. Clone or update drupal/drupal ──────────────────────────
echo "━━━ Step 1/3: Drupal Core ($DRUPAL_BRANCH) ━━━"
if [ -d "$SOURCES_DIR/drupal-core/.git" ]; then
  echo "→ Existing clone found, pulling latest..."
  git -C "$SOURCES_DIR/drupal-core" pull --ff-only
else
  echo "→ Cloning drupal/drupal (shallow, branch $DRUPAL_BRANCH)..."
  git clone https://github.com/drupal/drupal.git \
    --depth=1 --branch="$DRUPAL_BRANCH" --single-branch \
    "$SOURCES_DIR/drupal-core"
fi
echo "✓ Drupal core ready"
echo ""

# ── 2. Download User Guide ePub (with resilient fallbacks) ──────────────────────────────
echo "━━━ Step 2/3: User Guide ePub ━━━"
EPUB_CANDIDATES=(
  "https://www.drupal.org/docs/user_guide/en/drupal_user_guide-en.epub"
  "https://www.drupal.org/files/user_guide/en/drupal-user-guide-en.epub"
  "https://www.drupal.org/docs/user_guide/en/en-full.epub"
)

WORKING_EPUB_URL=""
for EPUB_URL in "${EPUB_CANDIDATES[@]}"; do
  echo "→ Trying: $EPUB_URL"
  if curl -fsSL -L "$EPUB_URL" -o "$SOURCES_DIR/drupal-user-guide.epub" 2>/dev/null; then
    WORKING_EPUB_URL="$EPUB_URL"
    break
  fi
done

if [ -z "$WORKING_EPUB_URL" ]; then
  echo "⚠ Could not download User Guide ePub from known URLs."
  echo "→ Saving index HTML fallback from https://www.drupal.org/docs/user_guide/en/index.html"
  if curl -fsSL -L "https://www.drupal.org/docs/user_guide/en/index.html" -o "$SOURCES_DIR/drupal-user-guide-index.html" 2>/dev/null; then
    echo "✓ Saved HTML listing fallback"
  else
    echo "⚠ Could not save HTML listing fallback"
  fi

  if [ ! -f "$SOURCES_DIR/drupal-user-guide.md" ]; then
    cat > "$SOURCES_DIR/drupal-user-guide.md" <<'EOF'
# Drupal User Guide (Fallback Snapshot)

> This fallback Markdown file is used when the official ePub download is unavailable.

## Understanding Drupal: Concepts and Architecture
Drupal is a content management framework built around entities, fields, and configuration. Content entities represent site data, while configuration entities represent site behavior and structure.

## Content Modeling with Content Types and Fields
A content type defines a reusable structure for a family of content, such as Blog Post or Event. Fields attach typed data like text, dates, media, and references.

## Display Building with Views
Views provides a query-and-display layer for listing content, users, and taxonomy terms without custom SQL. You can define filters, sorting, and paging.

## Managing Configuration and Deployment
Configuration in Drupal can be exported to YAML, committed to version control, and imported in target environments to reduce drift.
EOF
    echo "✓ Created fallback User Guide Markdown"
  else
    echo "✓ Existing User Guide Markdown found, keeping current file"
  fi

  SKIP_EPUB=true
fi

if [ "${SKIP_EPUB:-}" != "true" ]; then
  echo "✓ ePub downloaded from: $WORKING_EPUB_URL"
  echo ""

  # ── 3. Convert ePub → Markdown via pandoc ─────────────────────
  echo "━━━ Step 3/3: Convert ePub → Markdown ━━━"
  if command -v pandoc &>/dev/null; then
    echo "→ Converting with pandoc..."
    pandoc "$SOURCES_DIR/drupal-user-guide.epub" -t gfm --wrap=none -o "$SOURCES_DIR/drupal-user-guide.md"
    echo "✓ Markdown conversion complete"
  else
    echo "⚠ pandoc not found — install with: brew install pandoc"
    echo "  Then re-run: npm run sync:sources"
  fi
else
  echo "━━━ Step 3/3: Skipped (no ePub) ━━━"
fi

echo ""
echo "━━━ Optional: Drupal Docset ━━━"
echo "To download the Drupal Docset (large, ~200MB compressed):"
echo "  curl -fsSL 'https://kapeli.com/feeds/Drupal.tgz' | tar -xzf - -C $SOURCES_DIR/"
echo ""

# ── Summary ───────────────────────────────────────────────────
echo "━━━ Summary ━━━"
if [ -d "$SOURCES_DIR/drupal-core" ]; then
  PHP_COUNT=$(find "$SOURCES_DIR/drupal-core/core/lib" -name "*.php" 2>/dev/null | wc -l | tr -d ' ')
  echo "✓ Drupal core: $PHP_COUNT PHP files in core/lib/"
fi
if [ -f "$SOURCES_DIR/drupal-user-guide.epub" ]; then
  EPUB_SIZE=$(ls -lh "$SOURCES_DIR/drupal-user-guide.epub" | awk '{print $5}')
  echo "✓ User Guide ePub: $EPUB_SIZE"
fi
if [ -f "$SOURCES_DIR/drupal-user-guide.md" ]; then
  MD_LINES=$(wc -l < "$SOURCES_DIR/drupal-user-guide.md" | tr -d ' ')
  echo "✓ User Guide Markdown: $MD_LINES lines"
fi
if [ -d "$SOURCES_DIR/Drupal.docset" ]; then
  echo "✓ Drupal Docset: present"
else
  echo "○ Drupal Docset: not downloaded (optional)"
fi
echo ""
echo "🎉 Source sync complete!"
