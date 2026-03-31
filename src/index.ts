import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { validateConfig } from './config.js';
import {
  TOOL_DEFINITION as ASK_DRUPAL_EXPERT_TOOL,
  handleAskDrupalExpert,
} from './tools/ask-drupal-expert.js';
import {
  TOOL_DEFINITION as DRUPAL_SKILL_GUIDE_TOOL,
  handleDrupalSkillGuide,
} from './tools/drupal-skill-guide.js';
import {
  TOOL_DEFINITION as SEARCH_DRUPAL_DOCS_TOOL,
  handleSearchDrupalDocs,
} from './tools/search-drupal-docs.js';
import {
  TOOL_DEFINITION as DEEP_RESEARCH_TOOL,
  handleDeepResearchDrupal,
} from './tools/deep-research-drupal.js';

async function main() {
  // Validate environment before starting server
  validateConfig();

  const server = new Server(
    {
      name: 'drupal-architect',
      version: '0.1.0',
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  // ── List all registered tools ────────────────────────────────
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      ASK_DRUPAL_EXPERT_TOOL,
      DRUPAL_SKILL_GUIDE_TOOL,
      SEARCH_DRUPAL_DOCS_TOOL,
      DEEP_RESEARCH_TOOL,
    ],
  }));

  // ── Route tool calls to the correct handler ──────────────────
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    // ── ask_drupal_expert ──────────────────────────────────────
    if (name === 'ask_drupal_expert') {
      const toolArgs = args as { question: string; drupal_version?: string };

      if (!toolArgs.question || typeof toolArgs.question !== 'string') {
        return {
          content: [{ type: 'text', text: 'Error: "question" parameter is required and must be a string.' }],
          isError: true,
        };
      }

      try {
        const answer = await handleAskDrupalExpert(toolArgs);
        return { content: [{ type: 'text', text: answer }] };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[ask_drupal_expert] Error: ${message}`);
        return {
          content: [{ type: 'text', text: `Error processing question: ${message}` }],
          isError: true,
        };
      }
    }

    // ── search_drupal_docs ─────────────────────────────────────
    if (name === 'search_drupal_docs') {
      try {
        const result = await handleSearchDrupalDocs((args ?? {}) as Record<string, unknown>);
        return {
          content: [{ type: 'text', text: result }],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[search_drupal_docs] Error: ${message}`);
        return {
          content: [{ type: 'text', text: `Error performing search: ${message}` }],
          isError: true,
        };
      }
    }

    // ── drupal_skill_guide ─────────────────────────────────────
    if (name === 'drupal_skill_guide') {
      try {
        return handleDrupalSkillGuide((args ?? {}) as Record<string, unknown>);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[drupal_skill_guide] Error: ${message}`);
        return {
          content: [{ type: 'text', text: `Error retrieving skill guide: ${message}` }],
          isError: true,
        };
      }
    }

    // ── deep_research_drupal ───────────────────────────────────
    if (name === 'deep_research_drupal') {
      try {
        const result = await handleDeepResearchDrupal((args ?? {}) as Record<string, unknown>);
        return {
          content: [{ type: 'text', text: result }],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[deep_research_drupal] Error: ${message}`);
        return {
          content: [{ type: 'text', text: `Error performing deep research: ${message}` }],
          isError: true,
        };
      }
    }

    throw new Error(`Unknown tool: ${name}`);
  });

  // Connect via stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error('[drupal-architect] Server running (stdio transport) — waiting for requests');
}

main().catch((err) => {
  console.error('[drupal-architect] Fatal error:', err);
  process.exit(1);
});
