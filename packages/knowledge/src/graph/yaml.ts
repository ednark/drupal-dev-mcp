import { parseDocument } from 'yaml';
import { entityId, relationId } from '../ids.js';
import type { ExtractedEntity, GraphExtraction, NodeType, NormalizedDocument, RelationPredicate, RelationRecord } from '../types.js';

/**
 * YAML files that carry Drupal machine-readable definitions. Everything else
 * (CI pipelines, test fixtures, docs snippets, arbitrary repo YAML) stays
 * searchable as text but must not mint entities — top-level keys of an
 * arbitrary YAML file are not Drupal configuration.
 */
export function yamlGraphKind(file: string): NodeType | null {
  if (file.endsWith('.services.yml')) return 'service';
  if (file.endsWith('.routing.yml')) return 'route';
  if (file.endsWith('.component.yml')) return 'component';
  if (/(?:^|\/)config\/schema\/[^/]+\.yml$/i.test(file)) return 'config_schema';
  return null;
}

export function extractYamlGraph(document: NormalizedDocument): GraphExtraction {
  const entities: ExtractedEntity[] = [];
  const relations: RelationRecord[] = [];
  const errors: GraphExtraction['errors'] = [];
  const file = document.repositoryPath ?? document.title;
  const kind = yamlGraphKind(file);
  if (!kind) return { entities, relations, errors };
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
  const project = document.project ?? 'drupal';
  const addRelation = (fromId: string, predicate: RelationPredicate, target: string, confidence = 1): void => {
    relations.push({ id: relationId(fromId, predicate, target, document.id), fromId, predicate, unresolvedTarget: target, confidence, extractor: 'drupal-yaml', evidenceDocumentId: document.id });
  };
  // A component file defines exactly one component: its machine name is the
  // file name (`pager.component.yml` → `pager`) and the top-level keys
  // (`name`, `status`, `props`, `slots`, …) are fields of that definition.
  // Config schema files instead map every top-level key (a config-name
  // prefix) to its schema definition; `$schema` is metadata, not a mapping.
  const machineName = file.split('/').pop()!.replace(/\.component\.yml$/i, '');
  const keys = kind === 'component' ? [machineName] : Object.keys(value as Record<string, unknown>).filter(key => key !== '$schema');
  for (const key of keys) {
    const raw = kind === 'component' ? value : (value as Record<string, unknown>)[key];
    const canonical = `${project}:${kind}:${key}`;
    const id = entityId(project, document.drupalVersion, kind, canonical);
    const record = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, any> : {};
    const deprecated = record.deprecated === true || record.status === 'deprecated' || record.status === 'obsolete';
    entities.push({ id, kind, canonicalName: canonical, shortName: key, project: document.project, drupalVersion: document.drupalVersion, status: deprecated ? 'deprecated' : 'current', sourceDocumentId: document.id, filePath: file, aliases: [key] });
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
    } else if (kind === 'component') {
      // SDC components embed a JSON Schema in props.properties; record each
      // prop as a defines_property edge. The target stays unresolved (props
      // are not entities) but is qualified so it can never alias another
      // entity's name during relation resolution.
      const properties = record.props?.properties ?? {};
      for (const [propName, definition] of Object.entries(properties as Record<string, unknown>)) {
        const propType = definition && typeof definition === 'object' && typeof (definition as Record<string, unknown>).type === 'string'
          ? (definition as Record<string, unknown>).type as string
          : 'unknown';
        addRelation(id, 'defines_property', `${key}#${propName}:${propType}`);
      }
      for (const [required, constraint] of Object.entries(record.requires ?? {})) {
        if (typeof constraint === 'string') addRelation(id, 'references', required, 0.75);
      }
    } else if (kind === 'config_schema') {
      // Record the first-level mapping keys of each config schema definition.
      const mapping = record.mapping ?? {};
      for (const mappingKey of Object.keys(mapping as Record<string, unknown>)) {
        addRelation(id, 'defines_property', `${key}#${mappingKey}`, 0.9);
      }
    }
  }
  return { entities, relations, errors };
}
