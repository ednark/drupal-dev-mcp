import path from 'path';
import fs from 'fs';

// ── Valid skill IDs (map 1-to-1 with folder names) ────────────
const VALID_SKILL_IDS = [
  'nodes',
  'blocks',
  'taxonomy',
  'fields',
  'views',
  'forms',
  'text-formats-editors',
  'theming',
  'config-parser',
  'other-content-entities',
] as const;

type SkillId = typeof VALID_SKILL_IDS[number];
type Format = 'raw' | 'trimmed' | 'json';

// ── Paths ─────────────────────────────────────────────────────
const SKILLS_BASE = path.join(
  process.cwd(),
  'data', 'sources', 'drupal-best-practices', 'ai', 'skills',
);

// ── Tool Definition ───────────────────────────────────────────
export const TOOL_DEFINITION = {
  name: 'drupal_skill_guide',
  description: `Returns Drupal best-practice skill rules for a specific domain. Use this to get authoritative naming conventions, guardrails, and configuration patterns. Pair with ask_drupal_expert for searched documentation.`,
  inputSchema: {
    type: 'object' as const,
    properties: {
      skill_id: {
        type: 'string',
        description: 'The Drupal skill domain to retrieve. Valid values: nodes, blocks, taxonomy, fields, views, forms, text-formats-editors, theming, config-parser, other-content-entities.',
        enum: [...VALID_SKILL_IDS],
      },
      format: {
        type: 'string',
        description: 'Output format. "raw" returns the complete SKILL.md content. "trimmed" strips frontmatter and References (default). "json" returns a structured JSON object.',
        enum: ['raw', 'trimmed', 'json'],
        default: 'trimmed',
      },
    },
    required: ['skill_id'] as string[],
  },
};

// ── Helpers ───────────────────────────────────────────────────
function readFileSafe(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

/** Strip the YAML frontmatter block (--- ... ---) from the top of a string. */
function stripFrontmatter(content: string): string {
  return content.replace(/^---[\s\S]*?---\s*\n/, '');
}

/** Return the text content of a named ## Heading section (up to the next ## heading). */
function extractSection(content: string, heading: string): string {
  const headingRe = new RegExp(`^## ${heading}\\s*$`, 'i');
  const lines = content.split('\n');
  let inSection = false;
  const sectionLines: string[] = [];

  for (const line of lines) {
    if (!inSection) {
      if (headingRe.test(line)) {
        inSection = true;
      }
      continue;
    }
    // Stop at the next ## heading
    if (/^## /.test(line)) break;
    sectionLines.push(line);
  }

  return sectionLines.join('\n').trim();
}

/** Parse bullet-list lines into an array, stripping the leading "- ". */
function parseBullets(text: string): string[] {
  return text
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.startsWith('- '))
    .map(l => l.slice(2).trim());
}

/** Parse lines into an array (non-empty lines only). */
function parseLines(text: string): string[] {
  return text.split('\n').map(l => l.trim()).filter(Boolean);
}

/** Extract a frontmatter field value by key. */
function frontmatterField(content: string, key: string): string {
  const match = content.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
  return match ? match[1].trim() : '';
}

// ── Format implementations ────────────────────────────────────

function formatRaw(content: string): string {
  return content;
}

function formatTrimmed(content: string): string {
  // Strip frontmatter
  let trimmed = stripFrontmatter(content);

  // Remove the ## References section and everything after it
  trimmed = trimmed.replace(/^## References[\s\S]*$/im, '').trimEnd();

  return trimmed;
}

interface SkillJson {
  id: string;
  title: string;
  description: string;
  usage: string[];
  guardrails: string[];
  validation_command: string | null;
  references: string[];
}

function formatJson(content: string, skillId: string): SkillJson {
  const id = frontmatterField(content, 'id') || skillId;
  const title = frontmatterField(content, 'title') || skillId;

  const body = stripFrontmatter(content);

  const description = extractSection(body, 'Description');
  const usageText = extractSection(body, 'Usage');
  const guardrailsText = extractSection(body, 'Guardrails');

  // Accept either "## Validation Command" or "## Validation"
  let validationText = extractSection(body, 'Validation Command');
  if (!validationText) {
    validationText = extractSection(body, 'Validation');
  }
  const validation_command = validationText || null;

  const referencesText = extractSection(body, 'References');
  const references = parseLines(referencesText);

  return {
    id,
    title,
    description,
    usage: parseBullets(usageText),
    guardrails: parseBullets(guardrailsText),
    validation_command,
    references,
  };
}

// ── Handler ───────────────────────────────────────────────────
export function handleDrupalSkillGuide(
  args: Record<string, unknown>,
): { content: Array<{ type: string; text: string }> } {

  const skillId = typeof args.skill_id === 'string' ? args.skill_id.trim() : '';
  const format: Format =
    args.format === 'raw' || args.format === 'trimmed' || args.format === 'json'
      ? (args.format as Format)
      : 'trimmed';

  console.error(`[drupal_skill_guide] skill_id="${skillId}" format="${format}"`);

  // ── skill_id validation ──────────────────────────────────────
  if (!VALID_SKILL_IDS.includes(skillId as SkillId)) {
    const errorPayload = { error: 'Invalid skill_id', valid_ids: [...VALID_SKILL_IDS] };
    return { content: [{ type: 'text', text: JSON.stringify(errorPayload, null, 2) }] };
  }

  // ── Read SKILL.md ────────────────────────────────────────────
  const skillPath = path.join(SKILLS_BASE, skillId, 'SKILL.md');
  const content = readFileSafe(skillPath);

  if (content === null) {
    const errorPayload = { error: 'Skill file not found', skill_id: skillId };
    return { content: [{ type: 'text', text: JSON.stringify(errorPayload, null, 2) }] };
  }

  // ── Apply format ─────────────────────────────────────────────
  let text: string;
  if (format === 'raw') {
    text = formatRaw(content);
  } else if (format === 'json') {
    text = JSON.stringify(formatJson(content, skillId), null, 2);
  } else {
    text = formatTrimmed(content);
  }

  console.error(`[drupal_skill_guide] ✓ Returning "${format}" for "${skillId}"`);
  return { content: [{ type: 'text', text }] };
}
