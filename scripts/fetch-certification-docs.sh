#!/usr/bin/env bash
set -euo pipefail

DEST_DIR="data/sources/certification"
mkdir -p "$DEST_DIR"

README_PATH="$DEST_DIR/README.md"

cat > "$README_PATH" <<'EOF'
# Certification & Training Docs

Place PDF, ePub, or Markdown files here for indexing.
Supported formats: .md, .txt, .pdf (requires pdftotext), .epub (requires pandoc)

Environment variable: set TRAINING_DOCS_PATH to auto-import from another directory.
EOF

if find "$DEST_DIR" -maxdepth 5 -type f \( -iname '*.md' -o -iname '*.txt' -o -iname '*.pdf' -o -iname '*.epub' \) | grep -v -E '/README\.md$' | grep -q .; then
  echo "Certification docs already present in $DEST_DIR; nothing to do."
  exit 0
fi

if [ -n "${TRAINING_DOCS_PATH:-}" ] && [ -d "$TRAINING_DOCS_PATH" ]; then
  echo "Importing training docs from $TRAINING_DOCS_PATH"
  while IFS= read -r src_file; do
    rel="${src_file#${TRAINING_DOCS_PATH}/}"
    target="$DEST_DIR/$rel"
    mkdir -p "$(dirname "$target")"

    if ln -sf "$src_file" "$target" 2>/dev/null; then
      :
    else
      cp -f "$src_file" "$target"
    fi
  done < <(find "$TRAINING_DOCS_PATH" -type f \( -iname '*.md' -o -iname '*.txt' -o -iname '*.pdf' -o -iname '*.epub' \))

  echo "Certification docs import complete."
  exit 0
fi

echo "No existing certification docs detected and TRAINING_DOCS_PATH not set."

