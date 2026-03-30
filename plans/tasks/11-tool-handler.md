---
status: planned
phase: implementation
completed_at: null
last_reviewed_at: 2026-03-30
depends_on: []
supersedes: []
related_artifacts: []
---

# Task 11: `ask_drupal_expert` Tool — Registration + Handler

## Depends On
- Task 09: ETL Runner (LanceDB table must be populated with real data)
- Task 10: MCP Server Bootstrap (`src/index.ts` stub is running)

## Goal
Implement the `ask_drupal_expert` tool in full — both the JSON Schema registration that makes the tool visible to MCP clients, and the four-phase handler pipeline (embed question → LanceDB vector search → build prompt → GPT-4o synthesis). Replace the placeholder `ListToolsRequestSchema` handler in `src/index.ts` with the real tool. By the end of this task the MCP server is functionally complete: send a question via MCP and receive a cited Markdown answer.

## Deliverables
- `src/tools/ask-drupal-expert.ts` — tool definition, `registerAskDrupalExpert()` function, and complete `handleAskDrupalExpert()` four-phase handler
- `src/index.ts` updated to call `registerAskDrupalExpert(server)` instead of the placeholder
- `tools/list` MCP probe returns the `ask_drupal_expert` tool with correct schema
- End-to-end test: send a test question via stdin and receive a Markdown answer with citations
- `npm run build` exits 0; `npm run typecheck` exits 0

## Implementation Steps

1. **Create `src/tools/ask-drupal-expert.ts`**:
   ```typescript
   import { Server } from '@modelcontextprotocol/sdk/server/index.js';
   import {
     CallToolRequestSchema,
     ListToolsRequestSchema,
   } from '@modelcontextprotocol/sdk/types.js';
   import OpenAI from 'openai';
   import { embed } from '../lib/openai.js';
   import { vectorSearch } from '../lib/lancedb.js';

   // ─── Tool Definition ──────────────────────────────────────────────────────────

   const TOOL_DEFINITION = {
     name: 'ask_drupal_expert',
     description: [
       'Search the official Drupal documentation knowledge base and synthesize an accurate, cited answer.',
       'Use this tool for any question about Drupal backend development: hooks, services, dependency injection,',
       'entity API, form API, routing, configuration management, caching, plugins, migrations, events,',
       'or Drupal/Symfony architectural patterns.',
       'Returns a Markdown-formatted answer with source citations from the indexed Drupal documentation.',
       'Does NOT search the internet — only the pre-indexed documentation corpus.',
     ].join(' '),
     inputSchema: {
       type: 'object' as const,
       properties: {
         question: {
           type: 'string',
           description: 'A Drupal backend development question in plain English.',
         },
         drupal_version: {
           type: 'string',
           description:
             'Optional Drupal version filter (e.g., "11.x", "10.x"). ' +
             'Filters vector search results to that specific version.',
         },
       },
       required: ['question'],
     },
   };

   // ─── System Prompt ────────────────────────────────────────────────────────────

   const SYSTEM_PROMPT = `You are an expert Drupal backend developer and architect.
   Answer questions using ONLY the documentation excerpts provided in the context below.
   Format your response in Markdown with code blocks for any PHP, YAML, or JSON examples.
   For every factual statement, cite the source using its [Source N] reference.
   At the end of your response, add a ## Sources section listing the 3–5 most relevant sources
   with their symbol names or section titles.
   If the provided context does not contain enough information to answer the question,
   say so explicitly — do not guess or hallucinate API function names, hook names, or module names.
   Do not reference any Drupal 7 or Drupal 8 deprecated APIs unless the question specifically asks about them.`;

   // ─── Handler ──────────────────────────────────────────────────────────────────

   async function handleAskDrupalExpert(args: {
     question: string;
     drupal_version?: string;
   }) {
     const { question, drupal_version } = args;

     // Phase 1: Embed the question
     const queryVector = await embed(question);

     // Phase 2: Retrieve top 10 semantically similar chunks from LanceDB (fully embedded)
     const searchResults = await vectorSearch(
       queryVector,
       10,
       drupal_version,
     );

     if (searchResults.length === 0) {
       return {
         content: [{
           type: 'text' as const,
           text: [
             '**No relevant documentation found.**',
             '',
             'The `drupal_core_docs` LanceDB table appears to be empty or the query',
             'returned no results. Ensure the ETL pipeline has been run successfully:',
             '```bash',
             'npm run sync:sources && npm run etl:drupal-core-docs',
             '```',
           ].join('\n'),
         }],
       };
     }

     // Phase 3: Build context blocks for the prompt
     const contextBlocks = searchResults
       .map((r, i) => {
         const sourceLabel = r.symbol_name || r.section || r.file_path || `source-${i + 1}`;
         const versionTag = r.drupal_version && r.drupal_version !== 'all'
           ? ` (Drupal ${r.drupal_version})`
           : '';
         return [
           `[Source ${i + 1}] ${sourceLabel}${versionTag}`,
           `Type: ${r.source}`,
           '',
           r.text,
         ].join('\n');
       })
       .join('\n\n---\n\n');

     const userMessage = `## Documentation Context\n\n${contextBlocks}\n\n---\n\n## Question\n\n${question}`;

     // Phase 4: Synthesize answer with GPT-4o
     // Use gpt-4o-mini during development to reduce cost; switch to gpt-4o for production quality
     const synthesisModel = process.env.OPENAI_SYNTHESIS_MODEL ?? 'gpt-4o';

     const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
     const completion = await openai.chat.completions.create({
       model: synthesisModel,
       messages: [
         { role: 'system', content: SYSTEM_PROMPT },
         { role: 'user', content: userMessage },
       ],
       temperature: 0.2,   // Low temperature for factual accuracy
       max_tokens: 2048,
     });

     const answer = completion.choices[0].message.content ?? 'No response generated.';

     return {
       content: [{
         type: 'text' as const,
         text: answer,
       }],
     };
   }

   // ─── Registration ─────────────────────────────────────────────────────────────

   export function registerAskDrupalExpert(server: Server): void {
     server.setRequestHandler(ListToolsRequestSchema, async () => ({
       tools: [TOOL_DEFINITION],
     }));

     server.setRequestHandler(CallToolRequestSchema, async (request) => {
       if (request.params.name !== 'ask_drupal_expert') {
         throw new Error(`Unknown tool: ${request.params.name}`);
       }
       return handleAskDrupalExpert(
         request.params.arguments as { question: string; drupal_version?: string }
       );
     });
   }
   ```

2. **Update `src/index.ts`** to import and use `registerAskDrupalExpert`. Replace the placeholder handler block:
   ```typescript
   // DELETE this placeholder block:
   // server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [] }));

   // ADD this import at the top:
   import { registerAskDrupalExpert } from './tools/ask-drupal-expert.js';

   // ADD this after server creation:
   registerAskDrupalExpert(server);
   ```
   Also remove the `ListToolsRequestSchema` import from `src/index.ts` if it is no longer used there.

3. **Build**:
   ```bash
   npm run build
   ```

4. **Probe `tools/list`** to confirm the tool is registered:
   ```bash
   printf '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}\n{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}\n' \
     | node dist/src/index.js
   ```
   Confirm the `tools/list` response contains `"name": "ask_drupal_expert"`.

5. **Send a real question end-to-end** (requires LanceDB populated via ETL, and `OPENAI_API_KEY` set):
   ```bash
   printf '%s\n%s\n%s\n' \
     '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}' \
     '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' \
     '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"ask_drupal_expert","arguments":{"question":"How do I implement a custom access checker as a tagged service in Drupal?"}}}' \
     | node dist/src/index.js
   ```

6. **Optionally switch to `gpt-4o-mini` during development** to reduce cost per test call (~18× cheaper):
   ```bash
   # In .env:
   OPENAI_SYNTHESIS_MODEL=gpt-4o-mini
   # Revert to gpt-4o before final validation in Task 13
   ```

7. **Typecheck**:
   ```bash
   npm run typecheck
   ```

8. **Commit**:
   ```bash
   git add src/tools/ask-drupal-expert.ts src/index.ts
   git commit -m "feat(server): implement ask_drupal_expert tool handler"
   ```

## Verification / Done Criteria

```bash
# 1. Build check
npm run build
# Expected: exits 0, zero TypeScript errors

