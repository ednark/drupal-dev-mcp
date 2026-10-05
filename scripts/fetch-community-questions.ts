#!/usr/bin/env tsx
/**
 * Fetch real community questions for the human-questions evaluation set.
 *
 * Lanes:
 *   A  Drupal Stack Exchange — top-voted all-time ("classic") + most recent
 *      ("modern"), two cohorts tagged separately.
 *   B  Stack Overflow PHP tag — problem types people actually hit in PHP
 *      (successor to the phpbuilder.net-era forums), classic + recent.
 *   D  Course/tutorial scenarios — GitHub repo search for Drupal course
 *      assignment / curriculum repos; READMEs provide the exercise prompts.
 *
 * Raw JSON lands in data/sources/community-questions/raw/ (untracked scratch,
 * like every other fetched corpus). Curation to docs/eval/ is a separate step.
 *
 * Reddit (lane C) is harvested separately via the logged-in browser — the
 * JSON API is blocked from this network.
 *
 * Usage:
 *   npm run index:fetch-questions
 */

import fs from 'node:fs';
import path from 'node:path';

const RAW_DIR = 'data/sources/community-questions/raw';

interface SeQuestion {
  question_id: number;
  title: string;
  link: string;
  tags: string[];
  score: number;
  view_count: number;
  answer_count: number;
  is_answered: boolean;
  accepted_answer_id?: number;
  creation_date: number;
}

interface SeAnswer {
  answer_id: number;
  question_id: number;
  score: number;
  is_accepted: boolean;
  body_markdown?: string;
  body?: string;
}

async function seFetch<T>(apiPath: string): Promise<T> {
  const response = await fetch(`https://api.stackexchange.com/2.3/${apiPath}`);
  if (!response.ok) throw new Error(`SE API ${response.status} on ${apiPath}`);
  const data = (await response.json()) as { items?: T[]; quota_max?: number; quota_remaining?: number; error?: { message: string } };
  if (data.error) throw new Error(`SE API error: ${data.error.message}`);
  if (typeof data.quota_remaining === 'number' && data.quota_remaining < 20) {
    console.warn(`  ⚠ SE quota running low: ${data.quota_remaining}/${data.quota_max}`);
  }
  await new Promise(resolve => setTimeout(resolve, 400));
  return (data.items ?? []) as T;
}

/** Accepted-answer bodies for a set of questions (the "how did the community respond" side). */
async function fetchAcceptedAnswers(site: string, questions: SeQuestion[]): Promise<SeAnswer[]> {
  const withAccepted = questions.filter(q => q.accepted_answer_id);
  const answers: SeAnswer[] = [];
  for (let i = 0; i < withAccepted.length; i += 90) {
    const ids = withAccepted.slice(i, i + 90).map(q => q.accepted_answer_id).join(';');
    const batch = await seFetch<SeAnswer>(`answers/${ids}?site=${site}&filter=withbody&sort=creation&order=desc`);
    answers.push(...batch);
  }
  return answers;
}

async function laneDrupalStackExchange(): Promise<void> {
  console.log('→ Lane A: Drupal Stack Exchange');
  // Classic: all-time top-voted (spans eras; reflects how beginners phrase
  // timeless questions — hooks concepts, permissions, drush basics).
  const classics = await seFetch<SeQuestion>('questions?site=drupal&sort=votes&order=desc&pagesize=100');
  // Modern: the most recent questions (2026), answered ones only — real
  // current-version phrasing, community-validated.
  const modernRaw = [
    ...await seFetch<SeQuestion>('search/advanced?site=drupal&sort=creation&order=desc&pagesize=100&page=1'),
    ...await seFetch<SeQuestion>('search/advanced?site=drupal&sort=creation&order=desc&pagesize=100&page=2'),
  ];
  const modern = modernRaw.filter(q => q.is_answered && q.answer_count > 0).slice(0, 100);
  const classicAnswers = await fetchAcceptedAnswers('drupal', classics);
  const modernAnswers = await fetchAcceptedAnswers('drupal', modern);
  fs.writeFileSync(path.join(RAW_DIR, 'dse-classics.json'), JSON.stringify({ fetchedAt: new Date().toISOString(), questions: classics, acceptedAnswers: classicAnswers }, null, 1));
  fs.writeFileSync(path.join(RAW_DIR, 'dse-modern.json'), JSON.stringify({ fetchedAt: new Date().toISOString(), questions: modern, acceptedAnswers: modernAnswers }, null, 1));
  console.log(`  ✓ classics: ${classics.length} questions, ${classicAnswers.length} accepted answers`);
  console.log(`  ✓ modern: ${modern.length} answered questions, ${modernAnswers.length} accepted answers`);
}

