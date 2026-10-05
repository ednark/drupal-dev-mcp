#!/usr/bin/env tsx
/**
 * Curate the community-questions harvest into the committed evaluation set:
 *
 *   docs/eval/human-questions.json — machine-readable, consumed by
 *                                    scripts/audit-community-questions.ts
 *   docs/eval/human-questions.md   — human-readable mirror of the same set
 *
 * Selection: top-voted DSE classics (timeless phrasing), recent answered DSE
 * questions (current-version phrasing), SO-PHP problem types, and course /
 * certification-outline scenario prompts from the GitHub lane. Questions only
 * — community answers stay in the untracked raw harvest and are used solely
 * as evaluation ground truth.
 *
 * Usage: npx tsx scripts/curate-community-questions.ts
 */

import fs from 'node:fs';
import path from 'node:path';

const RAW_DIR = 'data/sources/community-questions/raw';
const OUT_JSON = 'docs/eval/human-questions.json';
const OUT_MD = 'docs/eval/human-questions.md';

interface SeQuestion {
  question_id: number;
  title: string;
  link: string;
  tags: string[];
  score: number;
  is_answered: boolean;
  creation_date: number;
}

interface CuratedQuestion {
  id: string;
  lane: 'dse_classic' | 'dse_modern' | 'php_general' | 'course_scenario' | 'reddit';
  era: 'classic' | 'modern';
  phase: string;
  question: string;
  sourceUrl: string;
  communityScore: number;
  hasAcceptedAnswer: boolean;
}

const PHASE_RULES: Array<[string, RegExp]> = [
  ['theming', /twig|theme|template|css|javascript|js\b|library|front.?end|render|block/i],
  ['forms', /\bform|webform|validat|submit/i],
  ['caching-perf', /cach|performance|speed|slow/i],
  ['migrate-upgrade', /migrat|upgrade|update site|import.*content/i],
  ['config-deploy', /config|deploy|environment|composer|settings|install/i],
  ['module-code', /hook|entity|plugin|service|controller|route|field|node api|custom module|api\b|drush|database|query|session|cron|queue|batch/i],
  ['site-building', /view|taxonomy|user|permission|role|menu|content type|url alias|path|search|multilingual|translation/i],
];

function phaseFor(text: string): string {
  for (const [phase, rule] of PHASE_RULES) if (rule.test(text)) return phase;
  return 'general';
}

function decodeEntities(text: string): string {
  return text
    .replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#xA0;|&nbsp;/g, ' ');
}

function take(questions: SeQuestion[], count: number, opts: { sortBy?: 'score' | 'none' } = {}): SeQuestion[] {
  const list = [...questions];
  if (opts.sortBy === 'score') list.sort((a, b) => b.score - a.score);
  return list.slice(0, count);
}

function toCurated(list: SeQuestion[], lane: CuratedQuestion['lane'], idPrefix: string): CuratedQuestion[] {
  return list.map((q, index) => {
    const question = decodeEntities(q.title);
    const era: CuratedQuestion['era'] = q.creation_date >= 1672531200 ? 'modern' : 'classic'; // 2023-01-01
    return {
      id: `${idPrefix}-${String(index + 1).padStart(3, '0')}`,
      lane,
      era,
      phase: phaseFor(`${question} ${q.tags.join(' ')}`),
      question,
      sourceUrl: q.link,
      communityScore: q.score,
      hasAcceptedAnswer: Boolean(q.is_answered && q.answer_count > 0),
    };
  });
}

