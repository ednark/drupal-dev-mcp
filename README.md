# drupal-dev-mcp 0.2

Read-only Drupal development knowledge for MCP clients, with reasoning kept outside the server.

Version 0.2 is a clean-break redesign with three private npm workspaces:

- `@drupal-dev-mcp/knowledge` builds and queries a versioned SQLite, FTS5, semantic-graph, and optional LanceDB index.
- `@drupal-dev-mcp/server` exposes seven deterministic MCP tools (six retrieval tools plus one opt-in synthesis tool) and three resource surfaces over a `KnowledgeProvider`.
- `@drupal-dev-mcp/agent` contains optional OpenAI-backed answer and iterative-research workflows as a library, CLI, and the engine behind the server's `ask_a_drupal_expert` tool.

The retrieval tools do not synthesize advice; `ask_a_drupal_expert` is the single explicit exception, gated on its own API key. The server never runs indexing, executes commands, fetches arbitrary URLs, or mutates the workspace.

## Quick start

Requirements: Node.js 20+, npm 10+, Git, and enough local disk for two Drupal core checkouts and the generated index.

```bash
npm install
npm run build
npm run index:fetch
npm run index:rebuild
npm run index:verify
npm run mcp:start
```

The active build defaults to Drupal 11.4. Every query can target Drupal 10.6 or request an explicit cross-version search.

Embeddings are optional. Without them, search remains fully operational through SQLite FTS5 and returns `degraded_mode: "lexical_only"`. To create the unified LanceDB table, explicitly authorize sending indexed chunk text to the configured embedding provider and run:

```bash
npm run index:rebuild -- --with-embeddings
```

## MCP surface

The stdio server exposes six read-only, non-destructive, idempotent, closed-world retrieval tools plus one opt-in synthesis tool:

- `search_drupal` — searches evidence using version, mode, project, source type, entity kind, limit, snippet-budget, and relevance-floor (`min_score`) filters. Short keyword/identifier queries score best; semantic hits carry chunk-level citation URIs. Ordering is deterministic within an index build. `source_types: ["guidance"]` narrows to the curated change-placement corpus (where a change should live).
- `get_drupal_entity` — resolves an opaque `ent_…` ID or exact identifier and returns disambiguation, metadata, deprecations, evidence, and relationships.
- `get_drupal_entities` — resolves up to 25 opaque `ent_…` IDs in one call; unknown IDs are reported per item instead of failing the batch.
- `explore_drupal_relationships` — traverses evidence-backed graph edges with predicate, direction, depth, confidence, and node limits.
- `get_drupal_document` — returns the exact indexed text of a document or a single chunk, for verifying citations against source without re-searching.
- `get_index_status` — reports the active verified build: readiness, build date, versions, counts, and verification.
- `ask_a_drupal_expert` *(opt-in synthesis)* — evidence-grounded answers to questions that need conclusions rather than retrieval ("where do style changes live?", "when is a custom theme warranted?", "how should I migrate this site?"). Runs in two modes: `depth: "ask"` (one evidence round) and `depth: "research"` (iterative multi-query rounds). Every claim is cited with `drupal://` URIs; questions it cannot ground return `insufficient_evidence` instead of guesses. Requires `OPENAI_API_KEY` in the MCP client's env for this server — without it the tool returns `status: "unavailable"` and all other tools keep working. This tool exists as the worked example of turning indexed sources into grounded decisions; the six retrieval tools remain pure-evidence.

Every successful result includes a stable resource URI, version compatibility, provenance, authority, and freshness. Graph traversal defaults to confidence `>= 0.7`.

Resources:

```text
drupal://index/status
drupal://entity/{id}
drupal://document/{id}
drupal://document/{id}#chunk/{chunkId}
```

Running your own agent loop around this server? See [docs/integration-agent-loops.md](docs/integration-agent-loops.md) for the canonical client config, annotation-based policy mapping, recommended call patterns, and token-budgeting knobs.

Example MCP client entry after `npm run build`:

```json
{
  "mcpServers": {
    "drupal-dev-mcp": {
      "command": "node",
      "args": ["/absolute/path/to/drupal-dev-mcp/packages/server/dist/index.js"],
      "env": {
        "DRUPAL_MCP_INDEX_ROOT": "/absolute/path/to/drupal-dev-mcp/data/index"
      }
    }
  }
}
```

## Maintainer commands

```bash
npm run index:fetch       # refresh all git-based sources (core snapshots, contrib code, examples, skills, symfony docs); -- --core-only for core snapshots alone
npm run index:build       # build and atomically activate a verified index
npm run index:verify      # verify active SQLite integrity and references
npm run index:rebuild     # clean full-index build; no old-index migration
npm run index:status      # report active run, counts, versions, and warnings
npm run index:freshness   # compare data/sources against the active build; exit 1 when sources need re-processing
npm run index:benchmark   # run the 20-question top-five evidence gate
npm run typecheck
npm test
```

Builds live under `data/index/builds/{run-id}`. A build becomes active only after verification passes and `data/index/active.json` is atomically replaced. A failed build leaves the prior active manifest untouched.

## Optional agent

The agent package receives evidence only through `KnowledgeProvider` and explicitly reports insufficient evidence. Synthesis prompts enforce strict grounding (evidence-only claims, chunk-level `drupal://` citations, source-authority weighting, version and deprecation awareness); the research loop tracks already-executed queries and generates short keyword-style follow-ups. Tool calls, admitted evidence, iterations, budgets, and stop reasons are observable.

```bash
npm run agent:ask -- --drupal-version 11.4 "How does dependency injection work?"
npm run agent:research -- --drupal-version 11.4 --max-iterations 4 "Compare event subscribers and hooks"
```

Set `OPENAI_API_KEY` and optionally `OPENAI_AGENT_MODEL` in `.env`. Agent citations retain both stable `drupal://` resource URIs and canonical source URLs.

## LLM providers and model sizing

The agent (and therefore `ask_a_drupal_expert`) speaks the OpenAI Chat Completions API, so it also works against any OpenAI-compatible local endpoint:

```bash
# .env — Ollama example
OPENAI_BASE_URL=http://localhost:11434/v1
OPENAI_API_KEY=ollama            # placeholder; the endpoint ignores it
OPENAI_AGENT_MODEL=qwen3:32b     # any locally pulled model tag
```

The same two variables belong in your MCP client config (`env` block for this server) when using the expert tool, not just `.env`. Without a custom `OPENAI_BASE_URL`, a real OpenAI key is required.

### Hard budgets in code

These are fixed by the implementation (`packages/agent/src/openai-provider.ts`, `packages/agent/src/agent.ts`) and define what a model must cope with:

| Budget | Value | Where |
|---|---|---|
| Output cap per synthesis call | 2,000 tokens (override with `AGENT_MAX_OUTPUT_TOKENS`) | answer + research report |
| Research query-planner output | 400 tokens, strict JSON required | per planning round |
| Evidence bundle, `depth: "ask"` | ≤ 8 hits × ≤ 800-char snippets ≈ **2–4k input tokens** total prompt | one search round |
| Evidence bundle, `depth: "research"` | up to 24 admitted items ≈ **8–12k input tokens** final report prompt (budget adjustable 5–100) | accumulated rounds |

### What that means for local models

- **Context window**: 8k is enough to run `ask`; aim for ≥16k–32k for `research` so evidence plus a full report fit without truncation. Raise `AGENT_MAX_OUTPUT_TOKENS` only if your hardware gives the model headroom for it.
- **Capability floor**: every synthesis call must emit grounded, URI-cited prose, and research mode additionally requires reliable strict-JSON emission from the planner. That instruction-following burden is why sub-7B models tend to produce mushy or uncited answers even when they "fit".
  - Practical minimum: instruction-tuned ~8B class (e.g. `llama3.1:8b-instruct-q4_K_M`) — acceptable for `ask`.
  - Recommended: 30B+ class (e.g. `qwen3:32b`) for `research` reports worth keeping.
