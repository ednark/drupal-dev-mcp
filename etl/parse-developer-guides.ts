import fs from 'fs';
import path from 'path';
import { parseMarkdownFile } from './parser.js';

/**
 * Parse the Drupal Developer Guides into structured JSON documents.
 * This script mirrors the structure of verify-userguide.ts and parser.ts.
 */

const SOURCE_DIR = path.resolve('data/sources/drupal-developer-guides');
const OUTPUT_FILE = path.resolve('data/parsed/developer-guides.json');

interface ParsedDoc {
  id: string;
  title: string;
  path: string;
  content: string;
}

const MIN_DOC_CHARS = 200;

function splitMarkdownIntoSections(markdown: string): string[] {
  const normalized = markdown.trim();
  if (!normalized) {
    return [];
  }

  const sections = normalized
    .split(/^(?=##\s|###\s)/m)
    .map((section) => section.trim())
    .filter((section) => section.length >= MIN_DOC_CHARS);

  if (sections.length > 0) {
    return sections;
  }

  return normalized.length >= MIN_DOC_CHARS ? [normalized] : [];
}

function collectMarkdownFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectMarkdownFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push(fullPath);
    }
  }
  return files;
}

export function parseDeveloperGuides(): ParsedDoc[] {
  if (!fs.existsSync(SOURCE_DIR)) {
    throw new Error(`Source directory not found: ${SOURCE_DIR}`);
  }

  const markdownFiles = collectMarkdownFiles(SOURCE_DIR);
  const parsedDocs: ParsedDoc[] = [];

  for (const file of markdownFiles) {
    const relPath = path.relative(SOURCE_DIR, file);
    const title = path.basename(file, '.md');
    const content = fs.readFileSync(file, 'utf-8');
    const parsed = parseMarkdownFile(content);
    const sections = splitMarkdownIntoSections(parsed.content || content);

    if (sections.length === 0) {
      continue;
    }

    sections.forEach((section, index) => {
      const sectionTitleLine = section.split('\n').find((line) => /^(##|###)\s+/.test(line));
      const sectionTitle = sectionTitleLine
        ? sectionTitleLine.replace(/^(##|###)\s+/, '').trim()
        : `${parsed.title || title} (section ${index + 1})`;

      parsedDocs.push({
        id: `${relPath.replace(/\//g, '_')}_${index + 1}`,
        title: sectionTitle,
        path: relPath,
        content: section,
      });
    });
  }

  return parsedDocs;
}

function main() {
  console.log('Parsing Drupal Developer Guides...');
  const docs = parseDeveloperGuides();
  fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(docs, null, 2));
  console.log(`Parsed ${docs.length} documents written to ${OUTPUT_FILE}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
