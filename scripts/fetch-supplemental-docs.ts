/**
 * Fetch supplemental official documentation sources via the Jina reader:
 *
 *   - Drupal User Guide (site-building book, ~120 pages)
 *   - Drush docs 13.x  (CLI for building/deploying sites, ~56 pages)
 *   - Twig docs 3.x    (template language reference, ~145 pages)
 *
 * Each site is crawled starting from its index page; discovered same-site
 * doc links are fetched and saved as markdown under data/sources/<dir>/.
 * Files already larger than 1 KB are skipped (incremental refetch).
 *
 * Usage:
 *   npx tsx scripts/fetch-supplemental-docs.ts            # all sites
 *   npx tsx scripts/fetch-supplemental-docs.ts user-guide # one site
 */

import { writeFile, mkdir, stat, readdir } from 'node:fs/promises';
import path from 'node:path';

interface SiteConfig {
  /** Subdirectory of data/sources/ for this site. */
  dir: string;
  /** Starting page whose links seed the crawl. */
  indexUrl: string;
  /** Only links matching this prefix (after normalization) are fetched. */
  linkFilter: (url: string) => boolean;
  /** Derives the output filename from a doc URL. */
  fileName: (url: string) => string;
}

const SITES: SiteConfig[] = [
  {
    dir: 'drupal-user-guide',
    indexUrl: 'https://www.drupal.org/docs/user_guide/en/index.html',
    linkFilter: url => url.startsWith('https://www.drupal.org/docs/user_guide/en/') && url.endsWith('.html'),
    fileName: url => url.split('/').pop() ?? 'page.html',
  },
  {
    dir: 'drush-docs',
    indexUrl: 'https://www.drush.org/13.x/',
    linkFilter: url => url.startsWith('https://www.drush.org/13.x/'),
    fileName: url => {
      const slug = url.replace('https://www.drush.org/13.x/', '').replace(/\/$/, '').replace(/\//g, '__');
      return `${slug || 'index'}.md`;
    },
  },
  {
    dir: 'twig-docs',
    indexUrl: 'https://twig.symfony.com/doc/3.x/',
    linkFilter: url => url.startsWith('https://twig.symfony.com/doc/3.x/') && (url.endsWith('.html') || url.endsWith('/3.x/')),
    fileName: url => {
      const slug = url.replace('https://twig.symfony.com/doc/3.x/', '').replace(/\.html$/, '').replace(/\//g, '__');
      return `${slug || 'index'}.md`;
    },
  },
  {
    dir: 'drupal-coding-standards',
    indexUrl: 'https://www.drupal.org/docs/develop/coding-standards',
    linkFilter: url => url.startsWith('https://www.drupal.org/docs/develop/coding-standards/'),
    fileName: url => {
      const slug = url.replace('https://www.drupal.org/docs/develop/coding-standards', '').replace(/^\/+/, '').replace(/\/$/, '');
      return `${slug || 'index'}.md`;
    },
  },
  {
    dir: 'php-fig',
    indexUrl: 'https://www.php-fig.org/psr/',
    linkFilter: url => /^https:\/\/www\.php-fig\.org\/psr\/psr-\d+\/?$/.test(url),
    fileName: url => {
      const slug = url.replace('https://www.php-fig.org/psr/', '').replace(/\/$/, '');
      return `${slug || 'index'}.md`;
    },
  },
  {
    dir: 'twelve-factor',
    indexUrl: 'https://12factor.net/',
    linkFilter: url => /^https:\/\/12factor\.net\/[a-z0-9-]+$/.test(url),
    fileName: url => `${url.replace('https://12factor.net/', '') || 'index'}.md`,
  },
  {
    dir: 'drupal-theming-guide',
    indexUrl: 'https://www.drupal.org/docs/develop/theming-drupal',
    linkFilter: url => url.startsWith('https://www.drupal.org/docs/develop/theming-drupal/') || url === 'https://www.drupal.org/docs/develop/theming-drupal',
    fileName: url => {
      const slug = url.replace('https://www.drupal.org/docs/develop/theming-drupal', '').replace(/^\/+/, '').replace(/\/$/, '');
      return `${slug || 'index'}.md`;
    },
  },
  {
    dir: 'ms-cloud-patterns',
    indexUrl: 'https://learn.microsoft.com/en-us/azure/architecture/patterns/',
    linkFilter: url => /^https:\/\/learn\.microsoft\.com\/en-us\/azure\/architecture\/patterns\/[a-z-]+$/.test(url),
    fileName: url => `${url.replace('https://learn.microsoft.com/en-us/azure/architecture/patterns/', '') || 'index'}.md`,
  },
  {
    dir: 'eip-patterns',
    indexUrl: 'https://www.enterpriseintegrationpatterns.com/patterns/messaging/toc.html',
    linkFilter: url => /^https:\/\/www\.enterpriseintegrationpatterns\.com\/patterns\/messaging\/[a-zA-Z0-9]+\.html$/.test(url) && !url.endsWith('/toc.html'),
    fileName: url => `${(url.split('/').pop() ?? 'index').replace(/\.html$/, '')}.md`,
  },
  {
    dir: 'gof-patterns',
    indexUrl: 'https://sourcemaking.com/design_patterns',
    linkFilter: url => /^https:\/\/sourcemaking\.com\/design_patterns\/[a-z0-9_]+$/.test(url),
    fileName: url => {
      const slug = url.replace('https://sourcemaking.com/design_patterns', '').replace(/^\/+/, '');
      return `${slug || 'index'}.md`;
    },
  },
];

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fileExistsAndLarge(filePath: string, minBytes = 1_000): Promise<boolean> {
  try {
    return (await stat(filePath)).size > minBytes;
  } catch {
    return false;
  }
}

async function fetchViaJina(url: string): Promise<string | null> {
  try {
    const res = await fetch(`https://r.jina.ai/${url}`, {
      headers: {
        'User-Agent': 'DrupalDevMCP/1.0 (+https://github.com/example/drupal-dev-mcp)',
        'Accept': 'text/markdown, text/plain, */*',
      },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

/** Extracts same-site doc links from rendered markdown. */
function linksFromMarkdown(markdown: string, filter: (url: string) => boolean): string[] {
  const urls = markdown.match(/https:\/\/[^\s)\]]+/g) ?? [];
  const cleaned = urls
    .map(url => url.replace(/[.,;]+$/, ''))
    // Drop trailing anchor fragments: they point back into the same page.
    .map(url => url.replace(/#.*$/, ''))
    .filter(url => url.length > 0 && filter(url));
  return [...new Set(cleaned)];
}

/** Strips the Jina preamble (Title/URL Source/Markdown Content headers) for cleaner chunks. */
function stripJinaPreamble(markdown: string): string {
  return markdown
    .replace(/^Title: .*\n/m, '')
    .replace(/^URL Source: .*\n/m, '')
    .replace(/^Markdown Content:\n/m, '')
    .trimStart();
}

async function fetchSite(site: SiteConfig): Promise<void> {
  const destDir = path.join('data/sources', site.dir);
  await mkdir(destDir, { recursive: true });

  console.log(`\n=== ${site.dir} ===`);
  console.log(`Index: ${site.indexUrl}`);
  const indexMarkdown = await fetchViaJina(site.indexUrl);
  if (!indexMarkdown) {
    console.error('  ⚠ failed to fetch index page; skipping site.');
    return;
  }
  const existing = new Set(await readdir(destDir).catch(() => [] as string[]));
  const links = linksFromMarkdown(indexMarkdown, site.linkFilter);
  // Always include the index page itself.
  const targets = [site.indexUrl, ...links.filter(url => url !== site.indexUrl)];
  console.log(`Discovered ${links.length} links (+ index page)`);

  let fetched = 0;
  let skipped = 0;
  let failed = 0;
  for (const url of targets) {
    const fileName = site.fileName(url);
    const filePath = path.join(destDir, fileName);
    if (fileName !== 'index.md' && (existing.has(fileName) || (await fileExistsAndLarge(filePath)))) {
      skipped += 1;
      continue;
    }
    process.stdout.write(`  ↓ ${url} ... `);
    const markdown = await fetchViaJina(url);
    if (!markdown || markdown.length < 500 || markdown.includes('Page not found')) {
      console.log('✗');
      failed += 1;
      continue;
    }
    const header = `<!-- fetched: ${new Date().toISOString()} -->\n<!-- source: ${url} -->\n\n`;
    await writeFile(filePath, header + stripJinaPreamble(markdown), 'utf8');
    console.log(`✓ (${markdown.length} bytes)`);
    fetched += 1;
    await sleep(1_500);
  }

  console.log(`Site complete — fetched: ${fetched}, skipped: ${skipped}, failed: ${failed}`);
}

async function main(): Promise<void> {
  const requested = process.argv.slice(2).filter(arg => !arg.startsWith('-'));
  const sites = requested.length
    ? SITES.filter(site => requested.some(name => site.dir.includes(name)))
    : SITES;
  if (sites.length === 0) {
    console.error(`No matching sites. Known dirs: ${SITES.map(site => site.dir).join(', ')}`);
    process.exitCode = 1;
    return;
  }
  for (const site of sites) await fetchSite(site);
}

void main();
