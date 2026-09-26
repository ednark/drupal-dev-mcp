import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ledger = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../data/corpus-issues.json', import.meta.url)), 'utf8'),
);

const STATUSES = new Set(['open', 'confirmed', 'fixed', 'mitigated-by-checker', 'wontfix']);

test('every corpus issue carries question, ground truth, observation, and remedy', () => {
  assert.ok(ledger.issues.length >= 1);
  for (const issue of ledger.issues) {
    assert.ok(issue.id, `missing id in ${JSON.stringify(issue).slice(0, 80)}`);
    assert.ok(issue.question, `${issue.id}: missing question`);
    assert.ok(issue.observed, `${issue.id}: missing observed behavior`);
    assert.ok(issue.remedy, `${issue.id}: missing remedy`);
    assert.ok(issue.firstObserved && /^\d{4}-\d{2}-\d{2}$/.test(issue.firstObserved), `${issue.id}: undated`);
    assert.ok(STATUSES.has(issue.status), `${issue.id}: unknown status ${issue.status}`);
  }
});

test('ground-truth claims cite an external source or named corpus evidence', () => {
  for (const issue of ledger.issues) {
    if (issue.status === 'open' || issue.status === 'confirmed') {
      const grounded =
        /https?:\/\//.test(issue.groundTruth ?? '') ||
        (/verified/i.test(issue.groundTruth ?? '') && (issue.groundTruth ?? '').includes('doc'));
      assert.ok(grounded, `${issue.id}: open/confirmed issues must cite a ground-truth URL or named corpus docs`);
    }
  }
});

test('ids are unique', () => {
  const ids = ledger.issues.map((i) => i.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('classification is one of the known kinds', () => {
  const kinds = new Set([
    'misleading-evidence-proximity',
    'concept-bridge gap',
    'agent-loop lesson',
    'data-error',
    'coverage-gap',
  ]);
  for (const issue of ledger.issues) {
    assert.ok(kinds.has(issue.classification), `${issue.id}: unknown classification ${issue.classification}`);
  }
});