/** Extract scenario prompts from course/curriculum READMEs (objectives, lessons, exercises). */
function coursePrompts(): CuratedQuestion[] {
  const raw = JSON.parse(fs.readFileSync(path.join(RAW_DIR, 'course-scenarios.json'), 'utf8')) as {
    scenarios: Array<{ repo: string; url: string; stars: number; readme: string }>;
  };
  const prompts: CuratedQuestion[] = [];
  for (const scenario of raw.scenarios) {
    const lines = scenario.readme.split('\n')
      .map(line => line.replace(/^[\s\-*#\d.>|]+/, '').trim())
      .filter(line => line.length >= 40 && line.length <= 140
        && !/^http|©|license|table of contents|passed|certification\.acquia\.com|\[.*\]\(.*\)/i.test(line)
        && /(how|what|when|use|build|create|configure|manage|install|develop|theme|migrate|deploy|understand|explain|overview|chapter|lesson|objective|domain|topic)/i.test(line))
      .slice(0, 6);
    for (const line of lines) {
      prompts.push({
        id: `course-${String(prompts.length + 1).padStart(3, '0')}`,
        lane: 'course_scenario',
        era: 'modern',
        phase: phaseFor(line),
        question: line,
        sourceUrl: scenario.url,
        communityScore: scenario.stars,
        hasAcceptedAnswer: false,
      });
    }
  }
  return prompts;
}

/** r/drupal posts harvested via the logged-in browser (old.reddit HTML listings). */
function redditPosts(): CuratedQuestion[] {
  const raw = JSON.parse(fs.readFileSync(path.join(RAW_DIR, 'reddit-harvest.json'), 'utf8')) as {
    posts: Array<{ title: string; url: string; selftext: string; score: string }>;
  };
  const qlike = raw.posts
    .filter(p => /\?|how (do|can)|what (is|are)|why (is|do|does)|best way|recommend/i.test(p.title))
    .slice(0, 10);
  return qlike.map((p, index) => ({
    id: `reddit-${String(index + 1).padStart(3, '0')}`,
    lane: 'reddit' as const,
    era: 'modern' as const,
    phase: phaseFor(p.title),
    question: p.title,
    sourceUrl: p.url,
    communityScore: Number(p.score) || 0,
    hasAcceptedAnswer: false,
  }));
}

async function main(): Promise<void> {
  const load = (name: string) => JSON.parse(fs.readFileSync(path.join(RAW_DIR, `${name}.json`), 'utf8')) as { questions: SeQuestion[] };
  const dseClassic = load('dse-classics');
  const dseModern = load('dse-modern');
  const phpClassic = load('so-php-classics');

  const curated: CuratedQuestion[] = [
    ...toCurated(take(dseClassic.questions, 30, { sortBy: 'score' }), 'dse_classic', 'dse-c'),
    ...toCurated(take(dseModern.questions.filter(q => q.is_answered), 25), 'dse_modern', 'dse-m'),
    // PHP-general lane: timeless problem types, not Drupal specifics.
    ...toCurated(take(phpClassic.questions.filter(q => q.tags.includes('php')), 12, { sortBy: 'score' }), 'php_general', 'php-c'),
    ...coursePrompts().slice(0, 8),
    ...redditPosts(),
  ];

  fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
  fs.writeFileSync(OUT_JSON, JSON.stringify({ generatedAt: new Date().toISOString(), count: curated.length, questions: curated }, null, 2));

  const byLane = new Map<string, number>();
  const byPhase = new Map<string, number>();
  for (const q of curated) {
    byLane.set(q.lane, (byLane.get(q.lane) ?? 0) + 1);
    byPhase.set(q.phase, (byPhase.get(q.phase) ?? 0) + 1);
  }
  const md = [
    '# Human-phrased Drupal evaluation questions',
    '',
    `Curated from real community sources on ${new Date().toISOString().slice(0, 10)}. ${curated.length} questions.`,
    'This file mirrors [`human-questions.json`](human-questions.json), which `npm run index:audit-questions` consumes.',
    'Questions are evaluation data only (short titles + links; community answers stay in the untracked raw harvest).',
    '',
    '| Lane | Count | Origin |',
    '|---|---|---|',
    `| dse_classic | ${byLane.get('dse_classic') ?? 0} | Drupal Stack Exchange top-voted all-time (timeless beginner phrasing) |`,
    `| dse_modern | ${byLane.get('dse_modern') ?? 0} | Drupal Stack Exchange most recent answered questions (current-version phrasing) |`,
    `| php_general | ${byLane.get('php_general') ?? 0} | Stack Overflow PHP all-time top (problem types, successor to the phpbuilder.net-era forums) |`,
    `| course_scenario | ${byLane.get('course_scenario') ?? 0} | Course/curriculum objectives (GitHub: Acquia study guide, training repos) |`,
    `| reddit | ${byLane.get('reddit') ?? 0} | r/drupal question-like posts (harvested via the logged-in browser; old.reddit listings) |`,
    '',
    '| Phase | Count |',
    '|---|---|',
    ...[...byPhase.entries()].sort((a, b) => b[1] - a[1]).map(([phase, count]) => `| ${phase} | ${count} |`),
    '',
    '## Questions',
    '',
    '| ID | Phase | Question | Source |',
    '|---|---|---|---|',
    ...curated.map(q => `| ${q.id} | ${q.phase} | ${q.question.replace(/\|/g, '\\|').slice(0, 120)} | [link](${q.sourceUrl}) |`),
    '',
  ].join('\n');
  fs.writeFileSync(OUT_MD, md);

  console.log(`✓ ${curated.length} questions curated → ${OUT_JSON} + ${OUT_MD}`);
  console.log('  lanes:', [...byLane.entries()].map(([k, v]) => `${k}=${v}`).join(', '));
  console.log('  phases:', [...byPhase.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(', '));
}

main().catch(error => {
  console.error('Fatal:', error);
  process.exit(1);
});