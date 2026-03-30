import { parsePHPDocFiles, parseDocset, parseUserGuideMarkdown } from './parser.js';
import { parseDeveloperGuides } from './parse-developer-guides.js';
import { parseTutorials } from './parse-tutorials.js';
import { parseSymfonyDocs } from './parse-symfony.js';
import { parsePHPManual } from './parse-php-manual.js';
import { parseContribModules } from './parse-contrib-modules.js';
import { parseCertificationDocs } from './parse-certification-docs.js';
import { parseApiDrupalOrgDocs } from './parse-api-drupal-org.js';
import { parseContribModuleCode, canAccess as canAccessContribModuleCode } from './parse-contrib-module-code.js';
import { parseBestPractices } from './parse-best-practices.js';
import { parseChangeRecords } from './parse-change-records.js';
import { parseDrupalExamples } from './parse-drupal-examples.js';
import { parseCoreModuleCode } from './parse-core-module-code.js';
import { parseContribModuleHandbook } from './parse-contrib-module-handbook.js';
import { parseDrupalModuleHandbook } from './parse-drupal-module-handbook.js';
import { chunkPages } from './chunker.js';
import { embedChunks } from './embedder.js';
import { loadChunks } from './loader.js';
import { validateConfig } from '../src/config.js';
import * as lancedb from '@lancedb/lancedb';
import { execSync } from 'child_process';

const isDryRun = process.argv.includes('--dry-run');

