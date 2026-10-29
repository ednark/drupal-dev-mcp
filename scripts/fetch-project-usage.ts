/**
 * Fetch Drupal.org project usage data (researcher intake B12): the
 * contribution to the contrib add/drop decision — which modules developers
 * actually use, with the Update-Status denominator caveat.
 *
 * The usage page is a JS-heavy Drupal table; fetched via the Jina reader
 * (same pattern as the advisory/change-record fetchers). Output: a research
 * note under docs/eval/ for the maintainer's fetch-list decision — NOT
 * indexed corpus material.
 *
 * Usage: npx tsx scripts/fetch-project-usage.ts [--top=100]
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const TOP = Number(process.argv.find(a => a.startsWith('--top='))?.split('=')[1] ?? 100);
const OUT_DIR = 'docs/eval/usage-snapshots';

async function fetchViaJina(url: string): Promise<string | null> {
  try {
    const res = await fetch(`https://r.jina.ai/${url}`, {
      headers: {
        'User-Agent': 'DrupalDevMCP/1.0 (+https://github.com/example/drupal-dev-mcp)',
        'Accept': 'text/markdown, text/plain, */*',
      },
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

function parseRows(markdown: string): Array<{ project: string; installs: number | null }> {
  // Jina renders the usage table as markdown rows: | [project](url) | count |
  const rows: Array<{ project: string; installs: number | null }> = [];
  for (const line of markdown.split('\n')) {
    const m = line.match(/^\|\s*\[?([a-z0-9_]+)\]?\(?[^|]*\|?\s*\|\s*([\d,]+|—|-)?/i);
    if (!m) continue;
    const project = m[1];
    const count = m[2] ? Number(m[2].replace(/,/g, '')) : null;
    if (project === 'project' || project === 'Name') continue;
    rows.push({ project, installs: Number.isFinite(count) ? count : null });
  }
  return rows;
}

async function main(): Promise<void> {
  process.stdout.write('fetching https://www.drupal.org/project/usage via Jina...\n');
  const markdown = await fetchViaJina('https://www.drupal.org/project/usage');
  if (!markdown) {
    process.stdout.write('fetch failed — retry later (Jina rate limits recover; the script is resumable)\n');
    process.exit(1);
  }
  const rows = parseRows(markdown).filter(r => r.installs !== null && r.installs > 0);
  const sorted = rows.sort((a, b) => (b.installs ?? 0) - (a.installs ?? 0)).slice(0, TOP);

  mkdirSync(OUT_DIR, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  const lines = [
    `# Drupal.org project usage snapshot — ${stamp}`,
    '',
    `Top ${sorted.length} projects by reported installs. Source: https://www.drupal.org/project/usage`,
    '',
    '**Denominator caveat (L11):** usage data includes only sites running the',
    'Update Status module — headless and non-updating deployments are',
    'undercounted. Record the denominator with every fetch-list decision.',
    '',
    '| # | Project | Reported installs |',
    '|---|---|---|',
    ...sorted.map((r, i) => `| ${i + 1} | ${r.project} | ${(r.installs ?? 0).toLocaleString()} |`),
    '',
    'Purpose: contribution to the contrib add/drop decision for the index',
    'fetch list (researcher Program A / corpus-issues context). Not indexed',
    'corpus material.',
    '',
  ];
  const outPath = resolve(OUT_DIR, `usage-${stamp}.md`);
  writeFileSync(outPath, lines.join('\n'));
  process.stdout.write(`snapshot written: ${outPath} (${sorted.length} projects)\n`);
  process.stdout.write(`top 10: ${sorted.slice(0, 10).map(r => r.project).join(', ')}\n`);
}

void main();
