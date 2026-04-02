import { access, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { ParsedPage, SourceMetadata } from './parser.js';

const SOURCE_NAME = 'drupal_skills';

/**
 * Strip YAML frontmatter from a markdown document.
 * Returns { frontmatter, body } where frontmatter is the raw key:value text
 * between the opening and closing `---` fences, and body is the remainder.
 */
function stripFrontmatter(content: string): { frontmatter: Record<string, string>; body: string } {
  const normalized = content.replace(/\r\n/g, '\n').trim();
  const frontmatter: Record<string, string> = {};

  if (!normalized.startsWith('---')) {
    return { frontmatter, body: normalized };
  }

  const end = normalized.indexOf('\n---', 3);
  if (end === -1) {
    return { frontmatter, body: normalized };
  }

  const fmBlock = normalized.slice(3, end).trim();
  const body = normalized.slice(end + 4).trim();

  for (const line of fmBlock.split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();
    if (key) {
      frontmatter[key] = value;
    }
  }

  return { frontmatter, body };
}

/**
 * Split markdown content by any heading level (# through ######).
 * Returns an array of { title, text } sections.
 */
function splitByHeadings(content: string): Array<{ title: string; text: string }> {
  const normalized = content.replace(/\r\n/g, '\n').trim();
  if (!normalized) {
    return [];
  }

  const headingRe = /^(#{1,6})\s+(.+)$/gm;
  const matches = [...normalized.matchAll(headingRe)];

  if (matches.length === 0) {
    return [{ title: 'Overview', text: normalized }];
  }

  const sections: Array<{ title: string; text: string }> = [];
  for (let i = 0; i < matches.length; i += 1) {
    const current = matches[i];
    const next = matches[i + 1];
    const start = current.index ?? 0;
    const end = next?.index ?? normalized.length;
    const title = (current[2] ?? 'Overview').trim();
    const text = normalized.slice(start, end).trim();

    if (text.length > 0) {
      sections.push({ title, text });
    }
  }

  return sections;
}

/**
 * Recursively collect all .md files under a directory.
 * Skips non-content files: .sync-metadata, LICENSE, CONTRIBUTING.md, AGENTS.md, install.sh, README.md at root.
 */
async function collectMarkdownFiles(rootDir: string, skipRootReadme = false): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(rootDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name);

    if (entry.isDirectory()) {
      // Skip hidden directories (.git, .claude, etc.)
      if (entry.name.startsWith('.')) continue;
      files.push(...(await collectMarkdownFiles(fullPath)));
      continue;
    }

    if (!entry.isFile()) continue;

    const lowerName = entry.name.toLowerCase();

    // Skip root-level metadata/non-content files
    if (skipRootReadme && lowerName === 'readme.md') continue;

    // Skip non-markdown files
    if (!lowerName.endsWith('.md')) continue;

    files.push(fullPath);
  }

  return files;
}

/**
 * Deduplicate pages by a 200-char fingerprint of the normalised text.
 * Keeps the first occurrence when duplicates are found.
 */
function deduplicateByFingerprint(pages: ParsedPage[]): ParsedPage[] {
  const seenFingerprints = new Set<string>();
  const dedupedPages: ParsedPage[] = [];

  for (const page of pages) {
    const normalised = page.text.toLowerCase().replace(/\s+/g, ' ').trim();
    const fingerprint = normalised.slice(0, 200);
    if (seenFingerprints.has(fingerprint)) {
      continue;
    }
    seenFingerprints.add(fingerprint);
    dedupedPages.push(page);
  }

  return dedupedPages;
}

/**
 * Parse a single skill directory. Each skill has:
 *   - SKILL.md: YAML frontmatter + full description (overview, activation, topic list)
 *   - references/*.md (optional): reference docs, some stubs, some rich content
 *
 * @param skillDir - Absolute path to the skill directory (e.g. .../skills/drupal-contrib-mgmt)
 * @param skillSlug - Slug name from the directory name (e.g. "drupal-contrib-mgmt")
 * @param sourcesDir - ETL sources root (used for relative file paths in metadata)
 */
