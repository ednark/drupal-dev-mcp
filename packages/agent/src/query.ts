/**
 * Query derivation for the expert's first evidence round.
 *
 * Measured motivation (expert-eval 2026-09-26): searching the corpus with the
 * raw natural-language question retrieves worse than a short technical keyword
 * query — the corpus guidance says "short keyword/identifier queries score
 * best", and the expert's ask mode previously ignored that. A one-call LLM
 * query rewrite bridges synonym gaps ("show a status message" → messenger);
 * a deterministic fallback keeps behavior identical when no LLM is available
 * (existing tests, degraded environments).
 */

const QUERY_SYSTEM =
  'You write search queries for a Drupal documentation index. Output ONE line: ' +
  '3-6 technical keywords, no question words, no punctuation. ' +
  'Include the API or system name if inferable.';

export { QUERY_SYSTEM };

/** Cap derived queries so a chatty model cannot bloat the evidence round. */
const MAX_QUERY_WORDS = 12;

/** Deterministic, model-free extraction used when LLM derivation is unavailable. */
export function keywordFallback(question: string): string {
  const stop = new Set(
    ('in how do i a an the to of for with against from can could should would is are was were ' +
      'does did show code please use using used need wants way name named it its that this ' +
      'and or as by on at be been what which where when custom module version').split(' '),
  );
  const words = question
    .replace(/[?.!,]/g, ' ')
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length > 1 && !stop.has(w.toLowerCase()));
  return [...new Set(words)].slice(0, MAX_QUERY_WORDS).join(' ');
}

function sanitize(raw: string): string {
  const line = raw.split('\n').map((l) => l.trim()).find((l) => l.length > 0) ?? '';
  const cleaned = line.replace(/^["'`*-\s]+|["'`*-\s]+$/g, '');
  if (!cleaned || /[?]/.test(cleaned) || cleaned.split(/\s+/).length > MAX_QUERY_WORDS) return '';
  return cleaned;
}

export interface QueryDeriver {
  /**
   * Returns a search query for the question. Implementations may call an LLM;
   * callers treat an empty result as "no derivation available" and fall back
   * to the raw question.
   */
  generateQuery?(question: string): Promise<string>;
}

/**
 * Derive the search query for a question. Uses the LLM when the provider
 * implements generateQuery; falls back to the raw question when derivation is
 * unavailable or unusable (never worse than the previous behavior).
 */
export async function deriveQuery(
  question: string,
  llm: QueryDeriver,
): Promise<string> {
  if (!llm.generateQuery) return question;
  try {
    const derived = sanitize(await llm.generateQuery(question));
    return derived || question;
  } catch {
    return question;
  }
}