async function main() {
  const startTime = Date.now();
  const config = validateConfig();

  console.error('═══════════════════════════════════════════════════');
  console.error('  Drupal Core Docs ETL Pipeline');
  console.error(`  Dry run: ${isDryRun}`);
  console.error('═══════════════════════════════════════════════════\n');

  // ── [0/4] Fetch Developer Guides ─────────────────────────────
  console.error('━━━ [0/4] Fetching Developer Guides ━━━');
  try {
    // Use Playwright-based fetcher wrapper (new): it implements stealth, retries,
    // and --skip-existing behavior. Replaces legacy curl-based fetch script.
    execSync('bash scripts/fetch-developer-guides-playwright.sh', { stdio: 'inherit' });
  } catch (err) {
    console.error('⚠ Failed to fetch Developer Guides (playwright):', err);
  }
  try {
    execSync('bash scripts/fetch-tutorials.sh', { stdio: 'inherit' });
  } catch (err) {
    console.error('⚠ Failed to fetch Tutorials:', err);
  }

  // Symfony docs
  try { execSync('bash scripts/fetch-symfony-docs.sh', { stdio: 'inherit' }); }
  catch (e) { console.warn('⚠ fetch-symfony-docs failed, continuing...'); }

  // PHP manual
  try { execSync('bash scripts/fetch-php-manual.sh', { stdio: 'inherit' }); }
  catch (e) { console.warn('⚠ fetch-php-manual failed, continuing...'); }

  // Contrib modules
  try { execSync('bash scripts/fetch-contrib-modules.sh', { stdio: 'inherit' }); }
  catch (e) { console.warn('⚠ fetch-contrib-modules failed, continuing...'); }

  // Contrib module handbook pages
  try { execSync('npx tsx scripts/fetch-contrib-module-handbook.ts', { stdio: 'inherit' }); }
  catch (e) { console.warn('⚠ fetch-contrib-module-handbook failed, continuing...'); }

  // Drupal module developer handbook
  try { execSync('npx tsx scripts/fetch-drupal-module-handbook.ts', { stdio: 'inherit' }); }
  catch (e) { console.warn('⚠ fetch-drupal-module-handbook failed, continuing...'); }

  // Certification docs
  try { execSync('bash scripts/fetch-certification-docs.sh', { stdio: 'inherit' }); }
  catch (e) { console.warn('⚠ fetch-certification-docs failed, continuing...'); }

  // api.drupal.org topic docs
  try { execSync('bash scripts/fetch-api-drupal-org.sh', { stdio: 'inherit' }); }
  catch (e) { console.warn('⚠ fetch-api-drupal-org failed, continuing...'); }

  // Contrib module source code
  try { execSync('bash scripts/fetch-contrib-module-code.sh', { stdio: 'inherit' }); }
  catch (e) { console.warn('⚠ fetch-contrib-module-code failed, continuing...'); }

  // Change records (deprecations, API changes, features, security updates)
  try { execSync('bash scripts/fetch-change-records.sh', { stdio: 'inherit' }); }
  catch (e) { console.warn('⚠ fetch-change-records failed, continuing...'); }

  // Drupal Examples source code
  try { execSync('bash scripts/fetch-drupal-examples.sh', { stdio: 'inherit' }); }
  catch (e) { console.warn('⚠ fetch-drupal-examples failed, continuing...'); }

  // ── [1/4] Parse ──────────────────────────────────────────────
  console.error('━━━ [1/4] Parsing documentation sources ━━━');

  const coreDir = `${config.etlSourcesDir}/drupal-core`;
  const docsetDir = `${config.etlSourcesDir}/Drupal.docset`;
  const userGuideMd = `${config.etlSourcesDir}/drupal-user-guide.md`;
  const phpdocPromise = parsePHPDocFiles(coreDir, config.drupalCoreBranch).catch(err => { console.error(`  ⚠ PHPDoc parser failed: ${err.message}`); return []; });
  // Drupal.docset parsing disabled: content overlaps with drupal_phpdoc but lower quality.
  // Parsing was kept here previously but chunks are excluded from all table loads,
  // wastefully spending embedding tokens. Re-enable only if a dedicated docset table is added.
  // const docsetPages = await parseDocset(docsetDir, config.drupalCoreBranch);
  const docsetPromise = Promise.resolve([] as any[]);
  const guidePromise = parseUserGuideMarkdown(userGuideMd).catch(err => { console.error(`  ⚠ User Guide parser failed: ${err.message}`); return []; });
  const developerPromise = Promise.resolve()
    .then(() => parseDeveloperGuides())
    .catch(err => { console.error(`  ⚠ Developer Guides parser failed: ${err.message}`); return []; });
  const tutorialsPromise = parseTutorials(config.etlSourcesDir)
    .catch(err => { console.error(`  ⚠ Tutorials parser failed: ${err.message}`); return []; });
  const symfonyPromise = parseSymfonyDocs(config.etlSourcesDir)
    .catch(err => { console.error(`  ⚠ Symfony parser failed: ${err.message}`); return []; });
  const phpManualPromise = parsePHPManual(config.etlSourcesDir)
    .catch(err => { console.error(`  ⚠ PHP manual parser failed: ${err.message}`); return []; });
  const contribPromise = parseContribModules(config.etlSourcesDir)
    .catch(err => { console.error(`  ⚠ Contrib modules parser failed: ${err.message}`); return []; });
  const certPromise = parseCertificationDocs(config.etlSourcesDir)
    .catch(err => { console.error(`  ⚠ Certification docs parser failed: ${err.message}`); return []; });
  const bestPracticesPromise = parseBestPractices(config.etlSourcesDir)
    .catch(err => { console.error(`  ⚠ Best practices parser failed: ${err.message}`); return []; });
  const apiDrupalOrgPromise = parseApiDrupalOrgDocs(config.etlSourcesDir)
    .catch(err => { console.error(`  ⚠ api.drupal.org parser failed: ${err.message}`); return []; });
  const contribCodePromise = canAccessContribModuleCode()
    ? parseContribModuleCode().catch(err => { console.error(`  ⚠ Contrib module code parser failed: ${err.message}`); return []; })
    : Promise.resolve([]);
  const changeRecordsPromise = parseChangeRecords(config.etlSourcesDir)
    .catch(err => { console.error(`  ⚠ Change records parser failed: ${err.message}`); return []; });
  const examplesPromise = parseDrupalExamples(config.etlSourcesDir)
    .catch(err => { console.error(`  ⚠ Drupal Examples parser failed: ${err.message}`); return []; });
  const coreModuleCodePromise = parseCoreModuleCode(coreDir, config.drupalCoreBranch)
    .catch(err => { console.error(`  ⚠ Core module code parser failed: ${err.message}`); return []; });

  const [
    phpdocPages,
    docsetPages,
    guidePages,
    developerPages,
    tutorialPages,
    symfonyPages,
    phpManualPages,
    contribPages,
    certPages,
    bestPracticesPages,
    apiDrupalOrgPages,
    contribCodePages,
    changeRecordsPages,
    examplesPages,
    coreModuleCodePages,
    contribModuleHandbookPages,
    drupalModuleHandbookPages,
  ] = await Promise.all([
    phpdocPromise,
    docsetPromise,
    guidePromise,
    developerPromise,
    tutorialsPromise,
    symfonyPromise,
    phpManualPromise,
    contribPromise,
    certPromise,
    bestPracticesPromise,
    apiDrupalOrgPromise,
    contribCodePromise,
    changeRecordsPromise,
    examplesPromise,
    coreModuleCodePromise,
    parseContribModuleHandbook().then(pages => { console.error(`  contrib_module_handbook: ${pages.length} pages`); return pages; }),
    parseDrupalModuleHandbook().then(pages => { console.error(`  drupal_module_handbook: ${pages.length} pages`); return pages; }),
  ]);

  const allPages = [
    ...phpdocPages,
    ...docsetPages,
    ...guidePages,
    ...developerPages,
    ...tutorialPages,
    ...symfonyPages,
    ...phpManualPages,
    ...contribPages,
    ...certPages,
    ...bestPracticesPages,
    ...apiDrupalOrgPages,
    ...contribCodePages,
    ...changeRecordsPages,
    ...examplesPages,
    ...coreModuleCodePages,
    ...contribModuleHandbookPages,
    ...drupalModuleHandbookPages,
  ].map((p: any) => {
    if ('text' in p && 'metadata' in p) return p;
    return {
      text: p.content,
      metadata: {
        source: 'developer_guides',
        symbol_name: p.title,
        fqcn: null,
        file_path: p.path,
        drupal_version: 'all',
        section: p.title,
        ingested_at: new Date().toISOString(),
      },
    };
  });


  console.error(`\n  📊 Parse results:`);
  console.error(`     PHPDoc:     ${phpdocPages.length.toLocaleString()} pages`);
  console.error(`     Docset:     ${docsetPages.length.toLocaleString()} pages`);
  console.error(`     User Guide: ${guidePages.length.toLocaleString()} pages`);
  console.error(`     Developer Guides: ${developerPages.length.toLocaleString()} pages`);
  console.error(`     Tutorials: ${tutorialPages.length.toLocaleString()} pages`);
  console.error(`     Symfony Docs: ${symfonyPages.length.toLocaleString()} pages`);
  console.error(`     PHP Manual: ${phpManualPages.length.toLocaleString()} pages`);
  console.error(`     Contrib Modules: ${contribPages.length.toLocaleString()} pages`);
  console.error(`     Certification Docs: ${certPages.length.toLocaleString()} pages`);
  console.error(`     Best Practices: ${bestPracticesPages.length.toLocaleString()} pages`);
  console.error(`     api.drupal.org: ${apiDrupalOrgPages.length.toLocaleString()} pages`);
  console.error(`     Contrib Module Code: ${contribCodePages.length.toLocaleString()} pages`);
  console.error(`     Change Records: ${changeRecordsPages.length.toLocaleString()} pages`);
  console.error(`     Drupal Examples: ${examplesPages.length.toLocaleString()} pages`);
  console.error(`     Core Module Code: ${coreModuleCodePages.length.toLocaleString()} pages`);
  console.error(`     Contrib Module Handbook: ${contribModuleHandbookPages.length.toLocaleString()} pages`);
  console.error(`     Drupal Module Handbook: ${drupalModuleHandbookPages.length.toLocaleString()} pages`);
  console.error(`     Total:      ${allPages.length.toLocaleString()} pages\n`);

  if (allPages.length === 0) {
    console.error('❌ No pages parsed from any source. Check data/sources/ directory.');
    process.exit(1);
  }

  // ── [2/4] Chunk ──────────────────────────────────────────────
  console.error('━━━ [2/4] Chunking pages ━━━');
  const chunks = await chunkPages(allPages);

  console.error(`\n  📊 Chunk results:`);
  console.error(`     Total chunks: ${chunks.length.toLocaleString()}`);

  // Estimate cost
  const avgCharsPerChunk = chunks.reduce((sum, c) => sum + c.text.length, 0) / chunks.length;
  const avgTokensPerChunk = avgCharsPerChunk / 4; // rough estimate
  const totalTokens = avgTokensPerChunk * chunks.length;
  const estimatedCost = (totalTokens / 1_000_000) * 0.02; // text-embedding-3-small pricing
  console.error(`     Avg chars/chunk: ${Math.round(avgCharsPerChunk)}`);
  console.error(`     Est. tokens: ${Math.round(totalTokens).toLocaleString()}`);
  console.error(`     Est. embedding cost: $${estimatedCost.toFixed(3)}\n`);

  // ── Dry Run Exit ─────────────────────────────────────────────
  if (isDryRun) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.error('═══════════════════════════════════════════════════');
    console.error('  🏁 DRY RUN COMPLETE');
    console.error(`  Pages: ${allPages.length.toLocaleString()} | Chunks: ${chunks.length.toLocaleString()}`);
    console.error(`  Estimated cost: $${estimatedCost.toFixed(3)}`);
    console.error(`  Elapsed: ${elapsed}s`);
    console.error('  No API calls made. No database writes.');
    console.error('═══════════════════════════════════════════════════');
    return;
  }

  // ── [3/4] Embed ──────────────────────────────────────────────
  console.error('━━━ [3/4] Embedding chunks ━━━');
  const embedded = await embedChunks(chunks);
  console.error(`  ✓ ${embedded.length.toLocaleString()} chunks embedded\n`);

  // ── [4/4] Load ───────────────────────────────────────────────
  console.error('━━━ [4/4] Loading into LanceDB ━━━');
  const allEmbedded = embedded;
  const coreChunks = allEmbedded.filter(
    (c) => ![
      'developer_guides',
      'drupal_tutorials',
      'symfony_docs',
      'php_docs',
      'contrib_module_docs',
      'certification_docs',
      'drupal_best_practices',
      'api_drupal_org',
      'contrib_module_code',
      'drupal_examples',
      'core_module_code',
      'change_records', // excluded: loaded to separate change_records table
      'drupal_docset', // excluded: docset HTML overlaps with drupal_phpdoc; phpdoc is higher-quality
      'contrib_module_handbook',
      'drupal_module_handbook',
    ].includes(c.metadata.source),
  );
  const developerChunks = allEmbedded.filter(c => c.metadata.source === 'developer_guides');
  const tutorialsEmbedded = allEmbedded.filter(c => c.metadata.source === 'drupal_tutorials');

  process.env.LANCEDB_TABLE_NAME = 'drupal_core_docs';
  await loadChunks(coreChunks, config.lancedbPath);

  if (developerChunks.length > 0) {
    console.error('━━━ [4b/4] Loading Developer Guides into LanceDB ━━━');
    process.env.LANCEDB_TABLE_NAME = 'drupal_developer_guides';
    await loadChunks(developerChunks, config.lancedbPath);
  }

  if (tutorialsEmbedded.length > 0) {
    console.error('━━━ [4c/4] Loading Tutorials into LanceDB ━━━');
    process.env.LANCEDB_TABLE_NAME = 'drupal_tutorials';
    await loadChunks(tutorialsEmbedded, config.lancedbPath);
  }

  const symfonyEmbedded = allEmbedded.filter(c => c.metadata.source === 'symfony_docs');
  if (symfonyEmbedded.length > 0) {
    process.env.LANCEDB_TABLE_NAME = 'symfony_docs';
    await loadChunks(symfonyEmbedded, config.lancedbPath);
  }

  const phpEmbedded = allEmbedded.filter(c => c.metadata.source === 'php_docs');
  if (phpEmbedded.length > 0) {
    process.env.LANCEDB_TABLE_NAME = 'php_docs';
    await loadChunks(phpEmbedded, config.lancedbPath);
  }

  const contribEmbedded = allEmbedded.filter(c => c.metadata.source === 'contrib_module_docs');
  if (contribEmbedded.length > 0) {
    process.env.LANCEDB_TABLE_NAME = 'contrib_module_docs';
    await loadChunks(contribEmbedded, config.lancedbPath);
  }

  const certEmbedded = allEmbedded.filter(c => c.metadata.source === 'certification_docs');
  if (certEmbedded.length > 0) {
    process.env.LANCEDB_TABLE_NAME = 'certification_docs';
    await loadChunks(certEmbedded, config.lancedbPath);
  }

  const bestPracticesEmbedded = allEmbedded.filter(c => c.metadata.source === 'drupal_best_practices');
  if (bestPracticesEmbedded.length > 0) {
    process.env.LANCEDB_TABLE_NAME = 'drupal_best_practices';
    await loadChunks(bestPracticesEmbedded, config.lancedbPath);
  }

  const apiDrupalOrgEmbedded = allEmbedded.filter(c => c.metadata.source === 'api_drupal_org');
  if (apiDrupalOrgEmbedded.length > 0) {
    console.error('━━━ [4g/4] Loading api.drupal.org docs into LanceDB ━━━');
    process.env.LANCEDB_TABLE_NAME = 'api_drupal_org_docs';
    await loadChunks(apiDrupalOrgEmbedded, config.lancedbPath);
  }

  const contribCodeEmbedded = allEmbedded.filter(c => c.metadata.source === 'contrib_module_code');
  if (contribCodeEmbedded.length > 0) {
    console.error('━━━ [4h/4] Loading Contrib Module Code into LanceDB ━━━');
    process.env.LANCEDB_TABLE_NAME = 'contrib_module_code';
    await loadChunks(contribCodeEmbedded, config.lancedbPath);
  }

  const changeRecordsEmbedded = allEmbedded.filter(c => c.metadata.source === 'change_records');
  if (changeRecordsEmbedded.length > 0) {
    console.error('━━━ [4i/4] Loading Change Records into LanceDB ━━━');
    process.env.LANCEDB_TABLE_NAME = 'change_records';
    await loadChunks(changeRecordsEmbedded, config.lancedbPath);
  }

  const examplesEmbedded = allEmbedded.filter(c => c.metadata.source === 'drupal_examples');
  if (examplesEmbedded.length > 0) {
    console.error('━━━ [4j/4] Loading Drupal Examples into LanceDB ━━━');
    process.env.LANCEDB_TABLE_NAME = 'drupal_examples';
    await loadChunks(examplesEmbedded, config.lancedbPath);
  }

  const coreModuleCodeEmbedded = allEmbedded.filter(c => c.metadata.source === 'core_module_code');
  if (coreModuleCodeEmbedded.length > 0) {
    console.error('━━━ [4k/4] Loading Core Module Code into LanceDB ━━━');
    process.env.LANCEDB_TABLE_NAME = 'core_module_code';
    await loadChunks(coreModuleCodeEmbedded, config.lancedbPath);
  }

  const contribModuleHandbookEmbedded = allEmbedded.filter(c => c.metadata.source === 'contrib_module_handbook');
  if (contribModuleHandbookEmbedded.length > 0) {
    console.error('━━━ [4l/4] Loading Contrib Module Handbook into LanceDB ━━━');
    process.env.LANCEDB_TABLE_NAME = 'contrib_module_handbook';
    await loadChunks(contribModuleHandbookEmbedded, config.lancedbPath);
  }

  const drupalModuleHandbookEmbedded = allEmbedded.filter(c => c.metadata.source === 'drupal_module_handbook');
  if (drupalModuleHandbookEmbedded.length > 0) {
    console.error('━━━ [4m/4] Loading Drupal Module Handbook into LanceDB ━━━');
    process.env.LANCEDB_TABLE_NAME = 'drupal_module_handbook';
    await loadChunks(drupalModuleHandbookEmbedded, config.lancedbPath);
  }
  const db = await lancedb.connect(config.lancedbPath);
  const coreTable = await db.openTable('drupal_core_docs');
  const coreCount = await coreTable.countRows();
  let devCount = 0;
  let tutorialsCount = 0;
  let symfonyCount = 0;
  let phpCount = 0;
  let contribCount = 0;
  let certCount = 0;
  let bestPracticesCount = 0;
  let apiDrupalOrgCount = 0;
  let contribCodeCount = 0;
  let changeRecordsCount = 0;
  let examplesCount = 0;
  let coreModuleCodeCount = 0;
  let contribModuleHandbookCount = 0;
  let drupalModuleHandbookCount = 0;
  try {
    const devTable = await db.openTable('drupal_developer_guides');
    devCount = await devTable.countRows();
  } catch {
    console.error('⚠ Developer Guides table not found');
  }
  try {
    const tutorialsTable = await db.openTable('drupal_tutorials');
    tutorialsCount = await tutorialsTable.countRows();
  } catch {
    console.error('⚠ Tutorials table not found');
  }
  try {
    const symfonyTable = await db.openTable('symfony_docs');
    symfonyCount = await symfonyTable.countRows();
  } catch {
    console.error('⚠ Symfony docs table not found');
  }
  try {
    const phpTable = await db.openTable('php_docs');
    phpCount = await phpTable.countRows();
  } catch {
    console.error('⚠ PHP docs table not found');
  }
  try {
    const contribTable = await db.openTable('contrib_module_docs');
    contribCount = await contribTable.countRows();
  } catch {
    console.error('⚠ Contrib module docs table not found');
  }
  try {
    const certTable = await db.openTable('certification_docs');
    certCount = await certTable.countRows();
  } catch {
    console.error('⚠ Certification docs table not found');
  }
  try {
    const bestPracticesTable = await db.openTable('drupal_best_practices');
    bestPracticesCount = await bestPracticesTable.countRows();
  } catch {
    console.error('⚠ Best practices table not found');
  }
  try {
    const apiDrupalOrgTable = await db.openTable('api_drupal_org_docs');
    apiDrupalOrgCount = await apiDrupalOrgTable.countRows();
  } catch {
    console.error('⚠ api.drupal.org docs table not found');
  }
  try {
    const contribCodeTable = await db.openTable('contrib_module_code');
    contribCodeCount = await contribCodeTable.countRows();
  } catch {
    console.error('⚠ Contrib module code table not found');
  }
  try {
    const changeRecordsTable = await db.openTable('change_records');
    changeRecordsCount = await changeRecordsTable.countRows();
  } catch {
    console.error('⚠ Change records table not found');
  }
  try {
    const examplesTable = await db.openTable('drupal_examples');
    examplesCount = await examplesTable.countRows();
  } catch {
    console.error('⚠ Drupal Examples table not found');
  }
  try {
    const coreModuleCodeTable = await db.openTable('core_module_code');
    coreModuleCodeCount = await coreModuleCodeTable.countRows();
  } catch {
    console.error('⚠ Core module code table not found');
  }
  try {
    const contribModuleHandbookTable = await db.openTable('contrib_module_handbook');
    contribModuleHandbookCount = await contribModuleHandbookTable.countRows();
  } catch {
    console.error('⚠ Contrib module handbook table not found');
  }
  try {
    const drupalModuleHandbookTable = await db.openTable('drupal_module_handbook');
    drupalModuleHandbookCount = await drupalModuleHandbookTable.countRows();
  } catch {
    console.error('⚠ Drupal module handbook table not found');
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.error('\n═══════════════════════════════════════════════════');
  console.error('  🏁 ETL COMPLETE');
  console.error(`  Pages: ${allPages.length.toLocaleString()}`);
  console.error(`  Chunks: ${chunks.length.toLocaleString()}`);
  console.error(`  Core Docs rows: ${coreCount.toLocaleString()}`);
  console.error(`  Developer Guides rows: ${devCount.toLocaleString()}`);
  console.error(`  Tutorials rows: ${tutorialsCount.toLocaleString()}`);
  console.error(`  Symfony Docs rows: ${symfonyCount.toLocaleString()}`);
  console.error(`  PHP Docs rows: ${phpCount.toLocaleString()}`);
  console.error(`  Contrib Module Docs rows: ${contribCount.toLocaleString()}`);
  console.error(`  Certification Docs rows: ${certCount.toLocaleString()}`);
  console.error(`  Best Practices rows: ${bestPracticesCount.toLocaleString()}`);
  console.error(`  api.drupal.org Docs rows: ${apiDrupalOrgCount.toLocaleString()}`);
  console.error(`  Contrib Module Code rows: ${contribCodeCount.toLocaleString()}`);
  console.error(`  Change Records rows: ${changeRecordsCount.toLocaleString()}`);
  console.error(`  Drupal Examples rows: ${examplesCount.toLocaleString()}`);
  console.error(`  Core Module Code rows: ${coreModuleCodeCount.toLocaleString()}`);
  console.error(`  Contrib Module Handbook rows: ${contribModuleHandbookCount.toLocaleString()}`);
  console.error(`  Drupal Module Handbook rows: ${drupalModuleHandbookCount.toLocaleString()}`);
  console.error(`  Elapsed: ${elapsed}s`);

  if (coreCount < 10000) {
    console.error('  ⚠ Core docs row count below 10,000 — check parser coverage');
  }
  if (developerChunks.length > 0 && devCount === 0) {
    console.error('  ⚠ Developer Guides parsed but not loaded');
  }
  if (tutorialsEmbedded.length > 0 && tutorialsCount === 0) {
    console.error('  ⚠ Tutorials parsed but not loaded');
  }
  if (symfonyEmbedded.length > 0 && symfonyCount === 0) {
    console.error('  ⚠ Symfony docs parsed but not loaded');
  }
  if (phpEmbedded.length > 0 && phpCount === 0) {
    console.error('  ⚠ PHP manual parsed but not loaded');
  }
  if (contribEmbedded.length > 0 && contribCount === 0) {
    console.error('  ⚠ Contrib module docs parsed but not loaded');
  }
  if (certEmbedded.length > 0 && certCount === 0) {
    console.error('  ⚠ Certification docs parsed but not loaded');
  }
  if (bestPracticesEmbedded.length > 0 && bestPracticesCount === 0) {
    console.error('  ⚠ Best practices docs parsed but not loaded');
  }
  if (apiDrupalOrgEmbedded.length > 0 && apiDrupalOrgCount === 0) {
    console.error('  ⚠ api.drupal.org docs parsed but not loaded');
  }
  if (contribCodeEmbedded.length > 0 && contribCodeCount === 0) {
    console.error('  ⚠ Contrib module code parsed but not loaded');
  }
  if (examplesEmbedded.length > 0 && examplesCount === 0) {
    console.error('  ⚠ Drupal Examples parsed but not loaded');
  }
  if (coreModuleCodeEmbedded.length > 0 && coreModuleCodeCount === 0) {
    console.error('  ⚠ Core module code parsed but not loaded');
  }
  if (contribModuleHandbookEmbedded.length > 0 && contribModuleHandbookCount === 0) {
    console.error('  ⚠ Contrib module handbook parsed but not loaded');
  }
  if (drupalModuleHandbookEmbedded.length > 0 && drupalModuleHandbookCount === 0) {
    console.error('  ⚠ Drupal module handbook parsed but not loaded');
  }
  console.error('═══════════════════════════════════════════════════');
}

main().catch((err) => {
  console.error('❌ ETL pipeline failed:', err);
  process.exit(1);
});