# 2. tools/list check
printf '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}\n{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}\n' \
  | node dist/src/index.js
```

Expected `tools/list` response (within the stdout stream):
```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "tools": [{
      "name": "ask_drupal_expert",
      "description": "Search the official Drupal documentation...",
      "inputSchema": {
        "type": "object",
        "properties": { "question": {...}, "drupal_version": {...} },
        "required": ["question"]
      }
    }]
  }
}
```

End-to-end test response for "How do I implement a custom access checker as a tagged service?":
- Must contain a `## Sources` section
- Must reference real Drupal class names (e.g., `AccessCheckInterface`, `access_check` tag)
- Must include a PHP code snippet showing service definition or class structure
- Must NOT contain hallucinated class names

**Done criteria**:
- `npm run build` exits 0
- `tools/list` returns exactly 1 tool named `ask_drupal_expert`
- End-to-end call returns a non-empty Markdown answer with a `## Sources` section
- Answer contains recognizable Drupal API terms (not hallucinated)
- `npm run typecheck` exits 0

## Notes / Gotchas

- **LanceDB is fully embedded**: The `vectorSearch()` helper in `src/lib/lancedb.ts` connects to LanceDB in-process on every call. No server, no Docker, no network round-trips. The database files are read directly from `data/lancedb/` on disk.
- **Empty-string metadata**: The loader stores `null` metadata values as `''` (empty string). The prompt-building code uses `r.symbol_name || r.section || r.file_path` which correctly treats empty strings as falsy.
- **`console.error()` only in server code**: Any `console.log()` in `ask-drupal-expert.ts` or its dependencies will corrupt the MCP stdout stream. Use `console.error()` for all server-side logging.
- **`gpt-4o-mini` for development**: At ~$0.001/call vs ~$0.018/call for `gpt-4o`, using `gpt-4o-mini` during development reduces cost by ~18×. The quality is slightly lower but sufficient for testing the pipeline. Switch back to `gpt-4o` for the final validation pass in Task 13.
- **`OPENAI_SYNTHESIS_MODEL` env var**: The `process.env.OPENAI_SYNTHESIS_MODEL ?? 'gpt-4o'` pattern allows switching models without code changes — just update `.env`.
- **LanceDB connection caching**: `vectorSearch()` opens the DB and table on every call. This is safe but slightly inefficient. For production, cache the `lancedb.Table` handle at module load time.
- **Rate limiting**: If you hit OpenAI rate limits during testing (HTTP 429), wait 60 seconds and retry. The synthesis call does not have retry logic — add it if needed for production.
- **MCP protocol version**: Different MCP clients (Claude Desktop, Cursor) may send different `protocolVersion` values. The `@modelcontextprotocol/sdk` handles negotiation automatically.
