---
status: planned
phase: implementation
completed_at: null
last_reviewed_at: 2026-03-30
depends_on: []
supersedes: []
related_artifacts: []
---

# Task 10: MCP Server Bootstrap

## Depends On
- Task 01: Repository Scaffold
- Task 02: LanceDB + OpenAI Smoke Test (`src/config.ts`, `src/lib/lancedb.ts`, `src/lib/openai.ts` in place)

## Goal
Implement the MCP server entry point (`src/index.ts`) and register it as a bare server with `StdioServerTransport` — no tools yet, just the protocol handshake. By the end of this task the server starts without crashing, accepts the MCP `initialize` request, and responds correctly. This proves the MCP SDK wiring is correct before the more complex tool handler logic is added in Task 11.

## Deliverables
- `src/index.ts` — fully implemented MCP server entry point using `StdioServerTransport`
- `npm run build` compiles to `dist/src/index.js` with zero errors
- `node dist/src/index.js` starts and stays running (does not crash on startup)
- Manual `initialize` probe returns a valid MCP response confirming the server name and version
- `npm run typecheck` passes

## Implementation Steps

1. **Implement `src/index.ts`** — the server entry point. At this stage `registerAskDrupalExpert` does not exist yet, so we register a no-op tool list handler as a placeholder:
   ```typescript
   import * as dotenv from 'dotenv';
   dotenv.config();

   import { Server } from '@modelcontextprotocol/sdk/server/index.js';
   import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
   import { ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
   import { validateConfig } from './config.js';

   async function main() {
     // Validate required environment variables — exits with a clear error if missing
     validateConfig();

     const server = new Server(
       {
         name: 'drupal-architect',
         version: '0.1.0',
       },
       {
         capabilities: { tools: {} },
       },
     );

     // Placeholder tool list — Task 11 will replace this with the real tool
     server.setRequestHandler(ListToolsRequestSchema, async () => ({
       tools: [],
     }));

     const transport = new StdioServerTransport();
     await server.connect(transport);

     // All diagnostic output MUST go to stderr — stdout is reserved for MCP protocol messages
     console.error('[drupal-architect] Server running (stdio transport) — waiting for requests');
   }

   main().catch(err => {
     console.error('[drupal-architect] Server failed to start:', err.message);
     process.exit(1);
   });
   ```

2. **Build the project**:
   ```bash
   npm run build
   ```
   Verify zero TypeScript errors.

3. **Test that the server starts**:
   ```bash
   node dist/src/index.js
   ```
   The process should stay running (not exit). You should see on stderr:
   ```
   [drupal-architect] Server running (stdio transport) — waiting for requests
   ```
   Press `Ctrl+C` to stop.

4. **Probe with an MCP `initialize` message** — send a raw JSON-RPC message via stdin to confirm the server responds correctly. In a separate terminal:
   ```bash
   echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}' \
     | node dist/src/index.js
   ```
   The server should print a JSON response to stdout (the MCP protocol response) and a startup message to stderr.

5. **Test `tools/list`** returns an empty list:
   ```bash
   # Send initialize followed by tools/list
   printf '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}\n{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}\n' \
     | node dist/src/index.js
   ```
   Expected: Two JSON objects in stdout — the `initialize` response and a `tools/list` response with `"tools":[]`.

6. **Typecheck**:
   ```bash
   npm run typecheck
   ```

7. **Commit**:
   ```bash
   git add src/index.ts src/config.ts
   git commit -m "feat(server): implement MCP server bootstrap with StdioServerTransport"
   ```

## Verification / Done Criteria

```bash
# Build check
npm run build
# Expected: exits 0, zero TypeScript errors

# Startup check
node dist/src/index.js &
# Expected stderr: "[drupal-architect] Server running (stdio transport) — waiting for requests"
kill %1

# Initialize probe
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}' \
  | node dist/src/index.js
```

Expected stdout output from the initialize probe (formatted for readability):
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "protocolVersion": "2024-11-05",
    "capabilities": { "tools": {} },
    "serverInfo": {
      "name": "drupal-architect",
      "version": "0.1.0"
    }
  }
}
```

**Done criteria**:
- `npm run build` exits 0
- `node dist/src/index.js` starts without crashing and prints startup message to stderr
- Initialize probe returns a valid MCP response with `serverInfo.name = "drupal-architect"`
- `tools/list` probe returns `{ "tools": [] }`
- `npm run typecheck` exits 0

## Notes / Gotchas

- **stdout is reserved for MCP protocol**: The MCP protocol uses `stdout` for JSON-RPC message framing. Any `console.log()` calls in the server process will corrupt the MCP stream and break client communication. **Always use `console.error()`** for all diagnostic output in server-side code. This is the single most common mistake when building MCP servers.
- **`StdioServerTransport` is blocking**: The server process stays alive in `server.connect()` — it reads from stdin and writes to stdout. Do not `process.exit()` anywhere in the normal flow, only in error handlers.
- **`validateConfig()` exits on missing `OPENAI_API_KEY`**: When testing without a `.env` file, the server will exit immediately with a clear error message. This is correct behavior — the server is unusable without the API key.
- **MCP SDK import paths**: The `@modelcontextprotocol/sdk` package uses deep subpath imports (`/server/index.js`, `/server/stdio.js`, `/types.js`). These are listed in the package's `exports` map — do not modify these import paths.
- **`protocolVersion` in the probe**: The `"2024-11-05"` version string must match what the MCP SDK expects. If you see a protocol version mismatch error, check the installed SDK version (`npm ls @modelcontextprotocol/sdk`) and use the version it supports.
- **Dev mode** (`npm run dev`): Once the tool handler is implemented in Task 11, you can use `npm run dev` (which runs via `ts-node` without a build step) for faster iteration. At this stage `npm run build` + `node dist/src/index.js` is the more reliable path.
