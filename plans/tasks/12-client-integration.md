---
status: planned
phase: implementation
completed_at: null
last_reviewed_at: 2026-03-30
depends_on: []
supersedes: []
related_artifacts: []
---

# Task 12: MCP Client Integration (Claude Desktop + Cursor)

## Depends On
- Task 10: MCP Server Bootstrap (compiled `dist/src/index.js` exists)
- Task 11: `ask_drupal_expert` Tool Handler (tool is fully implemented)
- Task 09: ETL Runner (LanceDB table is populated)

## Goal
Register the compiled MCP server in at least one MCP-compatible AI client (Claude Desktop or Cursor), restart the client, confirm the `ask_drupal_expert` tool appears in the tool picker, and send one test question from the UI. This is the first real "product" milestone — a developer can now type a Drupal question into their AI assistant and receive a sourced answer backed by the local LanceDB corpus (fully embedded, no server), with no internet search.

## Deliverables
- Claude Desktop config updated with the `drupal-architect` MCP server entry (absolute paths)
- OR Cursor `mcp.json` updated equivalently
- Client restarted and `ask_drupal_expert` visible in the tool picker
- One test question answered successfully from the client UI
- `tests/manual-test-questions.md` created with the 10 test questions from the MVP plan (for use in Task 13)
- Updated `README.md` with one-paragraph quickstart covering: ETL setup, LanceDB (no server needed), and client registration

## Implementation Steps

1. **Build the production binary** (if not already up to date):
   ```bash
   npm run build
   # Confirm dist/src/index.js exists
   ls -lh dist/src/index.js
   ```

2. **Get the absolute path to the project** — you need this for the config:
   ```bash
   pwd
   # e.g., /Users/yourname/Sites/drupals/drupal-dev-mcp
   ```

3. **Register in Claude Desktop** — edit the config file:

   **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
   **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

   Add the `drupal-architect` entry to the `mcpServers` object:
   ```json
   {
     "mcpServers": {
       "drupal-architect": {
         "command": "node",
         "args": ["/absolute/path/to/drupal-dev-mcp/dist/src/index.js"],
         "env": {
           "OPENAI_API_KEY": "sk-...",
           "LANCEDB_PATH": "/absolute/path/to/drupal-dev-mcp/data/lancedb",
           "ETL_SOURCES_DIR": "/absolute/path/to/drupal-dev-mcp/data/sources",
           "ETL_DRUPAL_CORE_BRANCH": "11.x",
           "OPENAI_SYNTHESIS_MODEL": "gpt-4o"
         }
       }
     }
   }
   ```

   > **Critical**: Use absolute paths for both the `args` binary path and the `env` values. Claude Desktop does not resolve relative paths from a working directory.

   > **Why env vars in config?** Claude Desktop launches the MCP server as a subprocess without loading your shell's environment. The `.env` file is not read automatically by the subprocess — all required variables must be provided in the `env` block.

4. **Register in Cursor** (alternative or in addition to Claude Desktop):

   **macOS**: `~/.cursor/mcp.json`
   ```json
   {
     "mcpServers": {
       "drupal-architect": {
         "command": "node",
         "args": ["/absolute/path/to/drupal-dev-mcp/dist/src/index.js"],
         "env": {
           "OPENAI_API_KEY": "sk-...",
           "LANCEDB_PATH": "/absolute/path/to/drupal-dev-mcp/data/lancedb",
           "OPENAI_SYNTHESIS_MODEL": "gpt-4o"
         }
       }
     }
   }
   ```

   > **No server to start**: LanceDB is fully embedded. The MCP server reads the database files directly from `LANCEDB_PATH` — no Docker, no background process needed.

5. **Restart the AI client** (Claude Desktop or Cursor) — fully quit and relaunch.

6. **Verify the tool appears**:
   - **Claude Desktop**: Click the tools/hammer icon in the chat input bar. `ask_drupal_expert` should be listed.
   - **Cursor**: In a chat/composer session, type `/` or look for tool options. The server should appear.

7. **Send a smoke-test question** from the client UI:
   > "Using the ask_drupal_expert tool: How do I implement a custom access checker as a tagged service in Drupal 11?"

   Confirm:
   - The tool is invoked (you see a tool call in the UI)
   - A Markdown response appears with code snippets and a `## Sources` section
   - The response does not contain hallucinated class names

8. **Create `tests/manual-test-questions.md`**:
   ```markdown
   # Drupal Architect MCP — Manual Test Questions

   Run these 10 questions through the `ask_drupal_expert` tool (via Claude Desktop or Cursor)
   and record the results. See Task 13 for pass/fail criteria.

   | # | Question | Status | Notes |
   |---|----------|--------|-------|
   | 1 | How do I implement a custom access checker as a tagged service? | ⬜ | |
   | 2 | What is the correct way to use `hook_entity_presave()` to alter a node before saving? | ⬜ | |
   | 3 | How does the Drupal plugin system work and what are plugin annotations? | ⬜ | |
   | 4 | How do I define a custom config entity type with a schema? | ⬜ | |
   | 5 | How do I load multiple entities by field value without using the Database API directly? | ⬜ | |
   | 6 | What cache tags should I use when rendering content that depends on a specific node? | ⬜ | |
   | 7 | How do I create a custom route with a dynamic parameter and access checking? | ⬜ | |
   | 8 | What is the difference between a source plugin and a process plugin in Drupal Migrate? | ⬜ | |
   | 9 | How do I subscribe to a Drupal event using an event subscriber class? | ⬜ | |
   | 10 | How do I use `hook_form_alter()` to add a custom validator to an existing form? | ⬜ | |

   ## Out-of-scope test
   | Q | Question | Expected response |
   |---|----------|-------------------|
   | OOS | How do I configure Nginx for a Drupal site? | "not in documentation context" — no hallucinated answer |

   ## Results legend
   - ✅ Pass: Correct API names, working code, cited sources, < 5s
   - ❌ Fail: Hallucinated names, wrong API, 404 URLs, or > 5s
   - ⬜ Not yet tested
   ```

