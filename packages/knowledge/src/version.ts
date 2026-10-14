import type { DrupalVersion } from './types.js';

export const DEFAULT_DRUPAL_VERSION = '11.4' as const;
export const SUPPORTED_DRUPAL_VERSIONS = ['10.6', '11.4', '12.0'] as const;

export interface VersionMetadata {
  versionScope: 'drupal_core' | 'contrib_project' | 'php' | 'symfony' | 'agnostic';
  versionLine: string;
  rawVersion: string;
  drupalCoreConstraint?: string;
  stability: 'stable' | 'development' | 'deprecated' | 'experimental' | 'unknown';
}

export function normalizeDrupalVersion(raw?: string | null): VersionMetadata {
  const value = (raw ?? 'all').trim().toLowerCase();
  if (value === 'all' || value === 'general' || value === 'agnostic' || value === '') {
    return { versionScope: 'agnostic', versionLine: 'all', rawVersion: raw ?? 'all', stability: 'stable' };
  }
  if (value.startsWith('php')) {
    return { versionScope: 'php', versionLine: value, rawVersion: raw ?? value, stability: 'stable' };
  }
  if (value.startsWith('symfony') || value === 'current') {
    return { versionScope: 'symfony', versionLine: value, rawVersion: raw ?? value, stability: value === 'current' ? 'development' : 'stable' };
  }
  if (/[|^~*<>=]/.test(value)) {
    return {
      versionScope: 'contrib_project',
      versionLine: 'constraint',
      rawVersion: raw ?? value,
      drupalCoreConstraint: value,
      stability: value.includes('dev') ? 'development' : 'stable',
    };
  }
  const match = value.match(/(10|11|12)(?:\.(\d+))?/);
  const defaultMinor: Record<string, string> = { '10': '6', '11': '4', '12': '0' };
  const versionLine = match ? `${match[1]}.${match[2] ?? defaultMinor[match[1]]}` : value;
  return {
    versionScope: 'drupal_core',
    versionLine,
    rawVersion: raw ?? value,
    stability: value.includes('dev') || value.endsWith('.x') ? 'development' : 'stable',
  };
}

function majorMinor(version: string): [number, number] | null {
  const match = version.match(/^(\d+)(?:\.(\d+))?/);
  return match ? [Number(match[1]), Number(match[2] ?? 0)] : null;
}

export function constraintIncludes(constraint: string | undefined, target: string): boolean {
  if (!constraint || ['all', 'general', '*'].includes(constraint.trim().toLowerCase())) return true;
  const parsedTarget = majorMinor(target);
  if (!parsedTarget) return false;
  const [targetMajor, targetMinor] = parsedTarget;
  const alternatives = constraint.replace(/["']/g, '').split('||').map(value => value.trim());
  return alternatives.some((alternative) => {
    const versions = [...alternative.matchAll(/(?:\^|~|>=?|<=?)?\s*(\d+)(?:\.(\d+|x|\*))?/g)];
    if (versions.length === 0) return false;
    return versions.some((match) => {
      const major = Number(match[1]);
      const minorText = match[2];
      const minor = !minorText || minorText === 'x' || minorText === '*' ? null : Number(minorText);
      if (alternative.includes('<') && !alternative.includes('>')) return targetMajor < major || (targetMajor === major && minor !== null && targetMinor < minor);
      if (alternative.includes('>') && !alternative.includes('<')) return targetMajor > major || (targetMajor === major && (minor === null || targetMinor >= minor));
      return targetMajor === major && (minor === null || targetMinor >= minor || alternative.startsWith('^'));
    });
  });
}

export function isCompatible(raw: string | undefined, target: DrupalVersion | string): boolean {
  if (target === 'all') return true;
  const normalized = normalizeDrupalVersion(raw);
  if (normalized.versionScope === 'agnostic') return true;
  if (normalized.versionScope === 'contrib_project') return constraintIncludes(normalized.drupalCoreConstraint, target);
  if (normalized.versionScope !== 'drupal_core') return true;
  const targetVersion = majorMinor(target);
  const sourceVersion = majorMinor(normalized.versionLine);
  return Boolean(targetVersion && sourceVersion && targetVersion[0] === sourceVersion[0]);
}
