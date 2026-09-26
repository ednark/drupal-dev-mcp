/**
 * Grounding-density statistics for expert answers.
 *
 * Measures how much of an answer's prose actually carries citations — the
 * mechanical counterpart to the claim-support check in the verification
 * layer. A low density means most of the answer is ungrounded prose; a high
 * density still does not guarantee support (see claim-support checking), but
 * a low density is always a warning.
 *
 * Deterministic. Code blocks are excluded (code is not a claim), and a
 * trailing bibliography section ("## Evidence" / "## Sources" /
 * "## References") is excluded from the denominator: every line of a
 * bibliography carries a URI trivially, without being a claim.
 */

export interface GroundingStats {
  /** Prose sentences counted (code blocks and bibliography excluded). */
  sentences: number;
  /** Sentences carrying at least one drupal:// citation. */
  citedSentences: number;
  /** Total drupal://document citations in the answer, including the bibliography. */
  citations: number;
  /** citedSentences / sentences; null when the answer has no prose sentences. */
  groundingDensity: number | null;
}

const CITATION_PATTERN = "drupal:\\/\\/document\\/doc_[A-Za-z0-9_-]+";
const BIBLIOGRAPHY_RE = /^#{1,6}\s*(evidence|sources|references)\b[^\n]*$[\s\S]*/im;

function stripFencedCode(text: string): string {
  return text.replace(/```[\s\S]*?```/g, " ").replace(/~~~[\s\S]*?~~~/g, " ");
}

/** Remove a trailing bibliography section; it is a citation list, not claims. */
export function stripBibliography(text: string): string {
  return text.replace(BIBLIOGRAPHY_RE, "").trim();
}

function splitSentences(prose: string): string[] {
  return prose
    .split(/(?:\n#{1,6}\s*|\n(?=\s*\n)|(?<=[.!?])\s+(?=[A-Z`*#\-\d]))/g)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s.length > 15);
}

export function computeGroundingStats(answer: string): GroundingStats {
  const allCitations = [...new Set(answer.match(new RegExp(CITATION_PATTERN, "g")) ?? [])].length;
  const prose = stripFencedCode(stripBibliography(answer));
  const sentences = splitSentences(prose);
  const citedSentences = sentences.filter((s) => new RegExp(CITATION_PATTERN).test(s)).length;
  const groundingDensity = sentences.length === 0 ? null : citedSentences / sentences.length;
  return {
    sentences: sentences.length,
    citedSentences,
    citations: allCitations,
    groundingDensity: groundingDensity === null ? null : Math.round(groundingDensity * 100) / 100,
  };
}