async function lanePhpProblems(): Promise<void> {
  console.log('→ Lane B: Stack Overflow PHP (problem types)');
  const classics = await seFetch<SeQuestion>('questions?site=stackoverflow&tagged=php&sort=votes&order=desc&pagesize=100');
  const recent = (await seFetch<SeQuestion>('search/advanced?site=stackoverflow&tagged=php&sort=creation&order=desc&pagesize=50&page=1'))
    .filter(q => q.is_answered && q.answer_count > 0).slice(0, 50);
  const classicAnswers = await fetchAcceptedAnswers('stackoverflow', classics);
  fs.writeFileSync(path.join(RAW_DIR, 'so-php-classics.json'), JSON.stringify({ fetchedAt: new Date().toISOString(), questions: classics, acceptedAnswers: classicAnswers }, null, 1));
  fs.writeFileSync(path.join(RAW_DIR, 'so-php-recent.json'), JSON.stringify({ fetchedAt: new Date().toISOString(), questions: recent }, null, 1));
  console.log(`  ✓ php classics: ${classics.length} questions, ${classicAnswers.length} accepted answers`);
  console.log(`  ✓ php recent: ${recent.length} answered questions`);
}

interface GhRepo {
  full_name: string;
  html_url: string;
  stargazers_count: number;
  description: string | null;
}

async function laneCourseScenarios(): Promise<void> {
  console.log('→ Lane D: course/tutorial scenarios (GitHub)');
  const queries = [
    'drupal training course',
    'drupal module development tutorial',
    'drupal certification study guide',
    'drupal learning path',
  ];
  const repos = new Map<string, GhRepo>();
  for (const q of queries) {
    try {
      const response = await fetch(`https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=10`, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'drupal-dev-mcp-research' },
      });
      if (!response.ok) { console.warn(`  ⚠ GitHub ${response.status} on "${q}"`); continue; }
      const data = (await response.json()) as { items?: GhRepo[] };
      // Spam filter: repo name or description must mention drupal.
      for (const repo of data.items ?? []) {
        const haystack = `${repo.full_name} ${repo.description ?? ''}`.toLowerCase();
        if (haystack.includes('drupal')) repos.set(repo.full_name, repo);
      }
      await new Promise(resolve => setTimeout(resolve, 2500)); // unauthed search: 10 req/min
    } catch (error) {
      console.warn(`  ⚠ GitHub search failed on "${q}":`, error instanceof Error ? error.message : error);
    }
  }
  const picked = [...repos.values()].sort((a, b) => b.stargazers_count - a.stargazers_count).slice(0, 8);
  const scenarios: Array<{ repo: string; url: string; stars: number; description: string | null; readme: string }> = [];
  for (const repo of picked) {
    try {
      const response = await fetch(`https://raw.githubusercontent.com/${repo.full_name}/HEAD/README.md`, { headers: { 'User-Agent': 'drupal-dev-mcp-research' } });
      if (!response.ok) continue;
      const readme = await response.text();
      if (readme.length < 200) continue;
      scenarios.push({ repo: repo.full_name, url: repo.html_url, stars: repo.stargazers_count, description: repo.description, readme: readme.slice(0, 20_000) });
      console.log(`  ✓ ${repo.full_name} (${repo.stargazers_count}★)`);
      await new Promise(resolve => setTimeout(resolve, 600));
    } catch { /* skip */ }
  }
  fs.writeFileSync(path.join(RAW_DIR, 'course-scenarios.json'), JSON.stringify({ fetchedAt: new Date().toISOString(), scenarios }, null, 1));
  console.log(`  ✓ ${scenarios.length} course/curriculum READMEs captured`);
}

async function main(): Promise<void> {
  fs.mkdirSync(RAW_DIR, { recursive: true });
  await laneDrupalStackExchange();
  await lanePhpProblems();
  await laneCourseScenarios();
  console.log('\n════════════════════════════════');
  console.log('Done. Raw harvest in data/sources/community-questions/raw/');
}

main().catch(error => {
  console.error('Fatal:', error);
  process.exit(1);
});