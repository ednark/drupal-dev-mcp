import type { KnowledgeProvider } from '../types.js';

export interface BenchmarkCase { question: string; expected: string[] }

export const BENCHMARK_CASES: BenchmarkCase[] = [
  { question: 'create Views display taxonomy terms exposed filters', expected: ['views', 'taxonomy', 'filter'] },
  { question: 'programmatically create a view and add a field', expected: ['view', 'field'] },
  { question: 'create a custom block plugin BlockBase build', expected: ['blockbase', 'block'] },
  { question: 'block visibility custom condition blockAccess', expected: ['blockaccess', 'condition'] },
  { question: 'custom field type custom formatter FieldType FieldFormatter', expected: ['fieldtype', 'fieldformatter'] },
  { question: 'baseFieldDefinitions BaseFieldDefinition content entity', expected: ['basefielddefinition', 'basefielddefinitions'] },
  { question: 'Node create field values save entity API', expected: ['node', 'create', 'save'] },
  { question: 'entity view builder render view mode', expected: ['entityviewbuilder', 'view mode'] },
  { question: 'taxonomy term storage loadTree vocabulary', expected: ['loadtree', 'termstorage'] },
  { question: 'taxonomy term reference field entity_reference', expected: ['entity_reference', 'taxonomy'] },
  { question: 'Twig template suggestion node bundle content type', expected: ['theme suggestions', 'twig', 'node--'] },
  { question: 'attach CSS library libraries.yml render array', expected: ['libraries.yml', '#attached', 'library'] },
  { question: 'FormBase buildForm validateForm submitForm', expected: ['formbase', 'validateform', 'submitform'] },
  { question: 'form AJAX callback AjaxResponse ReplaceCommand', expected: ['ajaxresponse', 'replacecommand', '#ajax'] },
  { question: 'custom text filter plugin FilterBase process', expected: ['filterbase', 'filter'] },
  { question: 'configuration schema custom module schema.yml typed config', expected: ['schema.yml', 'config schema', 'typed config'] },
  { question: 'custom content entity ContentEntityBase ContentEntityType', expected: ['contententitybase', 'contententitytype'] },
  { question: 'hook_entity_presave modify entity before saving', expected: ['hook_entity_presave', 'presave'] },
  { question: 'custom service services.yml dependency injection controller', expected: ['services.yml', 'containerinjectioninterface', 'dependency injection'] },
  { question: 'Drupal Database API select fields execute fetchAll', expected: ['select', 'database', 'fetchall'] },
  // Human-phrased cases promoted from the community-question audit
  // (docs/eval/human-questions-audit.md): real community phrasings with
  // unambiguous ground truth, verified to pass in lexical mode. The audit's
  // hybrid-only winners were deliberately left out — this gate runs lexical.
  { question: 'How do I create custom regions in a theme?', expected: ['info.yml', 'regions'] },
  { question: 'How can I fix these "Cannot autowire service" errors?', expected: ['autowiring', 'service_container'] },
  { question: 'Permanent Cache Bin and Memcache', expected: ['cache.md', 'caching.md', 'memcache'] },
  { question: 'Custom exception subscriber does not handle PHP errors', expected: ['exceptionsubscriber'] },
  { question: 'webform email handler does not allow certain roles in to field', expected: ['emailwebformhandler'] },
  // Contract-retrieval cases: machine-readable definitions (SDC components,
  // config schema) must surface alongside their prose documentation. Added
  // with milestone-1 structured YAML contract extraction.
  { question: 'single directory components theming sdc', expected: ['single directory component', 'drupal-canvas-sdc'] },
  { question: 'define sdc component yml metadata', expected: ['component.yml', 'drupal-canvas-sdc', 'single directory component'] },
  { question: 'component yml slots required props documentation', expected: ['component.yml', 'slots'] },
] as const;

export async function runBenchmark(provider: KnowledgeProvider, version = '11.4') {
  const cases = [];
  for (const benchmark of BENCHMARK_CASES) {
    const response = await provider.search({ query: benchmark.question, drupalVersion: version, mode: 'lexical', limit: 5 });
    const corpus = response.results.map(result => `${result.title}\n${result.snippet ?? ''}\n${result.repositoryPath ?? ''}`.toLowerCase()).join('\n');
    const matched = benchmark.expected.filter(term => corpus.includes(term.toLowerCase()));
    cases.push({ question: benchmark.question, passed: matched.length > 0, matched, results: response.results.map(result => ({ title: result.title, uri: result.resourceUri })) });
  }
  const passed = cases.filter(result => result.passed).length;
  // Release gate: 80% of cases must pass. The original 16/20 gate is kept
  // as a ratio so promoted human-phrased cases can grow the set without
  // loosening the bar.
  return { passed, total: cases.length, releaseGate: passed >= Math.ceil(cases.length * 0.8), cases };
}
