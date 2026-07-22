import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { fileURLToPath } from 'node:url';
import { getDefaultIndexRoot, SqliteKnowledgeProvider } from '@drupal-dev-mcp/knowledge';
import { createDrupalMcpServer } from './server.js';

export { createDrupalMcpServer } from './server.js';

export async function startServer(): Promise<void> {
  const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));
  const provider = await SqliteKnowledgeProvider.open(getDefaultIndexRoot(repoRoot));
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
