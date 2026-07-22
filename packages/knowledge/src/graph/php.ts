import * as PhpParser from 'php-parser';
import { entityId, relationId } from '../ids.js';
import type { ExtractedEntity, GraphExtraction, NodeType, NormalizedDocument, RelationPredicate, RelationRecord } from '../types.js';

type AstNode = Record<string, any>;

const parser = new PhpParser.Engine({
  parser: { extractDoc: true, suppressErrors: false },
  ast: { withPositions: true, withSource: true },
  lexer: { all_tokens: true, comment_tokens: true, mode_eval: false },
});

function nameOf(value: unknown): string | undefined {
  if (typeof value === 'string') return value.replace(/^\\/, '');
  if (!value || typeof value !== 'object') return undefined;
  const record = value as AstNode;
  if (typeof record.name === 'string') return record.name.replace(/^\\/, '');
  if (typeof record.value === 'string') return record.value.replace(/^\\/, '');
  if (record.what) return nameOf(record.what);
  return undefined;
}

function shortName(name: string): string {
  return name.split('\\').at(-1) ?? name;
}

function sourceLines(node: AstNode): { startLine?: number; endLine?: number } {
  return { startLine: node.loc?.start?.line, endLine: node.loc?.end?.line };
}

function nodeType(kind: string): NodeType | null {
  if (['class', 'interface', 'trait', 'enum', 'method', 'function'].includes(kind)) return kind as NodeType;
  return null;
}

function sourceSlice(document: NormalizedDocument, node: AstNode): string {
  const start = node.loc?.start?.offset;
  const end = node.loc?.end?.offset;
  return typeof start === 'number' && typeof end === 'number' ? document.content.slice(start, end + 1) : '';
}

function deprecation(source: string, doc?: AstNode): { status: string; message?: string; replacement?: string } {
  const docText = typeof doc?.value === 'string' ? doc.value : '';
  const all = `${docText}\n${source.slice(0, 1500)}`;
  const deprecatedMatch = all.match(/@deprecated\s*([^\n*]*)/i);
  const replacement = all.match(/(?:use|replaced by|instead)\s+([\\\w:]+)(?:\(\))?/i)?.[1];
  return deprecatedMatch
    ? { status: 'deprecated', message: deprecatedMatch[1]?.trim() || 'Deprecated', replacement }
    : { status: 'current' };
}

