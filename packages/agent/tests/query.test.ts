import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveQuery, keywordFallback } from '../src/query.js';
import type { LlmProvider } from '../src/types.js';

test('generateQuery output is used verbatim (sanitized)', async () => {
  const llm: LlmProvider = { async generate() { return ''; }, async generateQuery() { return 'messenger service addStatus status message'; } };
  const q = await deriveQuery('In Drupal 10, how do I show a status message?', llm);
  assert.equal(q, 'messenger service addStatus status message');
});

test('falls back to the raw question when the provider cannot derive', async () => {
  const llm: LlmProvider = { async generate() { return ''; } };
  const question = 'In Drupal 10, how do I show a status message?';
  assert.equal(await deriveQuery(question, llm), question);
});

test('falls back to the raw question when the LLM returns garbage', async () => {
  const llm: LlmProvider = { async generate() { return ''; }, async generateQuery() { return '' } };
  const question = 'What is the minimum PHP version Drupal 11 requires?';
  assert.equal(await deriveQuery(question, llm), question);
});

test('falls back to the raw question when derivation throws', async () => {
  const llm: LlmProvider = { async generate() { return ''; }, async generateQuery() { throw new Error('down'); } };
  const question = 'What is the minimum PHP version Drupal 11 requires?';
  assert.equal(await deriveQuery(question, llm), question);
});

test('multi-line or over-long derivations are rejected, not truncated guesses', async () => {
  const llm: LlmProvider = {
    async generate() { return ''; },
    async generateQuery() { return 'one two three four five six seven eight nine ten eleven twelve thirteen fourteen'; },
  };
  const question = 'How do I configure something?';
  assert.equal(await deriveQuery(question, llm), question);
});

test('keywordFallback strips question scaffolding', () => {
  const q = keywordFallback('In Drupal 10, how do I show a status message to the user? Show code.');
  assert.ok(!/\bhow\b/.test(q));
  assert.ok(q.includes('status'));
  assert.ok(q.includes('message'));
});