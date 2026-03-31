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

### RooCode Custom Mode

Add the following entry to your RooCode `.roomodes` file to enable the repository-aware planning specialist:

```yaml
customModes:
  - slug: drupal-planner
    name: "🧭 Drupal Planner"
    description: "Drupal architecture planning specialist grounded in local MCP evidence."
    roleDefinition: >-
      You are the 🧭 Drupal Planner for the drupal-dev-mcp repository. Deliver Drupal architecture roadmaps that stay within planning scope and ground every recommendation in MCP evidence before suggesting execution tasks.
    entryPoint: null
    supportedConfigs:
      - client: "roo"
        transport: "native"
    customInstructions: |-
      Follow the workflow codified in ./.clinerules-drupal-planner.

      Mandatory research sequence:
      1. Start with `search_drupal_docs` to gather canonical references.
      2. Review `drupal_skill_guide` to align with Drupal best practices.
      3. Use `deep_research_drupal` for multi-domain or high-stakes investigations.
      4. Conclude with `ask_drupal_expert` to synthesize findings with explicit citations.

      Document any skipped step with justification and contingency.

      Produce structured planning briefs only. Separate sections for: evidence digest with citations, assumptions, open questions, risk register, impacted subsystems, proposed files/config entities, validation steps, and next implementation tasks. Never output executable code.
    defaultAlwaysAllow:
      - ask_drupal_expert
      - search_drupal_docs
      - drupal_skill_guide
      - deep_research_drupal
    groups:
      - read
      - mcp
```

> The mode relies on the MCP tools exported by [`src/index.ts`](src/index.ts:1). Ensure your AI client registers this MCP server and permits the `alwaysAllow` list above so the mode can enforce its evidence-first workflow.

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
| `npm run research:sources` | Generate source inventory & recommendations |
| `npm run research:tools` | Generate tool inventory & recommendations |
| `npm run typecheck` | Type-check without emitting |

## Research Maintenance Scripts

### `research-sources`

Generates a current-source inventory and recommendation report without mutating fetch/ETL configs.

```bash
npm run research:sources
```

Outputs written to `data/cache/research-sources/`:

| File | Description |
| --- | --- |
| `discovery.json` | Deterministic source inventory snapshot |
| `evaluation.json` | Scored assessments & summary metadata |
| `recommendations.md` | Human-readable review brief |

Pass `--llm-summary` to request an optional GPT summary (requires `OPENAI_API_KEY`).

```bash
npx tsx scripts/research-sources.ts --llm-summary --output data/cache/research-sources
```

For validation during development run:

```bash
npm run test:research-sources
```


### `research-tools`

Audits current tool surfaces, shared retrieval logic, and benchmarks to produce recommendation-only outputs.

```bash
npm run research:tools
```

Outputs written to `data/cache/research-tools/`:

| File | Description |
| --- | --- |
| `inventory.json` | Deterministic tool inventory snapshot |
| `evaluation.json` | Scored assessments, duplicate identifiers, optional summary |
| `recommendations.md` | Human-readable review brief |

Pass `--llm-summary` to request an optional GPT summary (requires `OPENAI_API_KEY`).

```bash
npx tsx scripts/research-tools.ts --llm-summary --output data/cache/research-tools
```


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

## Documentation Sources

The RAG index is built from a broad mix of primary Drupal references, ecosystem handbooks, and adjacent platform material:

