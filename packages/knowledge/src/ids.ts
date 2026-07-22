import { createHash } from 'node:crypto';

function opaque(prefix: string, stableKey: string): string {
  return `${prefix}_${createHash('sha256').update(stableKey).digest('base64url').slice(0, 24)}`;
}

export function entityId(project: string, version: string, kind: string, canonicalName: string): string {
  return opaque('ent', ['entity', project, version, kind, canonicalName].join('\0'));
}

export function documentId(sourceKey: string, version: string, locator: string): string {
  return opaque('doc', ['document', sourceKey, version, locator].join('\0'));
}

export function chunkId(document: string, locator: string, ordinal: number, contentHash: string): string {
  return opaque('chk', ['chunk', document, locator, String(ordinal), contentHash].join('\0'));
}

export function relationId(from: string, predicate: string, target: string, evidence = ''): string {
  return opaque('rel', ['relation', from, predicate, target, evidence].join('\0'));
}

export function contentHash(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}
