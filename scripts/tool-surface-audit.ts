/**
 * Tool-surface audit (researcher intake B8): measures the MCP's own tool
 * surface the way an agent experiences it — registered tool count,
 * description/schema token estimates, and the search-then-fetch guidance
 * check. Run after any tool change; commit the report so drift is visible.
 *
 * Usage: npx tsx scripts/tool-surface-audit.ts
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const serverSource = readFileSync(resolve('packages/server/src/server.ts'), 'utf8');

// Extract registerTool blocks: id, description, and a rough schema size.
const tools: Array<{ id: string; descriptionChars: number; descriptionTokens: number; schemaChars: number; schemaTokens: number; teachesSearchThenFetch: boolean }> = [];
const blockRe = /registerTool\('([a-z_]+)',\s*\{[\s\S]*?inputSchema:\s*z\.object\(\{([\s\S]*?)\}\)/g;
let m: RegExpExecArray | null;
while ((m = blockRe.exec(serverSource)) !== null) {
  const id = m[1];
  const block = m[0];
  const descMatch = block.match(/description:\s*'([^']*)'/);
  const description = descMatch?.[1] ?? '';
  const schemaText = m[2];
  // ~4 chars per token, the BPE ballpark for English/identifier text.
  const descriptionTokens = Math.round(description.length / 4);
  const schemaTokens = Math.round(schemaText.length / 4);
  tools.push({
    id,
    descriptionChars: description.length,
    descriptionTokens,
    schemaChars: schemaText.length,
    schemaTokens,
    teachesSearchThenFetch: /keyword|search/i.test(description),
  });
}

const totalTokens = tools.reduce((sum, t) => sum + t.descriptionTokens + t.schemaTokens, 0);
const searchThenFetch = tools.filter(t => t.teachesSearchThenFetch).length;

const report = {
  generatedAt: new Date().toISOString(),
  toolCount: tools.length,
  /** B8 guidance: keep the tool count low; budget the whole surface. */
  budgetGuidance: { toolCountMax: 10, surfaceTokensMax: 3000 },
  surfaceTokens: totalTokens,
  withinBudget: tools.length <= 10 && totalTokens <= 3000,
  searchThenFetchCoverage: `${searchThenFetch}/${tools.length}`,
  tools,
  notes: [
    'Token figures are estimates (~4 chars/token) for planning, not billing.',
    'The query-style guidance ("short keyword queries score best") should appear on every retrieval tool whose queries benefit from it.',
  ],
};

mkdirSync('docs/eval', { recursive: true });
const outPath = resolve('docs/eval/tool-surface-audit.json');
writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n');
process.stdout.write(`tools: ${tools.length} | surface tokens (est): ${totalTokens} | within budget: ${report.withinBudget}\n`);
for (const t of tools) {
  process.stdout.write(`  ${t.id}: desc ${t.descriptionTokens}t + schema ${t.schemaTokens}t${t.teachesSearchThenFetch ? '' : '  [no query-style guidance]' }\n`);
}
process.stdout.write(`report: ${outPath}\n`);
