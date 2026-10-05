#!/usr/bin/env tsx
/**
 * Audit the indexed skill corpus (source_type = 'skill', the drupal-skills
 * family) against skill-authoring best practices
 * (platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices).
 *
 * The corpus is search-served evidence: a bloated, vague, or time-stale skill
 * document pollutes retrieval the same way a junk page does. Checks:
 *
 *   frontmatter-description  SKILL.md files should carry a specific
 *                            `description:` (what + when), <= 1024 chars.
 *   body-length              Body > 500 lines: consider progressive
 *                            disclosure (references split out).
 *   vague-naming             Titles containing helper/utils/tools/documents/
 *                            data/files are hard to route on.
 *   time-sensitive           "before/after <year>" patterns rot; flag for
 *                            review (informational — history sections are
 *                            legitimate).
 *
 * Output: data/cache/skill-audit/report.json (untracked) + console summary.
 *
 * Usage: npm run index:audit-skills
 */

import fs from 'node:fs';
import path from 'node:path';


// Only flags titles whose *distinguishing* content is a generic word. Compound
// terms like "Data Integrity Failures Standards" (OWASP A08's actual name) are
// legitimate titles, so the match must not be a word inside a multi-word term.
const VAGUE = /^(?:the\s+)?(?:helper|utils|tools|documents|data|files)(?:\s+(?:and|or|of|for|the)\s+\w+)*$/i;
const TIME_SENSITIVE = /\b(?:before|after|until|since)\s+(?:January|February|March|April|May|June|July|August|September|October|November|December\s+)?20\d{2}\b/i;

interface SkillFinding {
  id: string;
  title: string;
  project: string;
  repositoryPath: string;
  lines: number;
  findings: string[];
}

function auditDocument(id: string, title: string, project: string, repositoryPath: string, content: string): SkillFinding {
  const lines = content.split('\n').length;
  const findings: string[] = [];

  const fm = content.match(/^---\n([\s\S]*?)\n---/);
  if (repositoryPath.endsWith('SKILL.md')) {
    const description = fm?.[1].match(/^description:\s*(.+)$/m)?.[1];
    if (!description) findings.push('frontmatter-description: missing (SKILL.md without a description is hard to route on)');
    else if (description.length > 1024) findings.push(`frontmatter-description: ${description.length} chars exceeds the 1024 limit`);
    else if (/\b(helps with|processes data|does stuff|works with documents)\b/i.test(description)) findings.push('frontmatter-description: vague — describe what it does and when to use it');
  } else if (!fm && lines > 100) {
    findings.push('reference-toc: reference file >100 lines without a summary/TOC line — add a contents header');
  }

  if (lines > 500) findings.push(`body-length: ${lines} lines exceeds the 500-line guidance — consider splitting reference files`);

  if (VAGUE.test(title.trim())) findings.push(`vague-naming: title "${title}" routes poorly — name the specific capability`);

  if (TIME_SENSITIVE.test(content)) {
    findings.push('time-sensitive: contains "before/after <year>" phrasing — check for rot');
  }

  return { id, title: title.slice(0, 90), project, repositoryPath, lines, findings };
}

async function main(): Promise<void> {
  // Read skill documents straight from the active build.
  const manifest = JSON.parse(fs.readFileSync('data/index/active.json', 'utf8')) as { buildPath: string };
  const Database = (await import('better-sqlite3')).default;
  const db = new Database(path.join(manifest.buildPath, 'knowledge.sqlite'), { readonly: true });
  const docs = db.prepare("SELECT id, title, project, repository_path, content FROM documents WHERE source_type = 'skill'").all() as Array<{ id: string; title: string; project: string | null; repository_path: string | null; content: string }>;
  db.close();

  const audited = docs.map(d => auditDocument(d.id, d.title, d.project ?? 'unknown', d.repository_path ?? '', d.content));
  const flagged = audited.filter(a => a.findings.length > 0);

  const byKind = new Map<string, number>();
  for (const a of flagged) for (const f of a.findings) {
    const kind = f.split(':')[0];
    byKind.set(kind, (byKind.get(kind) ?? 0) + 1);
  }

  const outDir = 'data/cache/skill-audit';
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify({
    generatedAt: new Date().toISOString(),
    audited: audited.length,
    flagged: flagged.length,
    byKind: Object.fromEntries(byKind),
    findings: flagged,
  }, null, 2));

  console.log(`Audited ${audited.length} indexed skill documents → ${outDir}/report.json`);
  console.log(`Flagged: ${flagged.length}/${audited.length} (${Math.round(flagged.length / audited.length * 100)}%)`);
  console.log('By kind:', [...byKind.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}=${n}`).join(', '));
  console.log('\nWorst 15 (most findings, largest first):');
  for (const a of [...flagged].sort((x, y) => y.findings.length - x.findings.length || y.lines - x.lines).slice(0, 15)) {
    console.log(`  ${a.lines.toString().padStart(5)}L  ${a.title.slice(0, 55)}  [${a.findings.map(f => f.split(':')[0]).join(', ')}]`);
  }
}

main().catch(error => {
  console.error('Fatal:', error);
  process.exit(1);
});