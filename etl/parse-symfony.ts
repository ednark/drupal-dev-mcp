import { access, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { ParsedPage, SourceMetadata } from './parser.js';

const SOURCE_NAME = 'symfony_docs';
const SKIP_DIRS = new Set(['.git', 'node_modules', 'vendor']);

function stripRstToPlainText(content: string): string {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let inDirectiveBlock = false;

  for (const line of lines) {
    if (/^\s*\.\.\s+_[^:]+:\s*$/.test(line)) {
      inDirectiveBlock = false;
      continue;
    }

    if (/^\s*\.\.\s+[a-zA-Z][\w-]*::/.test(line)) {
      inDirectiveBlock = true;
      continue;
    }

    if (inDirectiveBlock && /^\s+/.test(line)) {
      const cleaned = line.trimStart();
      if (cleaned.length > 0) {
        out.push(cleaned);
      }
      continue;
    }

    if (inDirectiveBlock && !/^\s+/.test(line)) {
      inDirectiveBlock = false;
    }

    out.push(line);
  }

  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function splitByHeadings(text: string): Array<{ title: string; text: string }> {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const markers: Array<{ line: number; title: string }> = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    const md = line.match(/^##+\s+(.+)$/);
    if (md) {
      markers.push({ line: i, title: md[1].trim() || 'Section' });
      continue;
    }

    const next = lines[i + 1] ?? '';
    if (line.trim().length > 0 && /^(?:={3,}|-{3,}|~{3,})\s*$/.test(next.trim())) {
      markers.push({ line: i, title: line.trim() });
      i += 1;
    }
  }

  if (markers.length === 0) {
    const normalized = text.trim();
    return normalized ? [{ title: 'Overview', text: normalized }] : [];
  }

  const sections: Array<{ title: string; text: string }> = [];
  for (let i = 0; i < markers.length; i += 1) {
    const current = markers[i];
    const next = markers[i + 1];
    const start = current.line;
    const end = next ? next.line : lines.length;
    const chunk = lines.slice(start, end).join('\n').trim();
    if (chunk.length > 0) {
      sections.push({ title: current.title, text: chunk });
    }
  }

  return sections;
}

function detectSymfonyVersion(relativePath: string): string {
  const parts = relativePath.split(path.sep);
  const version = parts.find((part) => /^\d+\.\d+$/.test(part));
  return version ?? 'current';
}

function detectComponent(relativePath: string): string | null {
  const parts = relativePath.split(path.sep).filter(Boolean);
  const filtered = parts.filter((part) => !/^\d+\.\d+$/.test(part));
  if (filtered.length === 0) {
    return null;
  }
  return filtered[0] ?? null;
}

async function collectSymfonyFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) {
        continue;
      }
      files.push(...await collectSymfonyFiles(fullPath));
      continue;
    }

    if (entry.isFile() && (entry.name.endsWith('.rst') || entry.name.endsWith('.md'))) {
      files.push(fullPath);
    }
  }

  return files;
}

export async function parseSymfonyDocs(sourcesDir: string): Promise<ParsedPage[]> {
  const symfonyDir = path.join(sourcesDir, 'symfony-docs');

  try {
    await access(symfonyDir);
  }
  catch {
    console.warn(`⚠ Symfony docs directory not found at ${symfonyDir} — skipping`);
    return [];
  }

  const files = await collectSymfonyFiles(symfonyDir);
  const pages: ParsedPage[] = [];

  for (const filePath of files) {
    const raw = await readFile(filePath, 'utf8');
    const normalized = filePath.endsWith('.rst') ? stripRstToPlainText(raw) : raw;
    const sections = splitByHeadings(normalized);
    const relativeFilePath = path.relative(sourcesDir, filePath);
    const componentName = detectComponent(path.relative(symfonyDir, filePath));
    const symfonyVersion = detectSymfonyVersion(path.relative(symfonyDir, filePath));

    for (const section of sections) {
      if (section.text.trim().length < 20) {
        continue;
      }

      pages.push({
        text: section.text,
        metadata: {
          source: SOURCE_NAME,
          symbol_name: componentName,
          fqcn: null,
          file_path: relativeFilePath,
          drupal_version: symfonyVersion,
          section: section.title,
          ingested_at: new Date().toISOString(),
        } as SourceMetadata,
      });
    }
  }

  console.error(`Symfony docs parse complete: files=${files.length}, pages=${pages.length}`);
  return pages;
}