- **Graceful degradation is built in**: if a small model emits invalid planner JSON, the research loop simply stops after admitting what it found rather than crashing; an empty evidence set yields an explicit `insufficient_evidence` answer.
- **Verify small-model output**: weaker models still cite plausible-looking URIs that may be wrong. The mechanical check exists for exactly this — pass their `drupal://` citations to `get_drupal_document` and confirm exact text before trusting them (see [docs/integration-agent-loops.md](docs/integration-agent-loops.md)).

Caveat: only *generation* is provider-swappable today. Embeddings (hybrid semantic search and index builds with `--with-embeddings`) always use OpenAI embedding endpoints; fully local setups should expect lexical-only retrieval unless they have an embeddings key set.

## Architecture and migration

See [docs/architecture-0.2.md](docs/architecture-0.2.md) for schemas, extraction confidence, retrieval stages, activation, and verification details.

The 0.1 tools `ask_drupal_expert`, `search_drupal_docs`, `deep_research_drupal`, `drupal_skill_guide`, and `initialize_drupal_docs` were removed. Skill guides are normal searchable documents/resources; index creation is a maintainer CLI operation; synthesis and research moved to the agent package.

As of 0.2.x, an `ask_a_drupal_expert` tool has been restored as a thin, opt-in MCP wrapper around the agent package, together with a curated change-placement guidance corpus (`data/sources/drupal-placement-guidance/`) and a crawled Drupal theming guide — so the classic "when do I use X and where does Y live" questions get grounded, citable answers instead of API-facts-only retrieval.

## License

MIT. See [LICENSE](LICENSE).

<details>
<summary>Archived 0.1 README (migration reference)</summary>

# drupal-dev-mcp (0.1)

**Drupal development MCP server powered by RAG + LLM** — gives AI assistants direct access to Drupal documentation, source code, best-practice skill guides, and iterative deep-research capabilities via local vector search and OpenAI synthesis.

## Overview

