# drupal-dev-mcp

**Drupal Architect MCP Server** — A RAG-powered Drupal documentation assistant that runs locally as an MCP (Model Context Protocol) server.

## What It Does

Exposes a single tool — `ask_drupal_expert` — that searches a local vector database of official Drupal 11 documentation and synthesizes expert answers using GPT-4o. No internet search, no cloud databases — just local LanceDB + OpenAI API.

**Covers**: hooks, services, dependency injection, entity API, form API, routing, config management, caching, plugins, migrations, events, Drupal/Symfony patterns.

## Prerequisites

- **Node.js** ≥ 20.0.0 (pin with `.nvmrc`: `nvm use`)
- **OpenAI API key** ([platform.openai.com](https://platform.openai.com))
- **pandoc** ≥ 3.0 (`brew install pandoc`) — for User Guide conversion
- **git** — for cloning Drupal core

## Quick Start

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env and set OPENAI_API_KEY=sk-...
```

### 3. Download documentation sources

```bash
npm run sync:sources
```

This clones Drupal core (shallow, ~300 MB) and downloads the User Guide.

### 4. Run the ETL pipeline

```bash
# Dry run first (no API calls, no cost):
npm run build && node dist/etl/run.js --dry-run

# Full run (~$0.03, takes 2-5 minutes):
npm run build && node dist/etl/run.js
```

### 5. Build the server

```bash
npm run build
```

### 6. Register in your AI client

See [Client Configuration](#client-configuration) below.

## Client Configuration

### Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "drupal-dev-mcp": {
      "command": "node",
      "args": ["/path/to/drupal-dev-mcp/dist/src/index.js"],
      "env": {
        "OPENAI_API_KEY": "your_openai_api_key_here",
        "LANCEDB_PATH": "/path/to/drupal-dev-mcp/data/lancedb",
        "ETL_SOURCES_DIR": "/path/to/drupal-dev-mcp/data/sources",
        "ETL_DRUPAL_CORE_BRANCH": "11.x",
        "OPENAI_SYNTHESIS_MODEL": "gpt-4o"
      }
    }
  }
}
```

> **Replace `/path/to/drupal-dev-mcp`** with the absolute path to your local clone, and set `OPENAI_API_KEY` to your real key from [platform.openai.com](https://platform.openai.com/api-keys).

### Cursor

Edit `~/.cursor/mcp.json` with the same structure as above.

### Verify

After restarting your AI client:
1. The `ask_drupal_expert` tool should appear in the tool picker
2. Ask: "How do I implement a custom access checker in Drupal?"
3. You should receive a Markdown answer with `## Sources` section

## Project Structure

```text
drupal-dev-mcp/
├── src/
│   ├── index.ts              # MCP server entry point
│   ├── config.ts             # Environment config loader
│   ├── lib/
│   │   ├── lancedb.ts        # LanceDB vector search helpers
│   │   └── openai.ts         # OpenAI embed + chat helpers
│   └── tools/
│       └── ask-drupal-expert.ts  # RAG tool handler
├── etl/
│   ├── run.ts                # ETL pipeline runner
│   ├── parser.ts             # PHPDoc + Docset + User Guide parsers
│   ├── chunker.ts            # Text splitter with SHA-256 IDs
│   ├── embedder.ts           # Batched OpenAI embeddings
│   └── loader.ts             # LanceDB loader
├── scripts/
│   └── sync-docs.sh          # Source download script
├── data/
│   ├── sources/              # Downloaded documentation (git-ignored)
│   └── lancedb/              # Vector database (git-ignored)
└── tests/
    └── manual-test-questions.md
```

## NPM Scripts

| Script | Description |
|--------|-------------|
| `npm run build` | Compile TypeScript to `dist/` |
| `npm run sync:sources` | Download/update documentation sources |
| `node dist/etl/run.js` | Run full ETL pipeline |
| `node dist/etl/run.js --dry-run` | ETL dry run (no API calls) |
| `npm start` | Start MCP server (stdio transport) |
| `npm run typecheck` | Type-check without emitting |

## Cost Estimates

- **ETL (one-time)**: ~$0.03 for embedding ~40K chunks
- **Per question**: ~$0.02 (GPT-4o) or ~$0.001 (GPT-4o-mini)
- **1,000 questions**: ~$18 (GPT-4o) or ~$1 (GPT-4o-mini)

Set `OPENAI_SYNTHESIS_MODEL=gpt-4o-mini` in `.env` for cheaper development testing.

## Tech Stack

- **TypeScript** (Node 20 LTS)
- **LanceDB** — Fully embedded vector database (no server, no Docker)
- **OpenAI** — text-embedding-3-small + GPT-4o
- **MCP SDK** — Model Context Protocol for AI client integration

## Developer Guides Integration

The **Drupal Developer Guides** are now included as a new dataset in the ETL pipeline.

### Steps to Ingest Developer Guides

1. **Fetch the guides**:
   ```bash
   ./scripts/fetch-developer-guides.sh
   ```

2. **Parse the guides**:
   ```bash
   npx tsx etl/parse-developer-guides.ts
   ```

3. **Chunk and embed**:
   ```bash
   npx tsx etl/chunker.ts data/parsed/developer-guides.json
   npx tsx etl/embedder.ts data/chunks/developer-guides.json
   ```

4. **Load into LanceDB**:
   ```bash
   LANCEDB_TABLE_NAME=drupal_developer_guides npx tsx etl/loader.ts data/embedded/developer-guides.json
   ```

5. **Verify**:
   ```bash
   npx tsx etl/verify-developer-guides.ts
   ```

The `ask_drupal_expert` tool now queries across **Core Docs**, **User Guide**, and **Developer Guides** datasets for comprehensive answers.
