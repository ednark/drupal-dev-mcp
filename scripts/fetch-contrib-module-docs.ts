/**
 * Fetch README documentation for contrib modules from Git or drupal.org.
 *
 * Sources tried in priority order for each module:
 *   1. https://git.drupalcode.org/project/{module}/-/raw/HEAD/README.md
 *   2. https://git.drupalcode.org/project/{module}/-/raw/HEAD/README.txt
 *   3. https://r.jina.ai/https://www.drupal.org/project/{module}   (Jina-fetched)
 *
 * Usage:
 *   npx tsx scripts/fetch-contrib-module-docs.ts
 */

import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const DEST_DIR = 'data/sources/contrib-modules';

const MODULES: string[] = [
  'views',
  'token',
  'pathauto',
  'ctools',
  'entity',
  'paragraphs',
  'webform',
  'admin_toolbar',
  'metatag',
  'redirect',
  'simple_sitemap',
  'field_group',
  'devel',
  'smtp',
  'backup_migrate',
  'google_analytics',
  'captcha',
  'recaptcha',
  'better_exposed_filters',
  'module_filter',
  'twig_tweak',
  'scheduler',
  'linkit',
  'eck',
  'transliteration',
  'imce',
  'conditional_fields',
  'allowed_formats',
  'roleassign',
  'environment_indicator',
  'block_class',
  'field_validation',
  'jquery_update',
  'libraries',
  'date',
  'media',
  'media_entity',
  'colorbox',
  'slick',
  'views_bulk_operations',
  'queue_ui',
  'crop',
  'focal_point',
];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function tryFetch(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'DrupalDevMCP/1.0 (+https://github.com/example/drupal-dev-mcp)',
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      return null;
    }

    const text = await res.text();
    // Reject empty or very short responses
    if (!text || text.trim().length < 50) {
      return null;
    }

    return text.trim();
  } catch {
    return null;
  }
}

async function fetchModuleDoc(module: string): Promise<{ content: string; source: string } | null> {
  const sources: Array<{ label: string; url: string }> = [
    {
      label: 'Git README.md',
      url: `https://git.drupalcode.org/project/${module}/-/raw/HEAD/README.md`,
    },
    {
      label: 'Git README.txt',
      url: `https://git.drupalcode.org/project/${module}/-/raw/HEAD/README.txt`,
    },
    {
      label: 'Jina drupal.org',
      url: `https://r.jina.ai/https://www.drupal.org/project/${module}`,
    },
  ];

  for (const { label, url } of sources) {
    const content = await tryFetch(url);
    if (content) {
      return { content, source: label };
    }
  }

  return null;
}

async function main(): Promise<void> {
  await mkdir(DEST_DIR, { recursive: true });

  const total = MODULES.length;
  let success = 0;

  for (let i = 0; i < MODULES.length; i++) {
    const module = MODULES[i]!;
    process.stderr.write(`Fetching ${module} (${i + 1}/${total})...\n`);

    const result = await fetchModuleDoc(module);

    if (result) {
      const outPath = path.join(DEST_DIR, `${module}.md`);
      await writeFile(outPath, result.content, 'utf8');
      process.stderr.write(`  ✓ ${module} (${result.source})\n`);
      success++;
    } else {
      process.stderr.write(`  ✗ ${module} (all sources failed)\n`);
    }

    // Rate-limit delay between requests (skip after last module)
    if (i < MODULES.length - 1) {
      await sleep(1_000);
    }
  }

  process.stderr.write(`\nDone. ${success}/${total} modules fetched.\n`);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
