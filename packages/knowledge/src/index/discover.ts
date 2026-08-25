import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { contentHash, documentId } from '../ids.js';
import { SOURCE_BY_KEY } from '../registry.js';
import type { NormalizedDocument } from '../types.js';

const CODE_EXTENSIONS = new Set(['.php', '.module', '.install', '.theme', '.yml']);
const TEXT_EXTENSIONS = new Set(['.md', '.txt', '.rst', '.html', '.htm', '.json']);
const SKIP_DIRECTORIES = new Set(['.git', 'node_modules', 'vendor', 'tests', 'test', 'fixtures', 'css', 'js', 'images']);

async function walk(directory: string, limit = Number.POSITIVE_INFINITY): Promise<string[]> {
  const files: string[] = [];
  async function visit(current: string): Promise<void> {
    if (files.length >= limit) return;
    let entries;
    try { entries = await readdir(current, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (files.length >= limit) break;
      if (entry.isDirectory() && SKIP_DIRECTORIES.has(entry.name)) continue;
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      else if (entry.isFile()) files.push(absolute);
    }
  }
  await visit(directory);
  return files;
}

async function gitCommit(directory: string): Promise<string | undefined> {
  try {
    const head = await readFile(path.join(directory, '.git', 'HEAD'), 'utf8');
    if (head.startsWith('ref:')) {
      return (await readFile(path.join(directory, '.git', head.slice(5).trim()), 'utf8')).trim();
    }
    return head.trim();
  } catch { return undefined; }
}

function titleFromContent(file: string, content: string): string {
  const heading = content.match(/^#\s+(.+)$/m)?.[1] ?? content.match(/^Title:\s*(.+)$/m)?.[1];
  return heading?.trim() || path.basename(file);
}

function urlFromContent(content: string): string | undefined {
  return content.match(/^(?:URL Source|Source|Project page):\s*(https?:\/\/\S+)/m)?.[1];
}

async function documentsFromDirectory(options: {
  directory: string;
  sourceKey: string;
  drupalVersion: string;
  project?: string;
  commit?: string;
  compatibility?: string;
  includeCode: boolean;
  limit?: number;
}): Promise<NormalizedDocument[]> {
  const source = SOURCE_BY_KEY.get(options.sourceKey);
  if (!source) return [];
  const files = await walk(options.directory, options.limit);
  const documents: NormalizedDocument[] = [];
  for (const file of files) {
    const extension = path.extname(file).toLowerCase();
    if (!(options.includeCode ? CODE_EXTENSIONS.has(extension) || TEXT_EXTENSIONS.has(extension) : TEXT_EXTENSIONS.has(extension))) continue;
    const info = await stat(file);
    if (info.size === 0 || info.size > 500_000) continue;
    let content: string;
    try { content = await readFile(file, 'utf8'); } catch { continue; }
    if (content.trim().length < 40) continue;
    const relative = path.relative(options.directory, file).split(path.sep).join('/');
    const project = options.project ?? relative.split('/')[0];
    const locator = `${project}:${relative}`;
    documents.push({
      id: documentId(source.key, options.drupalVersion, locator),
      sourceKey: source.key,
      sourceType: source.type,
      authority: source.authority,
      project,
      drupalVersion: options.drupalVersion,
      title: titleFromContent(file, content),
      canonicalUrl: urlFromContent(content) ?? `${source.canonicalBaseUrl}/${relative}`,
      repositoryPath: relative,
      commit: options.commit,
      compatibility: options.compatibility,
      mimeType: extension === '.md' ? 'text/markdown' : CODE_EXTENSIONS.has(extension) ? 'text/plain' : 'text/plain',
      status: /@deprecated|\bdeprecated\b/i.test(content.slice(0, 4000)) ? 'deprecated' : 'current',
      content,
      contentHash: contentHash(content),
      modifiedAt: info.mtime.toISOString(),
    });
  }
  return documents;
}

export async function discoverDocuments(repoRoot: string, fixtureLimit?: number): Promise<NormalizedDocument[]> {
  const sources = path.join(repoRoot, 'data', 'sources');
  const documents: NormalizedDocument[] = [];
  const coreConfigs = [
    { directory: 'drupal-core-10.6', sourceKey: 'drupal_core_10', version: '10.6' },
    { directory: 'drupal-core-11.4', sourceKey: 'drupal_core_11', version: '11.4' },
  ];
  for (const core of coreConfigs) {
    const directory = path.join(sources, core.directory);
    try {
      const commit = await gitCommit(directory);
      documents.push(...await documentsFromDirectory({ directory, sourceKey: core.sourceKey, drupalVersion: core.version, project: 'drupal', commit, includeCode: true, limit: fixtureLimit }));
    } catch { /* source is optional until fetched */ }
  }

  // Existing 11.x checkout remains a useful fallback during the first local rebuild.
  if (!documents.some(document => document.drupalVersion === '11.4')) {
    const directory = path.join(sources, 'drupal-core');
    documents.push(...await documentsFromDirectory({ directory, sourceKey: 'drupal_core_11', drupalVersion: '11.4', project: 'drupal', commit: await gitCommit(directory), includeCode: true, limit: fixtureLimit }));
  }

  const contribRoot = path.join(sources, 'contrib-module-code');
  let contribProjects: string[] = [];
  try { contribProjects = (await readdir(contribRoot, { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => entry.name); } catch { /* optional */ }
  for (const project of contribProjects) {
    const directory = path.join(contribRoot, project);
    let compatibility: string | undefined;
    try {
      const infoFiles = (await readdir(directory)).filter(file => file.endsWith('.info.yml'));
      if (infoFiles[0]) compatibility = String(parseYaml(await readFile(path.join(directory, infoFiles[0]), 'utf8'))?.core_version_requirement ?? '') || undefined;
    } catch { /* compatibility remains explicit unknown */ }
    documents.push(...await documentsFromDirectory({ directory, sourceKey: 'contrib_code', drupalVersion: 'all', project, compatibility, commit: await gitCommit(directory), includeCode: true, limit: fixtureLimit }));
  }

  const examplesDirectory = path.join(sources, 'drupal-examples');
  documents.push(...await documentsFromDirectory({ directory: examplesDirectory, sourceKey: 'drupal_examples', drupalVersion: 'all', project: 'examples', commit: await gitCommit(examplesDirectory), includeCode: true, limit: fixtureLimit }));

  const textSources = [
    ['drupal-developer-guides', 'developer_guides'], ['drupal-module-handbook', 'module_handbook'],
    ['drupal-skills', 'drupal_skills'], ['tutorials', 'tutorials'], ['symfony-docs', 'symfony_docs'],
    ['php-manual', 'php_docs'], ['certification', 'certification'], ['contrib-modules', 'contrib_docs'],
    ['api-drupal-org', 'api_drupal_org'], ['change-records', 'change_records'],
  ] as const;
  for (const [folder, sourceKey] of textSources) {
    const directory = path.join(sources, folder);
    documents.push(...await documentsFromDirectory({ directory, sourceKey, drupalVersion: 'all', includeCode: false, limit: fixtureLimit }));
  }
  return documents;
}
