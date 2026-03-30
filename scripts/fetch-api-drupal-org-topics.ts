/**
 * Fetch api.drupal.org topic/group pages via Jina reader and save as Markdown.
 *
 * Jina (https://r.jina.ai/) renders JavaScript SPAs and returns clean markdown.
 * api.drupal.org is a React SPA — direct curl returns only a ~3 KB shell page.
 *
 * Files are saved to data/sources/api-drupal-org/ as {slug}.md.
 * Skips files that already exist and are larger than 1000 bytes.
 *
 * Usage:
 *   npx tsx scripts/fetch-api-drupal-org-topics.ts
 */

import { writeFile, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';

const DEST_DIR = 'data/sources/api-drupal-org';

/** Snapshot header prepended to each saved file. */
function snapshotHeader(url: string): string {
  return (
    `<!-- fetched: ${new Date().toISOString()} -->\n`
    + `<!-- source: ${url} -->\n\n`
  );
}

interface TopicPage {
  /** Slug used as filename (without extension). */
  slug: string;
  /** Original api.drupal.org URL to fetch via Jina. */
  url: string;
}

const TOPIC_PAGES: TopicPage[] = [
  {
    slug: 'groups',
    url: 'https://api.drupal.org/api/drupal/groups/11.x',
  },
  {
    slug: 'routing',
    url: 'https://api.drupal.org/api/drupal/core!lib!Drupal!Core!Routing!routing.api.php/group/routing/11.x',
  },
  {
    slug: 'entity_api',
    url: 'https://api.drupal.org/api/drupal/core!lib!Drupal!Core!Entity!entity.api.php/group/entity_api/11.x',
  },
  {
    slug: 'plugin_api',
    url: 'https://api.drupal.org/api/drupal/core!lib!Drupal!Core!Plugin!plugin.api.php/group/plugin_api/11.x',
  },
  {
    slug: 'cache',
    url: 'https://api.drupal.org/api/drupal/core!lib!Drupal!Core!Cache!cache.api.php/group/cache/11.x',
  },
  {
    slug: 'form_api',
    url: 'https://api.drupal.org/api/drupal/core!lib!Drupal!Core!Form!form.api.php/group/form_api/11.x',
  },
  {
    slug: 'hooks',
    url: 'https://api.drupal.org/api/drupal/core!lib!Drupal!Core!Hook!hook.api.php/group/hooks/11.x',
  },
  {
    slug: 'themeable',
    url: 'https://api.drupal.org/api/drupal/core!lib!Drupal!Core!Render!theme.api.php/group/themeable/11.x',
  },
  {
    slug: 'database',
    url: 'https://api.drupal.org/api/drupal/core!lib!Drupal!Core!Database!database.api.php/group/database/11.x',
  },
  {
    slug: 'module_api',
    url: 'https://api.drupal.org/api/drupal/core!lib!Drupal!Core!Extension!module.api.php/group/module_api/11.x',
  },
  {
    slug: 'queue',
    url: 'https://api.drupal.org/api/drupal/core!lib!Drupal!Core!Queue!queue.api.php/group/queue/11.x',
  },
  {
    slug: 'mail_api',
    url: 'https://api.drupal.org/api/drupal/core!lib!Drupal!Core!Mail!mail.api.php/group/mail_api/11.x',
  },
  {
    slug: 'render_api',
    url: 'https://api.drupal.org/api/drupal/core!lib!Drupal!Core!Render!render.api.php/group/render_api/11.x',
  },
];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fileExistsAndLarge(filePath: string, minBytes = 1000): Promise<boolean> {
  try {
    const s = await stat(filePath);
    return s.size > minBytes;
  }
  catch {
    return false;
  }
}

async function fetchViaJina(url: string): Promise<string | null> {
  const jinaUrl = `https://r.jina.ai/${url}`;
  try {
    const res = await fetch(jinaUrl, {
      headers: {
        'User-Agent': 'DrupalDevMCP/1.0 (+https://github.com/example/drupal-dev-mcp)',
        'Accept': 'text/markdown, text/plain, */*',
      },
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      console.warn(`  ⚠  Jina returned ${res.status} for ${url}`);
      return null;
    }

    return await res.text();
  }
  catch (err) {
    console.warn(`  ⚠  Fetch failed for ${url}: ${(err as Error).message}`);
    return null;
  }
}

async function main(): Promise<void> {
  // Ensure destination directory exists
  await mkdir(DEST_DIR, { recursive: true });

  console.log('=== Fetching api.drupal.org topic pages via Jina ===');
  console.log(`Destination : ${DEST_DIR}`);
  console.log(`Topics      : ${TOPIC_PAGES.length}\n`);

  let fetched = 0;
  let skipped = 0;
  let failed = 0;

  for (const topic of TOPIC_PAGES) {
    const destFile = path.join(DEST_DIR, `${topic.slug}.md`);

    // Skip if already exists and large enough
    if (await fileExistsAndLarge(destFile, 1000)) {
      console.log(`  ↷  ${topic.slug}.md already exists — skipping`);
      skipped++;
      continue;
    }

    console.log(`  ↓  Fetching ${topic.slug} from ${topic.url} ...`);
    const content = await fetchViaJina(topic.url);

    if (!content || content.trim().length < 100) {
      console.warn(`  ⚠  ${topic.slug}: content too short or empty — skipping`);
      failed++;
    }
    else {
      const fileContent = snapshotHeader(topic.url) + content;
      await writeFile(destFile, fileContent, 'utf8');
      console.log(`  ✓  ${topic.slug}.md saved (${fileContent.length} bytes)`);
      fetched++;
    }

    // Polite delay between requests
    await sleep(1_500);
  }

  console.log('\n=== Fetch complete ===');
  console.log(`  Fetched : ${fetched}`);
  console.log(`  Skipped : ${skipped} (already existed)`);
  console.log(`  Failed  : ${failed}`);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