- **Drupal API Reference (api.drupal.org)** — Canonical function, hook, and service documentation scraped by [`scripts/fetch-api-drupal-org.sh`](scripts/fetch-api-drupal-org.sh:1) and parsed via [`etl/parse-api-drupal-org.ts`](etl/parse-api-drupal-org.ts:1) to ground answers in the same source core developers rely on.
- **Drupal Change Records** — Release-by-release behavioral notes fetched through [`scripts/fetch-change-records.sh`](scripts/fetch-change-records.sh:1) and normalized by [`etl/parse-change-records.ts`](etl/parse-change-records.ts:1), ensuring upgrades and regressions are reflected.
- **Drupal Core Module Source Code** — Parsed with [`etl/parse-core-module-code.ts`](etl/parse-core-module-code.ts:1) so the assistant can quote real implementations, service definitions, and annotations when docs are thin.
- **Drupal Contrib Module Source Code** — Ingested by [`scripts/fetch-contrib-module-code.sh`](scripts/fetch-contrib-module-code.sh:1) and [`etl/parse-contrib-module-code.ts`](etl/parse-contrib-module-code.ts:1) to surface production-ready patterns from widely used extensions.
- **Contrib Module README & Handbook Content** — Combined via [`scripts/fetch-contrib-modules.sh`](scripts/fetch-contrib-modules.sh:1), [`scripts/fetch-contrib-module-handbook.ts`](scripts/fetch-contrib-module-handbook.ts:1), and their parsers [`etl/parse-contrib-modules.ts`](etl/parse-contrib-modules.ts:1) and [`etl/parse-contrib-module-handbook.ts`](etl/parse-contrib-module-handbook.ts:1) to explain module configuration and usage beyond code.
- **Drupal Module Developer Handbook** — Pulled through [`scripts/fetch-drupal-module-handbook.ts`](scripts/fetch-drupal-module-handbook.ts:1) and structured by [`etl/parse-drupal-module-handbook.ts`](etl/parse-drupal-module-handbook.ts:1) to cover official best practices for building custom modules.
- **Drupal Developer Guides** — Captured with [`scripts/fetch-developer-guides.sh`](scripts/fetch-developer-guides.sh:1) and parsed in [`etl/parse-developer-guides.ts`](etl/parse-developer-guides.ts:1) for narrative guidance on modern Drupal workflows.
- **Drupal Tutorials & How-To Articles** — Harvested through [`scripts/fetch-tutorials.sh`](scripts/fetch-tutorials.sh:1) and [`scripts/fetch-drupal-tutorial-articles.ts`](scripts/fetch-drupal-tutorial-articles.ts:1), then distilled by [`etl/parse-tutorials.ts`](etl/parse-tutorials.ts:1) to provide step-by-step instructions for real-world tasks.
- **Drupal Examples Project** — Mirrored by [`scripts/fetch-drupal-examples.sh`](scripts/fetch-drupal-examples.sh:1) and parsed through [`etl/parse-drupal-examples.ts`](etl/parse-drupal-examples.ts:1) to supply runnable reference implementations of common patterns.
- **Drupal Best Practices Guide** — Synced with [`scripts/fetch-best-practices.sh`](scripts/fetch-best-practices.sh:1) and segmented by [`etl/parse-best-practices.ts`](etl/parse-best-practices.ts:1) to codify architectural recommendations validated by the community.
- **PHP Manual** — Downloaded via [`scripts/fetch-php-manual.sh`](scripts/fetch-php-manual.sh:1) and indexed by [`etl/parse-php-manual.ts`](etl/parse-php-manual.ts:1) so the assistant can clarify core language behavior underpinning Drupal APIs.
- **Symfony Documentation** — Gathered with [`scripts/fetch-symfony-docs.sh`](scripts/fetch-symfony-docs.sh:1) and processed by [`etl/parse-symfony.ts`](etl/parse-symfony.ts:1) to explain the Symfony components Drupal builds upon (routing, services, events).
- **Acquia Certification Study Guides** — Fetched through [`scripts/fetch-certification-docs.sh`](scripts/fetch-certification-docs.sh:1) and [`scripts/fetch-acquia-certification-study-guides.ts`](scripts/fetch-acquia-certification-study-guides.ts:1), then parsed by [`etl/parse-certification-docs.ts`](etl/parse-certification-docs.ts:1) to reinforce exam-aligned competencies.

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
