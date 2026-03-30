---
status: planned
phase: implementation
completed_at: null
last_reviewed_at: 2026-03-30
depends_on: []
supersedes: []
related_artifacts: []
---

# Task 01: Repository Scaffold

## Depends On
- None

## Goal
Stand up the complete TypeScript project skeleton so that every subsequent task has a consistent, buildable foundation to work from. By the end of this task the repo compiles cleanly, `npm run build` succeeds, and the directory layout matches the plan exactly. No application logic is written yet — this task is purely structural scaffolding.

## Deliverables
- `package.json` with all runtime and dev dependencies declared
- `tsconfig.json` configured for Node16 module resolution, ES2022 target
- `.nvmrc` pinned to Node 20
- `.env.example` with all required env-var keys (empty values)
- `.gitignore` excluding `data/`, `node_modules/`, `dist/`, `.env`
- `README.md` — minimal placeholder describing the project
- All required directory stubs: `src/tools/`, `src/lib/`, `etl/`, `scripts/`, `data/sources/`, `data/lancedb/`, `tests/`, `plans/tasks/`
- Stub `src/index.ts` that compiles without errors (just a `console.error('server not yet implemented')`)
- `npm install` runs without errors
- `npm run build` exits 0 with zero TypeScript errors

## Implementation Steps

1. **Verify Node version**: `node --version` — must print `v20.x.x` or later. If not, switch via `nvm use 20` after installing NVM.

2. **Initialize git** (if not already done):
   ```bash
   git init
   git branch -M main
   ```

3. **Create `package.json`** at the project root with the following exact content:
   ```json
   {
     "name": "drupal-dev-mcp",
     "version": "0.1.0",
     "description": "Drupal Architect MCP Server — MVP",
     "main": "dist/src/index.js",
     "scripts": {
       "build": "tsc",
       "start": "node dist/src/index.js",
       "dev": "ts-node src/index.ts",
       "sync:sources": "bash scripts/sync-docs.sh",
       "etl:drupal-core-docs": "ts-node etl/run.ts",
       "etl:drupal-core-docs:dry-run": "ts-node etl/run.ts --dry-run",
       "typecheck": "tsc --noEmit"
     },
     "dependencies": {
       "@langchain/textsplitters": "^0.1.0",
       "@lancedb/lancedb": "^0.14.0",
       "@modelcontextprotocol/sdk": "^1.8.0",
       "apache-arrow": "^18.0.0",
       "better-sqlite3": "^9.4.0",
       "cheerio": "^1.0.0",
       "dotenv": "^16.4.0",
       "openai": "^4.77.0",
       "tiktoken": "^1.0.17",
       "zod": "^3.23.0"
     },
     "devDependencies": {
       "@types/better-sqlite3": "^7.6.0",
       "@types/node": "^20.0.0",
       "ts-node": "^10.9.2",
       "typescript": "^5.5.0"
     },
     "engines": {
       "node": ">=20.0.0"
     }
   }
   ```

4. **Create `tsconfig.json`**:
   ```json
   {
     "compilerOptions": {
       "target": "ES2022",
       "module": "Node16",
       "moduleResolution": "Node16",
       "outDir": "./dist",
       "rootDir": "./",
       "strict": true,
       "esModuleInterop": true,
       "skipLibCheck": true,
       "resolveJsonModule": true,
       "sourceMap": true
     },
     "include": ["src/**/*", "etl/**/*"],
     "exclude": ["node_modules", "dist", "data"]
   }
   ```

5. **Create `.nvmrc`** containing just:
   ```
   20
   ```

6. **Create `.env.example`**:
   ```dotenv
   OPENAI_API_KEY=
   LANCEDB_PATH=./data/lancedb
   ETL_SOURCES_DIR=./data/sources
   ETL_DRUPAL_CORE_BRANCH=11.x
   LOG_LEVEL=info
   ```

