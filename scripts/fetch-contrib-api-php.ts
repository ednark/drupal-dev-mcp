/**
 * Fetch .api.php hook documentation files and .services.yml files from Git
 * for the same 43 contrib modules used in fetch-contrib-module-docs.ts.
 *
 * For each module, tries:
 *   1. https://git.drupalcode.org/project/{module}/-/raw/HEAD/{module}.api.php
 *   2. https://git.drupalcode.org/project/{module}/-/raw/HEAD/src/{module}.api.php
 *
 * And for services.yml:
 *   1. https://git.drupalcode.org/project/{module}/-/raw/HEAD/{module}.services.yml
 *
 * Usage:
 *   npx tsx scripts/fetch-contrib-api-php.ts
 */

import { writeFile, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';

const DEST_DIR = 'data/sources/contrib-module-code';

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

    return await res.text();
  }
  catch {
    return null;
  }
}

async function ensureDir(dir: string): Promise<void> {
  try {
    await stat(dir);
  }
  catch {
    await mkdir(dir, { recursive: true });
  }
}

async function main(): Promise<void> {
  console.log('=== Fetching contrib module .api.php and .services.yml files ===');
  console.log(`Modules: ${MODULES.length}\n`);

  let apiPhpFetched = 0;
  let servicesYmlFetched = 0;
  let apiPhpSkipped = 0;
  let servicesYmlSkipped = 0;

  for (const module of MODULES) {
    const moduleDir = path.join(DEST_DIR, module);
    await ensureDir(moduleDir);

    // ── Fetch .api.php ──────────────────────────────────────────
    const apiPhpDest = path.join(moduleDir, `${module}.api.php`);
    const apiPhpUrls = [
      `https://git.drupalcode.org/project/${module}/-/raw/HEAD/${module}.api.php`,
      `https://git.drupalcode.org/project/${module}/-/raw/HEAD/src/${module}.api.php`,
    ];

    let apiPhpSaved = false;
    for (const url of apiPhpUrls) {
      const content = await tryFetch(url);
      await sleep(1_000);

      if (
        content !== null &&
        content.length >= 500 &&
        (content.includes('@file') || content.includes('hook_') || content.includes('@addtogroup'))
      ) {
        await writeFile(apiPhpDest, content, 'utf8');
        console.log(`  ✓  ${module}: saved ${module}.api.php (${content.length} bytes) from ${url}`);
        apiPhpFetched++;
        apiPhpSaved = true;
        break;
      }
    }

    if (!apiPhpSaved) {
      console.log(`  –  ${module}: no .api.php found`);
      apiPhpSkipped++;
    }

    // ── Fetch .services.yml ────────────────────────────────────
    const servicesYmlUrl = `https://git.drupalcode.org/project/${module}/-/raw/HEAD/${module}.services.yml`;
    const servicesYmlDest = path.join(moduleDir, `${module}.services.yml`);

    const servicesContent = await tryFetch(servicesYmlUrl);
    await sleep(1_000);

    if (
      servicesContent !== null &&
      servicesContent.length >= 200 &&
      (servicesContent.includes('services:') || servicesContent.includes('tags:'))
    ) {
      await writeFile(servicesYmlDest, servicesContent, 'utf8');
      console.log(`  ✓  ${module}: saved ${module}.services.yml (${servicesContent.length} bytes)`);
      servicesYmlFetched++;
    }
    else {
      console.log(`  –  ${module}: no .services.yml found or too small`);
      servicesYmlSkipped++;
    }
  }

  console.log('\n=== Fetch complete ===');
  console.log(`  .api.php files fetched : ${apiPhpFetched}`);
  console.log(`  .api.php files skipped : ${apiPhpSkipped}`);
  console.log(`  .services.yml fetched  : ${servicesYmlFetched}`);
  console.log(`  .services.yml skipped  : ${servicesYmlSkipped}`);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
