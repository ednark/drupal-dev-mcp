#!/usr/bin/env tsx
/**
 * Audit the human-phrased question set against the live knowledge index.
 *
 * For every question in docs/eval/human-questions.json, runs the same
 * retrieval an MCP client would get (search_drupal hybrid mode, limit 5) and
 * classifies the result:
 *
 *   covered     top score >= 1.2        (strong evidence match)
 *   weak        0.8 <= top score < 1.2  (plausible, needs verification)
 *   likely-gap  0.5 <= top score < 0.8  (ambiguous material)
 *   gap         top score < 0.5         (nothing useful)
 *
 * Thresholds calibrated against the observed hybrid-score distribution
 * (canonical hits 0.9-2.6; noise 0.5-0.9; misses < 0.5) — heuristics only,
 * the full report is meant for manual review, not as an automated gate.
 *
 * Output: data/cache/question-audit/report.json (untracked) + console summary.
 *
 * Usage: npm run index:audit-questions
 */

import fs from 'node:fs';
import path from 'node:path';
import { SqliteKnowledgeProvider, getDefaultIndexRoot } from '../packages/knowledge/src/index.js';
import { readFileSync } from 'node:fs';

try {
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
} catch { /* .env optional */ }

interface CuratedQuestion {
  id: string;
  lane: string;
  era: string;
  phase: string;
  question: string;
  sourceUrl: string;
}

interface AuditEntry {
  id: string;
  lane: string;
  phase: string;
  question: string;
  topScore: number;
  classification: 'covered' | 'weak' | 'likely-gap' | 'gap';
  topHits: Array<{ score: number; sourceType: string; title: string }>;
}

function classify(topScore: number): AuditEntry['classification'] {
  if (topScore >= 1.2) return 'covered';
  if (topScore >= 0.8) return 'weak';
  if (topScore >= 0.5) return 'likely-gap';
  return 'gap';
}

async function main(): Promise<void> {
  const evalSet = JSON.parse(fs.readFileSync('docs/eval/human-questions.json', 'utf8')) as { questions: CuratedQuestion[] };
  const provider = await SqliteKnowledgeProvider.open(getDefaultIndexRoot());

  const entries: AuditEntry[] = [];
  for (const q of evalSet.questions) {
    const res = await provider.search({
      query: q.question, drupalVersion: '11.4', mode: 'hybrid', limit: 5, minScore: 0,
    } as never);
    const topScore = res.results[0]?.score ?? 0;
    entries.push({
      id: q.id,
      lane: q.lane,
      phase: q.phase,
      question: q.question,
      topScore,
      classification: classify(topScore),
      topHits: res.results.slice(0, 5).map(r => ({ score: r.score, sourceType: r.sourceType, title: r.title.slice(0, 70) })),
    });
  }
  provider.close();

  const outDir = 'data/cache/question-audit';
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify({ generatedAt: new Date().toISOString(), entries }, null, 2));

  // Aggregate
  const classOrder = ['covered', 'weak', 'likely-gap', 'gap'] as const;
  const byLane = new Map<string, Record<string, number>>();
  const byPhase = new Map<string, Record<string, number>>();
  for (const e of entries) {
    for (const [key, map] of [['lane', byLane], ['phase', byPhase]] as const) {
      const k = e[key];
      const bucket = map.get(k) ?? Object.fromEntries(classOrder.map(c => [c, 0]));
      bucket[e.classification] += 1;
      map.set(k, bucket);
    }
  }
  const pct = (bucket: Record<string, number>) => {
    const total = classOrder.reduce((sum, c) => sum + bucket[c], 0);
    const coveredish = bucket.covered + bucket.weak;
    return `${coveredish}/${total} (${Math.round(coveredish / total * 100)}%)`;
  };
  console.log(`Audited ${entries.length} questions → ${outDir}/report.json\n`);
  console.log('Per lane (covered+weak / total):');
  for (const [lane, bucket] of byLane) console.log(`  ${lane.padEnd(16)} ${pct(bucket)}  [${classOrder.map(c => `${c}:${bucket[c]}`).join(' ')}]`);
  console.log('\nPer phase:');
  for (const [phase, bucket] of [...byPhase.entries()].sort((a, b) => (b[1].covered + b[1].weak) - (a[1].covered + a[1].weak))) {
    console.log(`  ${phase.padEnd(16)} ${pct(bucket)}  [${classOrder.map(c => `${c}:${bucket[c]}`).join(' ')}]`);
  }
  console.log('\nWorst 10 (for manual side-by-side with community answers):');
  for (const e of [...entries].sort((a, b) => a.topScore - b.topScore).slice(0, 10)) {
    console.log(`  ${e.classification.padEnd(10)} ${e.topScore.toFixed(3)}  ${e.id}  ${e.question.slice(0, 70)}`);
  }
}

main().catch(error => {
  console.error('Fatal:', error);
  process.exit(1);
});