import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeGroundingStats, stripBibliography } from '../src/grounding.js';

const DOC = 'drupal://document/doc_ABC123';

test('fully cited prose measures density 1', () => {
  const answer = `The messenger service shows messages (${DOC}). A second sentence cites again (${DOC}).\n\n## Evidence\n- thing: ${DOC}`;
  const stats = computeGroundingStats(answer);
  assert.equal(stats.citations, 1); // unique-citation count (same URI twice)
  assert.equal(stats.sentences, 2);
  assert.equal(stats.citedSentences, 2);
  assert.equal(stats.groundingDensity, 1);
});

test('framing sentences count as uncited — that is the point of the metric', () => {
  const answer = `Objective: answer the question. The messenger service shows messages (${DOC}). A second sentence cites again (${DOC}).`;
  const stats = computeGroundingStats(answer);
  assert.equal(stats.sentences, 3);
  assert.equal(stats.citedSentences, 2);
  assert.equal(stats.groundingDensity, 0.67);
});

test('bibliography is excluded from the denominator', () => {
  const answer = `One grounded claim (${DOC}). One uncited claim without proof.\n\n## Evidence\n- a: ${DOC}\n- b: drupal://document/doc_DEF456\n- c: drupal://document/doc_GHI789`;
  const stats = computeGroundingStats(answer);
  assert.equal(stats.sentences, 2); // bibliography lines are not sentences
  assert.equal(stats.citations, 3); // but they do count as citations
  assert.equal(stats.citedSentences, 1);
  assert.equal(stats.groundingDensity, 0.5);
});

test('code blocks are not counted as claims', () => {
  const answer = 'The messenger service is right for this (' + DOC + ').\n```php\ndrupal_set_message("x");\n```\nAnother cited statement (' + DOC + ').';
  const stats = computeGroundingStats(answer);
  assert.equal(stats.sentences, 2);
  assert.equal(stats.citedSentences, 2);
  assert.equal(stats.citations, 1);
});

test('empty answer yields null density, not a fake 1', () => {
  const stats = computeGroundingStats('');
  assert.equal(stats.sentences, 0);
  assert.equal(stats.citedSentences, 0);
  assert.equal(stats.citations, 0);
  assert.equal(stats.groundingDensity, null);
});

test('uncited prose measures density 0', () => {
  const stats = computeGroundingStats('A confident statement with no citation at all. Another ungrounded sentence here.');
  assert.equal(stats.groundingDensity, 0);
});

test('stripBibliography removes Sources sections too', () => {
  const text = 'Claim one. Claim two.\n\n## Sources\n- a: ' + DOC;
  assert.ok(!stripBibliography(text).includes('## Sources'));
  assert.ok(stripBibliography(text).includes('Claim two.'));
});