async function parseSkillDirectory(
  skillDir: string,
  skillSlug: string,
  sourcesDir: string,
): Promise<ParsedPage[]> {
  const pages: ParsedPage[] = [];

  // ── SKILL.md ─────────────────────────────────────────────────────────────────
  const skillMdPath = path.join(skillDir, 'SKILL.md');
  try {
    const rawContent = (await readFile(skillMdPath, 'utf8')).trim();
    if (rawContent && rawContent.length > 0) {
      const { frontmatter, body } = stripFrontmatter(rawContent);
      const skillName = frontmatter['name'] ?? skillSlug;
      const description = frontmatter['description'] ?? '';
      const relPath = path.relative(sourcesDir, skillMdPath);

      // Prepend description as a preamble if not already in body
      const fullBody = description && !body.includes(description)
        ? `${description}\n\n${body}`
        : body;

      const sections = splitByHeadings(fullBody);

      for (const section of sections) {
        if (section.text.length < 50) continue;

        pages.push({
          text: section.text,
          metadata: {
            source: SOURCE_NAME,
            symbol_name: skillName,
            fqcn: null,
            file_path: relPath,
            drupal_version: 'general',
            section: `${skillSlug}: ${section.title}`,
            ingested_at: new Date().toISOString(),
          } as SourceMetadata,
        });
      }

      console.error(`  [drupal-skills] ${relPath} → ${sections.length} section(s)`);
    }
  } catch {
    // SKILL.md missing — skip silently
  }

  // ── references/*.md ──────────────────────────────────────────────────────────
  const referencesDir = path.join(skillDir, 'references');
  const refFiles = await collectMarkdownFiles(referencesDir);

  for (const filePath of refFiles) {
    const rawContent = (await readFile(filePath, 'utf8')).trim();
    if (!rawContent || rawContent.length === 0) continue;

    const { body } = stripFrontmatter(rawContent);
    if (!body || body.length < 50) continue;

    const topicSlug = path.basename(filePath, path.extname(filePath));
    const relPath = path.relative(sourcesDir, filePath);

    const sections = splitByHeadings(body);

    for (const section of sections) {
      if (section.text.length < 50) continue;

      pages.push({
        text: section.text,
        metadata: {
          source: SOURCE_NAME,
          symbol_name: `${skillSlug}/${topicSlug}`,
          fqcn: null,
          file_path: relPath,
          drupal_version: 'general',
          section: `${skillSlug}/${topicSlug}: ${section.title}`,
          ingested_at: new Date().toISOString(),
        } as SourceMetadata,
      });
    }

    console.error(`  [drupal-skills] ${relPath} → ${sections.length} section(s)`);
  }

  return pages;
}

/**
 * Parse the grasmash/drupal-claude-skills repository content
 * into an array of ParsedPage objects suitable for chunking and embedding.
 *
 * Scans all skill directories under `data/sources/drupal-skills/skills/`,
 * ingesting each SKILL.md and any `references/*.md` files.
 * Files that are pure stubs (< 50 chars after frontmatter stripping) are skipped.
 *
 * @param sourcesDir - Path to the ETL sources directory (e.g. data/sources)
 */
export async function parseDrupalSkills(sourcesDir: string): Promise<ParsedPage[]> {
  const skillsDir = path.join(sourcesDir, 'drupal-skills', 'skills');

  try {
    await access(skillsDir);
  } catch {
    console.error(`⚠ Drupal skills directory not found at ${skillsDir} — skipping`);
    return [];
  }

  const pages: ParsedPage[] = [];
  let skillCount = 0;

  // Each immediate subdirectory of skills/ is a skill
  let entries;
  try {
    entries = await readdir(skillsDir, { withFileTypes: true });
  } catch (err) {
    console.error(`⚠ Could not read skills directory: ${err}`);
    return [];
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('.')) continue;

    const skillDir = path.join(skillsDir, entry.name);
    const skillSlug = entry.name;

    const skillPages = await parseSkillDirectory(skillDir, skillSlug, sourcesDir);
    pages.push(...skillPages);
    skillCount += 1;
  }

  // ── Cross-document deduplication ─────────────────────────────────────────────
  const dedupedPages = deduplicateByFingerprint(pages);
  const dropped = pages.length - dedupedPages.length;
  if (dropped > 0) {
    console.error(`  Deduplication removed ${dropped} duplicate chunk(s).`);
  }

  console.error(
    `Drupal skills parse complete: skills=${skillCount}, pages=${dedupedPages.length}`,
  );

  return dedupedPages;
}