`drupal-dev-mcp` is a [Model Context Protocol](https://modelcontextprotocol.io/) (MCP) server that exposes four complementary tools to any MCP-compatible AI client (Claude Desktop, Cursor, RooCode, etc.). The server is powered by a locally embedded [LanceDB](https://lancedb.github.io/lancedb/) vector database built from a broad corpus of official Drupal documentation, API references, contrib module source code, PHP and Symfony documentation, certification study guides, and community tutorials.

Answers and research outputs are grounded entirely in the local corpus — no internet search is performed at query time. All LLM synthesis is handled by OpenAI (text-embedding-3-small for retrieval, GPT-4o for synthesis by default). The server communicates over stdio transport and is registered in your AI client's MCP configuration as a standard server entry.

The ETL pipeline fetches, parses, chunks, embeds, and loads content from 14+ knowledge sources into LanceDB tables. Once indexed, the four MCP tools can be called at any time from your AI client to retrieve canonical Drupal references, synthesize expert answers, load domain-specific skill guides, or drive multi-iteration research workflows.

## Available MCP Tools

The following tools are registered in [`src/index.ts`](src/index.ts) and exposed to MCP clients.

---

### `ask_drupal_expert`

**File:** [`src/tools/ask-drupal-expert.ts`](src/tools/ask-drupal-expert.ts)

Provides conversational, citation-backed explanations for human Drupal backend developers. This tool searches the local Drupal documentation corpus and source code, then synthesizes an educational answer tailored to people seeking conceptual clarity. Covers hooks, services, dependency injection, entity API, form API, routing, config management, caching, plugins, migrations, events, and Drupal/Symfony patterns.

**Primary use case:** Explaining concepts, answering implementation questions, and synthesizing guidance from multiple documentation sources into a single Markdown answer with `[Source N]` citations and a `## Sources` section.

**When to use:** When you need a narrative, human-readable answer with citations. Not for raw retrieval hits or structured data.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `question` | string | ✅ | The Drupal development question to answer |
| `drupal_version` | string | no | Optional version filter (e.g., `"11.x"`). If omitted, searches all versions. |

---

### `search_drupal_docs`

**File:** [`src/tools/search-drupal-docs.ts`](src/tools/search-drupal-docs.ts)

Raw Drupal documentation search for agents. Returns unsynthesized retrieval hits with exact excerpts and metadata. Ideal for agentic workflows where the AI client needs to inspect source material directly rather than receive a synthesized answer.

**Primary use case:** Gathering raw evidence chunks before deciding how to act. Use in planning workflows, before calling `ask_drupal_expert`, or when you want to control synthesis yourself.

**When to use:** When you need structured retrieval results (JSON), want to filter specific datasets, or are building agentic workflows that inspect evidence before synthesis.

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `query` | string | ✅ | — | Natural-language search query |
| `drupal_version` | string | no | all | Optional version filter (e.g., `"10.x"`, `"11.x"`) |
| `datasets` | string[] | no | all | Explicit dataset allowlist (see dataset names below) |
| `top_k` | integer (1–25) | no | 8 | Maximum hits returned after merge and filtering |
| `per_dataset_limit` | integer (1–10) | no | 4 | Maximum hits fetched from each dataset before merge |
| `strategy` | `"tiered"` \| `"flat"` | no | `"tiered"` | Whether to preserve source-quality tiers or rank globally by relevance |
| `include_text` | boolean | no | `true` | Whether to include chunk text in the response |
| `include_metadata` | boolean | no | `true` | Whether to include section, file path, symbol name, and related metadata |

---

### `deep_research_drupal`

**File:** [`src/tools/deep-research-drupal.ts`](src/tools/deep-research-drupal.ts)

Iterative Drupal research planner. Produces implementation roadmaps and architectural guidance grounded in local documentation evidence. Runs multiple rounds of retrieval, using GPT-4o to generate follow-up queries, accumulate a structured evidence dossier, and synthesize key findings, open questions, contradictions, and a recommended approach.

**Primary use case:** Multi-domain architectural investigations, implementation planning, or any question that requires synthesizing evidence across many source types before recommending an approach.

**When to use:** For high-stakes, multi-step research tasks (e.g., "What is the recommended pattern for building a decoupled Drupal site with JSON:API and React?"). More expensive than `ask_drupal_expert` but delivers structured dossiers with implementation roadmaps and evidence ledgers.

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `question` | string | ✅ | — | Primary Drupal research question |
| `drupal_version` | string | no | all | Optional version filter (e.g., `"11.x"`) |
| `datasets` | string[] | no | all | Optional dataset allowlist for all research iterations |
| `max_iterations` | integer (1–6) | no | 4 | Hard cap on research rounds |
| `queries_per_iteration` | integer (1–5) | no | 2 | Maximum follow-up queries generated per iteration |
| `initial_top_k` | integer (1–15) | no | 8 | Maximum hits for the initial broad retrieval step |
| `followup_top_k` | integer (1–10) | no | 5 | Maximum hits per follow-up query |
| `max_evidence_chunks` | integer (5–40) | no | 18 | Cap on evidence stored in the final dossier |
| `output_format` | `"json"` \| `"markdown"` | no | `"json"` | Preferred response format |
| `include_evidence_text` | boolean | no | `false` | Whether to include full chunk text excerpts in the final response |

---

### `drupal_skill_guide`

**File:** [`src/tools/drupal-skill-guide.ts`](src/tools/drupal-skill-guide.ts)

Returns Drupal best-practice skill rules for a specific domain. Reads curated `SKILL.md` files from the local `drupal-best-practices` data source, which contain authoritative naming conventions, guardrails, usage patterns, and validation commands. Pair with `ask_drupal_expert` for searched documentation.

**Primary use case:** Loading domain-specific guardrails and naming conventions before generating or reviewing Drupal configuration, code, or architecture plans.

**When to use:** At the start of a site-building or module-development workflow to establish the correct conventions before asking broader questions or generating code.

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `skill_id` | string | ✅ | — | Drupal skill domain to retrieve. Valid values: `nodes`, `blocks`, `taxonomy`, `fields`, `views`, `forms`, `text-formats-editors`, `theming`, `config-parser`, `other-content-entities` |
| `format` | `"raw"` \| `"trimmed"` \| `"json"` | no | `"trimmed"` | `"raw"` returns the complete `SKILL.md`. `"trimmed"` strips frontmatter and `## References`. `"json"` returns a structured object with `id`, `title`, `description`, `usage`, `guardrails`, `validation_command`, and `references`. |

---

## Data Sources

The RAG index is built from the following knowledge sources. Each is fetched, parsed, chunked, embedded, and loaded into a named LanceDB dataset.

| Dataset name | Source | Description |
|---|---|---|
| `drupal_core_docs` | api.drupal.org, drupal.org/docs/user_guide | Core API docs, user guide, PHPDoc |
| `api_drupal_org_docs` | api.drupal.org/api | Canonical function, hook, and service documentation |
| `change_records` | drupal.org/list-changes | Release-by-release behavioral notes and API changes |
| `core_module_code` | git.drupalcode.org (Drupal core) | Source code of Drupal core modules |
| `contrib_module_code` | git.drupalcode.org (contrib) | Source code for widely used contrib modules |
| `contrib_module_docs` | drupal.org/docs/contributed-modules | Contrib module README and handbook pages |
| `contrib_module_handbook` | drupal.org/docs/contributed-modules | Handbook pages fetched via Jina proxy |
| `drupal_module_handbook` | drupal.org/docs/develop | Official module developer handbook |
| `drupal_developer_guides` | drupal.org/docs/develop/developer-tools | Modern Drupal workflow developer guides |
| `drupal_tutorials` | drupal.org/docs | How-to tutorials and articles |
| `drupal_examples` | drupal.org/project/examples | Runnable example implementations |
| `drupal_best_practices` | drupal.org/docs/develop/best-practices | Community best-practices guide + curated skill files |
| `php_docs` | php.net/manual/en/ | PHP manual pages relevant to Drupal runtime |
| `symfony_docs` | symfony.com/doc/current/ | Symfony component docs (routing, services, events) |
| `certification_docs` | acquia.com/academy | Acquia certification study guide material |

## Prerequisites

- **Node.js** ≥ 20.0.0 (pin with `.nvmrc`: `nvm use`)
- **npm** ≥ 10 (bundled with Node 20)
- **OpenAI API key** — [platform.openai.com/api-keys](https://platform.openai.com/api-keys)
- **git** — for cloning Drupal core during source sync

## Installation

```bash
# 1. Clone the repository
git clone https://github.com/your-org/drupal-dev-mcp.git
cd drupal-dev-mcp

# 2. Install Node dependencies
npm install

# 3. Configure environment
cp .env.example .env
# Edit .env and set OPENAI_API_KEY=sk-...

# 4. Build TypeScript
npm run build
```

## Configuration

Copy [`.env.example`](.env.example) to `.env` and set values as needed. Only `OPENAI_API_KEY` is required.

| Variable | Required | Default | Description |
|---|---|---|---|
| `OPENAI_API_KEY` | ✅ | — | OpenAI API key for embeddings and synthesis |
| `OPENAI_SYNTHESIS_MODEL` | no | `gpt-4o` | Model used by `ask_drupal_expert` for answer synthesis |
| `OPENAI_RESEARCH_MODEL` | no | `gpt-4o` | Model used by `deep_research_drupal` for iterative planning |
| `RESEARCH_SOURCES_SUMMARY_MODEL` | no | `gpt-4o-mini` | Model used by the `research:sources` maintenance script |
| `RESEARCH_TOOLS_SUMMARY_MODEL` | no | `gpt-4o-mini` | Model used by the `research:tools` maintenance script |
| `LANCEDB_PATH` | no | `./data/lancedb` | Path to the LanceDB vector database directory |
| `ETL_SOURCES_DIR` | no | `./data/sources` | Root path where fetch scripts store downloaded documents |
| `ETL_DRUPAL_CORE_BRANCH` | no | `11.x` | Drupal core branch cloned during `sync:sources` |
| `DRUPAL_DOCSET_URL` | no | Kapeli feed | Override URL for the Drupal Dash docset download |
| `TRAINING_DOCS_PATH` | no | — | Absolute path to private certification/training documents |
| `SKIP_EPUB` | no | `false` | Set `true` to skip ePub download/conversion (useful in CI) |
| `PLAYWRIGHT_HEADLESS` | no | `true` | Launch Chromium in headless mode for browser-based fetch scripts |
| `ENABLE_PLAYWRIGHT_FALLBACK` | no | `0` | Set `1` to allow Playwright fallback when no Wayback snapshot exists |
| `PLAYWRIGHT_MAX_RETRIES` | no | `2` | Retry attempts per page when using the Playwright fetcher |
| `LOG_LEVEL` | no | `info` | Log verbosity: `error` \| `warn` \| `info` \| `debug` |
| `DEBUG_QUERIES` | no | `false` | Set `true` to print verbose query diagnostics to stderr |

> **Cost tip:** Set `OPENAI_SYNTHESIS_MODEL=gpt-4o-mini` in `.env` for cheaper development testing (~$0.001/question vs ~$0.02 for GPT-4o).

## MCP Client Setup

After building, register the server in your AI client's MCP configuration.

### Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "drupal-dev-mcp": {
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

### Cursor

Edit `~/.cursor/mcp.json` with the same structure as above.

### RooCode / VS Code MCP

Add the same JSON block to your workspace or user-level MCP settings file.

> **Note:** Replace `/absolute/path/to/drupal-dev-mcp` with the real path to your local clone. After restarting the AI client, all four tools (`ask_drupal_expert`, `search_drupal_docs`, `deep_research_drupal`, `drupal_skill_guide`) should appear in the tool picker.

### RooCode Custom Mode (Drupal Planner)

Add the following entry to your RooCode `.roomodes` file to enable a repository-aware Drupal planning specialist:

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

## Fetching & Indexing Data

Documentation must be fetched and indexed before the MCP tools can return results. Run these steps once (and re-run periodically to refresh the index):

```bash
# Step 1: Download/sync documentation sources (~300 MB for Drupal core)
npm run sync:sources

# Step 2: Optional — fetch individual source families
npm run fetch:tutorials
npm run fetch:api-drupal-org
npm run fetch:contrib-modules
npm run fetch:symfony-docs
npm run fetch:php-manual
npm run fetch:best-practices
npm run fetch:drupal-examples
npm run fetch:contrib-module-handbook
npm run fetch:drupal-module-handbook

# Step 3: Run the full ETL pipeline (parse → chunk → embed → load into LanceDB)
# Dry run first (no API calls, no cost):
npm run etl -- --dry-run

# Full run (~$0.03 for ~40K chunks using text-embedding-3-small):
npm run etl
```

Individual ETL targets are also available (see [`package.json`](package.json) for the full list of `etl:*` and `verify:*` scripts).

## Research Maintenance Scripts

Two maintenance scripts audit the current state of sources and tools without mutating any fetch or ETL configurations.

### `research:sources`

Generates a scored source inventory and recommendation report.

```bash
npm run research:sources
# Add --llm-summary for an optional GPT summary (requires OPENAI_API_KEY)
npx tsx scripts/research-sources.ts --llm-summary --output data/cache/research-sources
```

Outputs written to `data/cache/research-sources/`:

| File | Description |
|---|---|
| `discovery.json` | Deterministic source inventory snapshot |
| `evaluation.json` | Scored assessments and summary metadata |
| `recommendations.md` | Human-readable review brief |

Smoke test: `npm run test:research-sources`

### `research:tools`

Audits current tool surfaces, shared retrieval logic, and benchmarks.

```bash
npm run research:tools
# Add --llm-summary for an optional GPT summary (requires OPENAI_API_KEY)
npx tsx scripts/research-tools.ts --llm-summary --output data/cache/research-tools
```

Outputs written to `data/cache/research-tools/`:

| File | Description |
|---|---|
| `inventory.json` | Deterministic tool inventory snapshot |
| `evaluation.json` | Scored assessments, duplicate identifiers, optional LLM summary |
| `recommendations.md` | Human-readable review brief |

Smoke test: `npm run test:research-tools`

## NPM Scripts Reference

| Script | Description |
|---|---|
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Start the MCP server (stdio transport) using compiled `dist/` |
| `npm run dev` | Run the MCP server directly with `tsx` (no build step) |
| `npm run sync:sources` | Download/update core documentation sources |
| `npm run etl` | Run the full ETL pipeline |
| `npm run research:sources` | Generate source inventory and recommendations |
| `npm run research:tools` | Generate tool inventory and recommendations |
| `npm run typecheck` | Type-check without emitting output |
| `npm run verify:*` | Verify individual ETL datasets (e.g., `verify:tutorials`, `verify:api-drupal-org`) |

## Development

```bash
# Type-check only (no build output)
npm run typecheck

# Run the server locally with live TypeScript (no prior build needed)
npm run dev

# Run smoke tests
npm run test:research-sources
npm run test:research-tools
```

The project is written in TypeScript (Node 20 LTS, ESM). [`tsconfig.json`](tsconfig.json) targets `dist/` for production builds; [`tsconfig.typecheck.json`](tsconfig.typecheck.json) is used for type checking only.

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 20 LTS, TypeScript (ESM) |
| Vector database | LanceDB (embedded, no server, no Docker) |
| Embeddings | OpenAI `text-embedding-3-small` |
| Synthesis | OpenAI GPT-4o (configurable) |
| MCP transport | `@modelcontextprotocol/sdk` (stdio) |
| HTML fetch/parse | Cheerio, Playwright, Jina reader proxy |
| Config validation | Zod |

## Cost Estimates

- **ETL (one-time):** ~$0.03 for embedding ~40K chunks via `text-embedding-3-small`
- **Per `ask_drupal_expert` question:** ~$0.02 (GPT-4o) or ~$0.001 (GPT-4o-mini)
- **Per `deep_research_drupal` research run:** ~$0.05–$0.15 depending on iteration depth
- **1,000 `ask_drupal_expert` questions:** ~$18 (GPT-4o) or ~$1 (GPT-4o-mini)

## Project Structure

```text
drupal-dev-mcp/
├── src/
│   ├── index.ts                  # MCP server entry point; registers all four tools
│   ├── config.ts                 # Zod-validated environment config loader
│   ├── lib/
│   │   ├── lancedb.ts            # LanceDB vector search helpers
│   │   ├── openai.ts             # OpenAI embed + chat helpers
│   │   ├── retrieval.ts          # Tiered/flat retrieval logic across all datasets
│   │   ├── deep-research.ts      # Iterative deep-research engine
│   │   ├── research-sources/     # Source inventory & scoring library
│   │   └── research-tools/       # Tool inventory & scoring library
│   └── tools/
│       ├── ask-drupal-expert.ts  # ask_drupal_expert handler
│       ├── search-drupal-docs.ts # search_drupal_docs handler
│       ├── deep-research-drupal.ts # deep_research_drupal handler
│       └── drupal-skill-guide.ts # drupal_skill_guide handler
├── etl/
│   ├── run.ts                    # Full ETL pipeline runner
│   ├── chunker.ts                # Text splitter with SHA-256 chunk IDs
│   ├── embedder.ts               # Batched OpenAI embeddings
│   ├── loader.ts                 # LanceDB loader
│   └── parse-*.ts                # Per-source parsers
├── scripts/
│   ├── sync-docs.sh              # Core documentation sync script
│   ├── fetch-*.sh / fetch-*.ts   # Per-source fetch scripts
│   ├── research-sources.ts       # Source maintenance script
│   └── research-tools.ts         # Tool maintenance script
├── data/
│   ├── sources/                  # Downloaded documentation (git-ignored)
│   └── lancedb/                  # Vector database files (git-ignored)
├── tests/
│   ├── manual-test-questions.md
│   ├── benchmark-questions.md
│   ├── research-sources-smoke.ts
│   └── research-tools-smoke.ts
├── .env.example                  # Environment variable reference
└── .nvmrc                        # Node version pin (20)
```

## License

See [LICENSE](LICENSE).

</details>
