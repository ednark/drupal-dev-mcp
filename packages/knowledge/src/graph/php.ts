import * as PhpParser from 'php-parser';
import { entityId, relationId } from '../ids.js';
import type { ExtractedEntity, GraphExtraction, NodeType, NormalizedDocument, RelationPredicate, RelationRecord } from '../types.js';

type AstNode = Record<string, any>;

const parser = new PhpParser.Engine({
  // Drupal 10.6 and 11.4 use PHP 8.5 parenthesized clone expressions.
  parser: { extractDoc: true, suppressErrors: false, version: '8.5' },
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

function scalarValue(value: unknown): string | undefined {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (!value || typeof value !== 'object') return undefined;
  const record = value as AstNode;
  if (record.kind === 'argument') return scalarValue(record.value);
  if (['string', 'number', 'identifier', 'name'].includes(record.kind) && record.value !== undefined) return String(record.value);
  if (record.kind === 'classconstant') {
    const owner = nameOf(record.what);
    const member = nameOf(record.offset);
    return [owner, member].filter(Boolean).join('::') || undefined;
  }
  return scalarValue(record.value) ?? nameOf(record);
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
  const moduleProject = document.repositoryPath?.match(/(?:^|\/)modules\/(?:contrib\/|custom\/)?([^/]+)/)?.[1]
    ?? document.project;

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
      if (kind === 'function' && rawName.startsWith('hook_')) {
        const hookId = entityId('drupal', document.drupalVersion, 'hook', rawName);
        entities.push({ id: hookId, kind: 'hook', canonicalName: rawName, shortName: rawName, project: 'drupal', drupalVersion: document.drupalVersion, status: state.status, sourceDocumentId: document.id, filePath: document.repositoryPath, aliases: [rawName], ...sourceLines(current) });
        addRelation(id, 'defines', hookId, 1, current, 'drupal-hook-definition');
      }
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
          if (attributeName && /(?:Plugin|Block|FieldType|FieldFormatter|Filter|ContentEntityType|ConfigEntityType)$/i.test(attributeName)) {
            const attributeArguments = attribute.args ?? attribute.arguments ?? [];
            const explicitId = attributeArguments.find((argument: AstNode) => nameOf(argument.name) === 'id');
            const pluginIdentifier = scalarValue(explicitId ?? attributeArguments[0]) ?? canonical;
            const pluginName = `${attributeName}:${pluginIdentifier}`;
            const pluginId = entityId(document.project ?? 'drupal', document.drupalVersion, 'plugin', pluginName);
            entities.push({ id: pluginId, kind: 'plugin', canonicalName: pluginName, shortName: pluginIdentifier, project: document.project, drupalVersion: document.drupalVersion, status: 'current', sourceDocumentId: document.id, filePath: document.repositoryPath, aliases: [pluginIdentifier, attributeName], ...sourceLines(attribute) });
            addRelation(pluginId, 'implemented_by', id, 1, attribute, 'drupal-attribute');
          }
        }
      }
      if (kind === 'function' && moduleProject && rawName.startsWith(`${moduleProject}_`)) {
        const hookName = `hook_${rawName.slice(moduleProject.length + 1)}`;
        addRelation(id, 'implements_hook', hookName, 0.75, current, 'drupal-hook-convention');
      }
      if (kind === 'method' && rawName === '__construct' && parentId) {
        for (const parameter of current.arguments ?? []) {
          const target = nameOf(parameter.type);
          if (target && !['string', 'int', 'float', 'bool', 'array', 'callable', 'mixed'].includes(target.toLowerCase())) addRelation(parentId, 'injects', qualify(target), 0.9, parameter, 'php-constructor-type');
        }
      }
      if (kind === 'method' && rawName === 'getSubscribedEvents' && parentId) {
        const methodSource = sourceSlice(document, current);
        const eventMatches = methodSource.matchAll(/(?:['"]([^'"]+)['"]|([\\\w]+::[A-Z_]+))\s*=>/g);
        for (const match of eventMatches) addRelation(parentId, 'subscribes_to', match[1] ?? match[2], 0.9, current, 'event-subscriber-return');
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
      const callable = current.what && typeof current.what === 'object' ? current.what as AstNode : current;
      const what = nameOf(callable.what ?? current.what);
      const offset = nameOf(callable.offset ?? current.offset);
      const target = [what ? qualify(what) : undefined, offset].filter(Boolean).join('::');
      if (target) addRelation(ownerId, 'calls', target, current.kind === 'staticcall' ? 0.9 : 0.4, current);
      if (offset && ['invokeAll', 'invoke'].includes(offset)) {
        const hook = scalarValue(current.arguments?.[0]);
        if (hook) addRelation(ownerId, 'invokes_hook', hook.startsWith('hook_') ? hook : `hook_${hook}`, 0.9, current, 'drupal-module-handler-call');
      }
      if (offset === 'dispatch') {
        const event = scalarValue(current.arguments?.[0]) ?? scalarValue(current.arguments?.[1]);
        if (event) addRelation(ownerId, 'dispatches', event, 0.9, current, 'event-dispatcher-call');
      }
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
