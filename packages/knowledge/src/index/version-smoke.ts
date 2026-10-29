import type { KnowledgeProvider } from '../types.js';

/**
 * Version-scoped retrieval smoke probes.
 *
 * Unlike the benchmark (quality gate), these probes assert that version
 * filtering itself behaves correctly: content added in one version resolves
 * there, content removed in a later version stops resolving, and identifiers
 * that only exist on `main` never bleed into a pinned minor snapshot.
 *
 * Probe semantics:
 * - `search` probes run in lexical mode (no embedding dependency).
 * - Presence requires a `terms` hit in the result corpus (title + snippet)
 *   AND a `pathTerms` hit in a result `repositoryPath`; an empty list means
 *   "any result counts" for that dimension.
 * - Path terms exist because removed features legitimately remain mentioned
 *   in newer snapshots via removal change records and post-update hooks —
 *   the discriminating signal is whether the feature's own code path still
 *   resolves.
 *
 * Expectations are only checked for versions available in the active index;
 * probes with nothing left to check are reported as skipped rather than
 * failed.
 */
export interface VersionSmokeProbe {
  id: string;
  description: string;
  kind: 'search' | 'entity';
  /** Search query (kind 'search'). */
  query?: string;
  /** Entity identifier (kind 'entity'). */
  identifier?: string;
  /** Optional source-type restriction for the search (e.g. ['core_code']). */
  sourceTypes?: string[];
  /** Lowercase substrings that must appear in a result title or snippet for presence. */
  terms?: string[];
  /** Lowercase substrings that must appear in a result repositoryPath for presence. */
  pathTerms?: string[];
  /** Per-version expectation. Versions missing from the index are skipped. */
  expect: Partial<Record<string, 'present' | 'absent'>>;
}

export const VERSION_SMOKE_PROBES: VersionSmokeProbe[] = [
  {
    id: 'core-entity-type-manager-resolves-everywhere',
    description: 'Drupal\Core\Entity\EntityTypeManagerInterface resolves at every supported version',
    kind: 'entity',
    identifier: 'Drupal\\Core\\Entity\\EntityTypeManagerInterface',
    expect: { '10.6': 'present', '11.4': 'present', '12.0': 'present' },
  },
  {
    id: 'hook-install-tasks-resolves-everywhere',
    description: 'hook_install_tasks documentation resolves at every supported version',
    kind: 'search',
    query: 'hook_install_tasks',
    terms: ['hook_install_tasks'],
    expect: { '10.6': 'present', '11.4': 'present', '12.0': 'present' },
  },
  {
    id: 'claro-theme-removed-in-12',
    description: 'Claro core code resolves at 10.6/11.4 but not at 12.0 (theme removed from core)',
    kind: 'search',
    query: 'Claro',
    pathTerms: ['themes/claro'],
    expect: { '10.6': 'present', '11.4': 'present', '12.0': 'absent' },
  },
  {
    id: 'no-main-branch-bleed-into-12-snapshot',
    description: 'Identifiers that only exist on main (12.1.x) never appear in the 12.0.x snapshot',
    kind: 'search',
    query: 'TasksInterface reset serial',
    terms: ['tasksinterface'],
    expect: { '10.6': 'absent', '11.4': 'absent', '12.0': 'absent' },
  },
  // Version-agnostic corpora (2026-10-29): security advisories and the
  // curated guidance corpora are drupalVersion 'all' — they must resolve at
  // every pinned version, not only in unscoped searches.
  {
    id: 'security-advisories-resolve-per-version',
    description: 'Core security advisories resolve under every pinned version scope',
    kind: 'search',
    query: 'SA-CORE-2026-014',
    pathTerms: ['sa-core-2026-014'],
    expect: { '10.6': 'present', '11.4': 'present', '12.0': 'present' },
  },
  {
    id: 'anti-pattern-corpus-resolves-per-version',
    description: 'Curated anti-pattern guidance resolves under every pinned version scope',
    kind: 'search',
    query: 'AI-frequent Drupal anti-patterns overview',
    terms: ['anti-patterns'],
    expect: { '10.6': 'present', '11.4': 'present', '12.0': 'present' },
  },
] as const;

export interface VersionSmokeCase {
  probeId: string;
  version: string;
  expectation: 'present' | 'absent';
  observed: 'present' | 'absent';
  passed: boolean;
  /** Top result titles / entity status explaining the observation. */
  evidence: string;
}

export interface VersionSmokeResult {
  passed: number;
  total: number;
  /** Gate: at least one checked case and every case passed. */
  releaseGate: boolean;
  skipped: Array<{ probeId: string; reason: string }>;
  cases: VersionSmokeCase[];
}

function corpusOf(results: Array<{ title: string; snippet?: string; repositoryPath?: string }>): string {
  return results.map(result => `${result.title}\n${result.snippet ?? ''}\n${result.repositoryPath ?? ''}`.toLowerCase()).join('\n');
}

export async function runVersionSmoke(
  provider: KnowledgeProvider,
  options: { versions?: string[]; probes?: VersionSmokeProbe[] } = {},
): Promise<VersionSmokeResult> {
  const available = new Set((await provider.getIndexStatus()).availableDrupalVersions);
  const requested = options.versions?.length ? new Set(options.versions) : undefined;
  const cases: VersionSmokeCase[] = [];
  const skipped: VersionSmokeResult['skipped'] = [];

  for (const probe of options.probes ?? VERSION_SMOKE_PROBES) {
    const versions = Object.entries(probe.expect)
      .map(([version, expectation]) => ({ version, expectation: expectation as 'present' | 'absent' }))
      .filter(item => available.has(item.version))
      .filter(item => !requested || requested.has(item.version));
    if (versions.length === 0) {
      skipped.push({ probeId: probe.id, reason: `none of the expected versions (${Object.keys(probe.expect).join(', ')}) are available in the active index` });
      continue;
    }
    for (const { version, expectation } of versions) {
      let observed: 'present' | 'absent';
      let evidence: string;
      if (probe.kind === 'entity') {
        const response = await provider.getEntity({ identifier: probe.identifier, drupalVersion: version });
        observed = response.status === 'not_found' ? 'absent' : 'present';
        evidence = response.status === 'found'
          ? `entity ${response.entity?.drupalVersion} (${response.entity?.kind})`
          : response.status;
      } else {
        const response = await provider.search({
          query: probe.query ?? probe.id,
          drupalVersion: version,
          mode: 'lexical',
          limit: 25,
          minScore: 0,
          sourceTypes: probe.sourceTypes,
        });
        const corpus = corpusOf(response.results);
        const termHit = !probe.terms?.length || probe.terms.some(term => corpus.includes(term));
        const pathHit = !probe.pathTerms?.length || probe.pathTerms.some(pathTerm => response.results.some(result => (result.repositoryPath ?? '').toLowerCase().includes(pathTerm)));
        observed = termHit && pathHit ? 'present' : 'absent';
        evidence = response.results.length === 0
          ? 'no results'
          : response.results.slice(0, 3).map(result => result.title).join(' | ');
      }
      cases.push({ probeId: probe.id, version, expectation, observed, passed: observed === expectation, evidence });
    }
  }

  const passed = cases.filter(item => item.passed).length;
  return { passed, total: cases.length, releaseGate: cases.length > 0 && passed === cases.length, skipped, cases };
}