7. **Create `.env`** by copying `.env.example` and filling in your `OPENAI_API_KEY`:
   ```bash
   cp .env.example .env
   # Edit .env and set OPENAI_API_KEY=sk-...
   ```

8. **Create `.gitignore`**:
   ```
   # Dependencies
   node_modules/

   # Build output
   dist/

   # Local data (large files, not for VCS)
   data/

   # Environment secrets
   .env

   # macOS
   .DS_Store
   ```

9. **Create all directory stubs** (empty dirs need a `.gitkeep`):
   ```bash
   mkdir -p src/tools src/lib etl scripts data/sources data/lancedb tests plans/tasks
   touch src/tools/.gitkeep src/lib/.gitkeep data/sources/.gitkeep data/lancedb/.gitkeep tests/.gitkeep
   ```

10. **Create stub source files** so `tsc` has something to compile:

    `src/index.ts`:
    ```typescript
    // MCP server entry point — implementation in Task 10
    console.error('drupal-architect: server not yet implemented');
    ```

    `src/config.ts`:
    ```typescript
    // Configuration — implementation in Task 10
    export {};
    ```

11. **Create placeholder `README.md`**:
    ```markdown
    # drupal-dev-mcp — Drupal Architect MCP Server

    Local MCP server that answers Drupal backend development questions using a
    RAG pipeline backed by LanceDB (fully embedded — no server required) and the OpenAI API.

    ## Status
    🚧 Under construction — see `plans/mvp-implementation-plan.md` for full details.

    ## Prerequisites
    - Node.js 20 LTS (`nvm use 20`)
    - An OpenAI API key (set in `.env`)
    - `pandoc` >= 3.0 (`brew install pandoc`)
    - `git`
    ```

12. **Install dependencies**:
    ```bash
    npm install
    ```

13. **Verify compile**:
    ```bash
    npm run build
    ```

14. **Add everything to git**:
    ```bash
    git add .
    git commit -m "chore: scaffold TypeScript project structure"
    ```

## Verification / Done Criteria

Run these commands and confirm the expected output:

```bash
# Node version check
node --version
# Expected: v20.x.x or higher

# Dependency install (already done in step 12, re-run to confirm clean)
npm install
# Expected: exits 0, no errors. "up to date, audited N packages"

# TypeScript compile
npm run build
# Expected: exits 0. No output except possibly "tsc" — zero errors.

# Verify dist output exists
ls dist/src/
# Expected: index.js  config.js  (and .js.map files)

# Verify directory structure
ls src/ etl/ scripts/ data/sources/ data/lancedb/ tests/
# Expected: directories exist (may just show .gitkeep files)
```

## Notes / Gotchas

- **LanceDB is fully embedded**: The `@lancedb/lancedb` npm package runs entirely in-process — no server, no Docker, no external process needed. Data is stored in `data/lancedb/` as plain files on disk, exactly like SQLite. This is the key architectural advantage over server-based vector stores.
- **`apache-arrow` is a required peer dependency**: LanceDB uses Apache Arrow for its columnar data format. Always install `apache-arrow` alongside `@lancedb/lancedb`.
- **LanceDB native bindings**: LanceDB ships with native Rust/Node bindings. On macOS, Xcode Command Line Tools are required. Run `xcode-select --install` if install errors appear.
- **`module: "Node16"` requires `.js` extensions in imports**: When writing TypeScript files in later tasks, use `import ... from './foo.js'` (not `./foo`) in all import statements — this is required by the `Node16` module resolution strategy even for `.ts` source files. TypeScript resolves `.js` imports to the corresponding `.ts` source.
- **`better-sqlite3` is a native module**: It will compile from source during `npm install`. This is normal and expected; it requires a C++ compiler (included in Xcode CLT on macOS).
- **Do not commit `.env`**: The `.gitignore` excludes it. Only `.env.example` (with empty values) should be committed.
- **`data/` is git-ignored**: The `data/sources/` and `data/lancedb/` directories will hold gigabytes of downloaded content — they must never be committed to git.