9. **Update `README.md`** — replace the placeholder with a real quickstart:
    ```markdown
    # drupal-dev-mcp — Drupal Architect MCP Server

    A local MCP server that lets Claude Desktop, Cursor, and other MCP clients answer
    Drupal backend development questions with cited, accurate answers — no internet search,
    no hallucinated API signatures.

    Powered by **LanceDB** (fully embedded vector store — no server, no Docker) and the OpenAI API.

    ## Quick Start

    ### 1. Prerequisites
    - Node.js 20 LTS
    - An OpenAI API key
    - `pandoc` >= 3.0 (`brew install pandoc`)

    ### 2. Install
    ```bash
    npm install
    cp .env.example .env
    # Edit .env and add your OPENAI_API_KEY
    ```

    ### 3. Sync sources and run ETL (one-time, ~20–45 min)
    ```bash
    npm run sync:sources
    npm run etl:drupal-core-docs
    ```
    LanceDB data is written to `data/lancedb/` on disk — no server required.

    ### 4. Register in Claude Desktop
    Edit `~/Library/Application Support/Claude/claude_desktop_config.json`:
    ```json
    {
      "mcpServers": {
        "drupal-architect": {
          "command": "node",
          "args": ["/absolute/path/to/drupal-dev-mcp/dist/src/index.js"],
          "env": {
            "OPENAI_API_KEY": "sk-...",
            "LANCEDB_PATH": "/absolute/path/to/drupal-dev-mcp/data/lancedb"
          }
        }
      }
    }
    ```
    Restart Claude Desktop. Ask any Drupal backend question!
    ```

10. **Commit**:
    ```bash
    git add tests/manual-test-questions.md README.md
    git commit -m "docs: add client integration instructions, test questions, and README quickstart (LanceDB)"
    ```

## Verification / Done Criteria

```bash
# Confirm build is current
ls -lh dist/src/index.js

# Confirm LanceDB table is populated (no server needed — runs in-process)
npx ts-node -e "
require('dotenv').config();
const lancedb = require('@lancedb/lancedb');
async function check() {
  const db = await lancedb.connect(process.env.LANCEDB_PATH ?? './data/lancedb');
  const table = await db.openTable('drupal_core_docs');
  const n = await table.countRows();
  console.log('LanceDB rows in drupal_core_docs:', n);
}
check();
"
```

Then manually in Claude Desktop / Cursor:
1. Open the client and look for the tool picker — `ask_drupal_expert` must appear
2. Send: "Using ask_drupal_expert: How do I implement a custom access checker in Drupal?"
3. Confirm a non-empty Markdown response with a `## Sources` section is returned

**Done criteria**:
- `ask_drupal_expert` appears in the client's tool list
- Test question returns a Markdown answer with code snippets and citations
- `tests/manual-test-questions.md` created with all 10 questions
- `README.md` has a complete quickstart section

## Notes / Gotchas

- **All paths must be absolute in client configs**: Claude Desktop and Cursor launch MCP servers as subprocesses from an unspecified working directory. Relative paths like `./dist/src/index.js` will fail.
- **`OPENAI_API_KEY` and `LANCEDB_PATH` must be in the `env` block**: The subprocess does not inherit your shell environment or read `.env`. Every required variable must be explicitly listed in the client config's `env` block.
- **No server to manage**: LanceDB is fully embedded. The MCP server reads vector data directly from `LANCEDB_PATH` on disk — there is nothing to start, stop, or Docker-run before launching the client.
- **Dev mode alternative**: To avoid rebuilding after every code change during development, use `ts-node` in the client config:
  ```json
  {
    "command": "npx",
    "args": ["ts-node", "/absolute/path/to/drupal-dev-mcp/src/index.ts"],
    "env": {
      "OPENAI_API_KEY": "sk-...",
      "LANCEDB_PATH": "/absolute/path/to/drupal-dev-mcp/data/lancedb"
    }
  }
  ```
  This is slower to start (~2–3s) but requires no build step.
- **Claude Desktop logs**: If the server doesn't appear, check `~/Library/Logs/Claude/mcp*.log` on macOS for startup errors.
- **Cursor MCP config location**: Cursor's `mcp.json` location may vary — check Cursor's settings under Features → MCP if the above path doesn't work. Cursor 0.44+ supports MCP natively.
- **Multiple MCP servers**: If you already have other MCP servers in your client config, add the `drupal-architect` entry to the existing `mcpServers` object — do not replace the whole file.
