---
status: planned
phase: implementation
completed_at: null
last_reviewed_at: 2026-03-30
depends_on: []
supersedes: []
related_artifacts: []
---

# Task 03: Source Sync Script

## Depends On
- Task 01: Repository Scaffold

## Goal
Create and verify the shell script that downloads all documentation sources to `data/sources/`. This is the **only** task that touches the network during ETL — once sources are on disk, all subsequent parsing tasks work entirely locally. Getting this right first means the three parser tasks (04, 05, 06) can run without network access and produce deterministic input.

## Deliverables
- `scripts/sync-docs.sh` — executable shell script that: shallow-clones `drupal/drupal` at branch `11.x`, downloads the Drupal User Guide ePub from drupal.org, converts the ePub to GitHub-Flavored Markdown via `pandoc`
- `data/sources/drupal-core/` — populated git checkout (shallow clone of drupal/drupal branch 11.x)
- `data/sources/drupal-user-guide.epub` — downloaded ePub file
- `data/sources/drupal-user-guide.md` — pandoc-converted Markdown (multi-megabyte file)
- `npm run sync:sources` wired up in `package.json` (already declared in Task 01 — verify it works)
- Optional manual step documented: how to download the Drupal Docset for Task 05

## Implementation Steps

1. **Verify system dependencies** before writing the script:
   ```bash
   git --version          # Any recent version is fine
   pandoc --version       # Must be >= 3.0
   curl --version         # Should be present on macOS by default
   ```
   If `pandoc` is missing: `brew install pandoc` (macOS) or `apt install pandoc` (Ubuntu).

2. **Create `scripts/sync-docs.sh`** with the following content:
   ```bash
   #!/usr/bin/env bash
   set -euo pipefail

   SOURCES_DIR="${ETL_SOURCES_DIR:-./data/sources}"
   DRUPAL_BRANCH="${ETL_DRUPAL_CORE_BRANCH:-11.x}"

   mkdir -p "$SOURCES_DIR"

   echo "=== Syncing Drupal Core source ($DRUPAL_BRANCH) ==="
   if [ -d "$SOURCES_DIR/drupal-core/.git" ]; then
     echo "  → Pulling existing clone..."
     git -C "$SOURCES_DIR/drupal-core" pull --ff-only
   else
     echo "  → Cloning drupal/drupal ($DRUPAL_BRANCH)..."
     git clone https://github.com/drupal/drupal.git \
       --depth=1 \
       --branch="$DRUPAL_BRANCH" \
       --single-branch \
       "$SOURCES_DIR/drupal-core"
   fi

   echo ""
   echo "=== Downloading Drupal User Guide ePub ==="
   curl -fsSL \
     "https://www.drupal.org/docs/user_guide/en/en.epub" \
     -o "$SOURCES_DIR/drupal-user-guide.epub"
   echo "  → Downloaded to $SOURCES_DIR/drupal-user-guide.epub"

   echo ""
   echo "=== Converting ePub → Markdown via pandoc ==="
   pandoc "$SOURCES_DIR/drupal-user-guide.epub" \
     -t gfm \
     --wrap=none \
     -o "$SOURCES_DIR/drupal-user-guide.md"
   echo "  → Converted to $SOURCES_DIR/drupal-user-guide.md"

   echo ""
   echo "=== Sync complete. Sources in $SOURCES_DIR ==="
   echo "  ✓ drupal-core/     (git checkout of drupal/drupal@$DRUPAL_BRANCH)"
   echo "  ✓ drupal-user-guide.epub"
   echo "  ✓ drupal-user-guide.md"
   echo ""
   echo "  Run 'npm run etl:drupal-core-docs' to parse, embed, and load."
   echo ""
   echo "  Optional: Download the Drupal Docset manually for extra coverage:"
   echo "    curl -fsSL 'https://kapeli.com/feeds/Drupal.tgz' -o data/sources/drupal.docset.tgz"
   echo "    tar -xzf data/sources/drupal.docset.tgz -C data/sources/"
   ```

3. **Make the script executable**:
   ```bash
   chmod +x scripts/sync-docs.sh
   ```

4. **Run the sync**:
   ```bash
   npm run sync:sources
   ```
   This will take several minutes — the Drupal core shallow clone is ~300–500 MB and the ePub download + pandoc conversion adds another minute. Progress is printed to stdout.

5. **Optional — Drupal Docset** (for Task 05): The Docset is a large file (~2 GB) and is not downloaded automatically by the sync script. If you want Docset coverage in your ETL, run manually:
   ```bash
   curl -fsSL "https://kapeli.com/feeds/Drupal.tgz" \
     -o data/sources/drupal.docset.tgz
   tar -xzf data/sources/drupal.docset.tgz -C data/sources/
   # Verify:
   ls data/sources/Drupal.docset/Contents/Resources/
   # Expected: docSet.dsidx  Documents/
   ```
   If you skip this step, Task 05 will still run but will produce zero docset pages (the ETL runner gracefully skips missing sources).

## Verification / Done Criteria

Run these checks after `npm run sync:sources` completes:

```bash
# 1. Verify drupal-core is present and is a git repo
ls data/sources/drupal-core/
# Expected: lots of Drupal files — composer.json, core/, modules/, etc.

git -C data/sources/drupal-core log --oneline -1
# Expected: one commit hash + message (shallow clone has only 1 commit)

# 2. Verify the ePub was downloaded
ls -lh data/sources/drupal-user-guide.epub
# Expected: file size > 1 MB

# 3. Verify the Markdown file was generated
ls -lh data/sources/drupal-user-guide.md
# Expected: file size > 3 MB (often 5–10 MB)

wc -l data/sources/drupal-user-guide.md
# Expected: > 5,000 lines

head -50 data/sources/drupal-user-guide.md
# Expected: Markdown headings and content about the Drupal User Guide

# 4. Verify PHP files are present in drupal-core for the parser
find data/sources/drupal-core/core/lib -name "*.php" | wc -l
# Expected: > 1,000 PHP files
```

## Notes / Gotchas

- **Re-running the script is safe**: The script checks for an existing clone (`-d "$SOURCES_DIR/drupal-core/.git"`) and does a `pull --ff-only` instead of a fresh clone. The ePub download and pandoc conversion always re-run — this is intentional so they stay up to date.
- **`--ff-only` may fail if the remote branch was force-pushed**: Drupal's release branches are not normally force-pushed, but if you hit this, delete `data/sources/drupal-core/` and re-run the sync.
- **Shallow clone depth=1**: The `--depth=1` flag means only the latest commit is downloaded, not the full git history. This keeps the download fast (~300 MB vs ~1 GB+ for a full clone). The PHPDoc parser in Task 04 only reads file content, not git history, so this is fine.
- **pandoc ePub conversion**: The `gfm` (GitHub-Flavored Markdown) output format works well for our chunker. The `--wrap=none` flag prevents pandoc from inserting hard line breaks at 80 characters — this is important because it keeps paragraphs as single lines, which the chunker handles better.
- **drupal.org ePub URL**: The URL `https://www.drupal.org/docs/user_guide/en/en.epub` may change between major Drupal User Guide versions. If `curl` returns a 404, check the Drupal User Guide page at `https://www.drupal.org/docs/user_guide/en` for the current download link.
- **Docset size**: The `Drupal.tgz` file from kapeli.com is large (compressed ~200 MB, extracted ~2 GB). Only download it if you have the disk space and want the extra symbol coverage it provides.
- **Data directory is git-ignored**: Running the sync script will produce files in `data/` which is excluded by `.gitignore`. This is expected — document sources are not version-controlled.
