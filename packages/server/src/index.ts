import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SqliteKnowledgeProvider } from '@drupal-dev-mcp/knowledge';
import { createDrupalMcpServer } from './server.js';

export { createDrupalMcpServer } from './server.js';

export async function startServer(): Promise<void> {
  const provider = await SqliteKnowledgeProvider.open();
  const server = createDrupalMcpServer(provider);
  const shutdown = async () => {
    await server.close();
    provider.close();
  };
  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());
  await server.connect(new StdioServerTransport());
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startServer().catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