export function extractPhpGraph(document: NormalizedDocument): GraphExtraction {
  const entities: ExtractedEntity[] = [];
  const relations: RelationRecord[] = [];
  const errors: GraphExtraction['errors'] = [];
  let ast: AstNode;
  try {
    ast = parser.parseCode(document.content, document.repositoryPath ?? document.title) as unknown as AstNode;
  } catch (error) {
    errors.push({ file: document.repositoryPath ?? document.title, message: error instanceof Error ? error.message : String(error) });
    return { entities, relations, errors };
  }

  let namespace = '';
  const imports = new Map<string, string>();
  const stack: string[] = [];
  const idByAst = new WeakMap<object, string>();

  const qualify = (name: string): string => {
    const clean = name.replace(/^\\/, '');
    const first = clean.split('\\')[0];
    if (imports.has(first)) return `${imports.get(first)}${clean.length > first.length ? clean.slice(first.length) : ''}`;
    return clean.includes('\\') || !namespace ? clean : `${namespace}\\${clean}`;
  };

  const addRelation = (fromId: string, predicate: RelationPredicate, target: string, confidence: number, node: AstNode, extractor = 'php-ast'): void => {
    relations.push({
      id: relationId(fromId, predicate, target, document.id),
      fromId,
      predicate,
      unresolvedTarget: target,
      confidence,
      extractor,
      evidenceDocumentId: document.id,
      ...sourceLines(node),
    });
  };

  function visit(node: unknown, parent?: AstNode): void {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const child of node) visit(child, parent);
      return;
    }
    const current = node as AstNode;
    if (current.kind === 'namespace') namespace = nameOf(current.name) ?? namespace;
    if (current.kind === 'useitem') {
      const imported = nameOf(current.name);
      if (imported) imports.set(nameOf(current.alias) ?? shortName(imported), imported);
    }

    const kind = nodeType(current.kind);
    let pushed = false;
    if (kind) {
      const rawName = nameOf(current.name) ?? 'anonymous';
      const parentId = stack.at(-1);
      let canonical = kind === 'method' && parentId
        ? `${entities.find(entity => entity.id === parentId)?.canonicalName ?? ''}::${rawName}`
        : qualify(rawName);
      if (kind === 'function' && !canonical.includes('\\') && namespace) canonical = `${namespace}\\${canonical}`;
      const id = entityId(document.project ?? 'drupal', document.drupalVersion, kind, canonical);
      const source = sourceSlice(document, current);
      const state = deprecation(source, current.leadingComments?.[0]);
      const entity: ExtractedEntity = {
        id,
        kind,
        canonicalName: canonical,
        shortName: rawName,
        fqcn: ['class', 'interface', 'trait', 'enum'].includes(kind) ? canonical : undefined,
        project: document.project,
        drupalVersion: document.drupalVersion,
        status: state.status,
        deprecationMessage: state.message,
        replacementHint: state.replacement,
        sourceDocumentId: document.id,
        filePath: document.repositoryPath,
        parentId,
        aliases: [rawName],
        ...sourceLines(current),
      };
      entities.push(entity);
      idByAst.set(current, id);
      if (parentId) addRelation(parentId, 'contains', id, 1, current);
      for (const extended of Array.isArray(current.extends) ? current.extends : current.extends ? [current.extends] : []) {
        const target = nameOf(extended);
        if (target) addRelation(id, 'extends', qualify(target), 0.9, current);
      }
      for (const implemented of current.implements ?? []) {
        const target = nameOf(implemented);
        if (target) addRelation(id, 'implements', qualify(target), 0.9, current);
      }
      for (const attributeGroup of current.attrGroups ?? []) {
        for (const attribute of attributeGroup.attrs ?? []) {
          const attributeName = nameOf(attribute.name);
          if (attributeName && /(?:Plugin|Block|FieldType|ContentEntityType|ConfigEntityType)$/i.test(attributeName)) {
            const pluginName = `${canonical}#${attributeName}`;
            const pluginId = entityId(document.project ?? 'drupal', document.drupalVersion, 'plugin', pluginName);
            entities.push({ id: pluginId, kind: 'plugin', canonicalName: pluginName, shortName: shortName(attributeName), project: document.project, drupalVersion: document.drupalVersion, status: 'current', sourceDocumentId: document.id, filePath: document.repositoryPath, ...sourceLines(attribute) });
            addRelation(pluginId, 'implemented_by', id, 1, attribute, 'drupal-attribute');
          }
        }
      }
      if (kind === 'function' && document.project && rawName.startsWith(`${document.project}_`)) {
        const hookName = `hook_${rawName.slice(document.project.length + 1)}`;
        addRelation(id, 'implements_hook', hookName, 0.75, current, 'drupal-hook-convention');
      }
      stack.push(id);
      pushed = true;
    }

    const ownerId = stack.at(-1);
    if (ownerId && current.kind === 'traituse') {
      for (const trait of current.traits ?? []) {
        const target = nameOf(trait);
        if (target) addRelation(ownerId, 'uses_trait', qualify(target), 0.9, current);
      }
    }
    if (ownerId && current.kind === 'new') {
      const target = nameOf(current.what);
      if (target) addRelation(ownerId, 'instantiates', qualify(target), 0.9, current);
    }
    if (ownerId && ['call', 'staticcall'].includes(current.kind)) {
      const what = nameOf(current.what);
      const offset = nameOf(current.offset);
      const target = [what ? qualify(what) : undefined, offset].filter(Boolean).join('::');
      if (target) addRelation(ownerId, 'calls', target, current.kind === 'staticcall' ? 0.9 : 0.4, current);
    }

    for (const [key, value] of Object.entries(current)) {
      if (['loc', 'leadingComments', 'trailingComments', 'kind', 'errors', 'tokens'].includes(key)) continue;
      if (value && typeof value === 'object') visit(value, current);
    }
    if (pushed) stack.pop();
  }

  visit(ast);
  return { entities, relations, errors };
}
