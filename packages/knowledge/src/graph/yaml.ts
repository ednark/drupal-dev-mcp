import { parseDocument } from 'yaml';
import { entityId, relationId } from '../ids.js';
import type { ExtractedEntity, GraphExtraction, NodeType, NormalizedDocument, RelationPredicate, RelationRecord } from '../types.js';

function kindForFile(file: string): NodeType {
  if (file.endsWith('.services.yml')) return 'service';
  if (file.endsWith('.routing.yml')) return 'route';
  return 'config';
}

export function extractYamlGraph(document: NormalizedDocument): GraphExtraction {
  const entities: ExtractedEntity[] = [];
  const relations: RelationRecord[] = [];
  const errors: GraphExtraction['errors'] = [];
  const file = document.repositoryPath ?? document.title;
  let value: unknown;
  try {
    const parsed = parseDocument(document.content, { prettyErrors: true });
    if (parsed.errors.length) throw parsed.errors[0];
    value = parsed.toJS();
  } catch (error) {
    errors.push({ file, message: error instanceof Error ? error.message : String(error) });
    return { entities, relations, errors };
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { entities, relations, errors };
  const kind = kindForFile(file);
  const addRelation = (fromId: string, predicate: RelationPredicate, target: string, confidence = 1): void => {
    relations.push({ id: relationId(fromId, predicate, target, document.id), fromId, predicate, unresolvedTarget: target, confidence, extractor: 'drupal-yaml', evidenceDocumentId: document.id });
  };
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const canonical = `${document.project ?? 'drupal'}:${kind}:${key}`;
    const id = entityId(document.project ?? 'drupal', document.drupalVersion, kind, canonical);
    const record = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, any> : {};
    entities.push({ id, kind, canonicalName: canonical, shortName: key, project: document.project, drupalVersion: document.drupalVersion, status: record.deprecated ? 'deprecated' : 'current', sourceDocumentId: document.id, filePath: file, aliases: [key] });
    if (kind === 'service') {
      if (typeof record.class === 'string') addRelation(id, 'implemented_by', record.class);
      if (typeof record.alias === 'string') addRelation(id, 'aliases', record.alias);
      if (typeof record.decorates === 'string') addRelation(id, 'decorates', record.decorates);
      for (const argument of Array.isArray(record.arguments) ? record.arguments : []) {
        if (typeof argument === 'string' && argument.startsWith('@')) addRelation(id, 'injects', argument.slice(1));
      }
      for (const tag of Array.isArray(record.tags) ? record.tags : []) {
        const name = typeof tag === 'string' ? tag : tag?.name;
        if (typeof name === 'string') addRelation(id, 'tagged_with', name);
      }
    } else if (kind === 'route') {
      const defaults = record.defaults ?? {};
      for (const handler of [defaults._controller, defaults._form, defaults._entity_form]) {
        if (typeof handler === 'string') addRelation(id, 'handled_by', handler);
      }
      const requirements = record.requirements ?? {};
      for (const requirement of Object.values(requirements)) {
        if (typeof requirement === 'string') addRelation(id, 'references', requirement, 0.75);
      }
    } else if (Array.isArray(record.dependencies)) {
      for (const dependency of record.dependencies) if (typeof dependency === 'string') addRelation(id, 'references', dependency, 0.75);
    }
  }
  return { entities, relations, errors };
}
