import path from 'node:path';
import type { GraphExtraction, NormalizedDocument } from '../types.js';
import { extractPhpGraph } from './php.js';
import { extractYamlGraph, yamlGraphKind } from './yaml.js';

const PHP_EXTENSIONS = new Set(['.php', '.module', '.install', '.theme']);

export function isGraphEligibleDocument(document: NormalizedDocument): boolean {
  const file = document.repositoryPath ?? '';
  const extension = path.extname(file).toLowerCase();
  if (PHP_EXTENSIONS.has(extension)) return true;
  if (extension !== '.yml') return false;
  // Only YAML files carrying Drupal machine-readable definitions are parsed
  // for the graph; CI pipeline YAML and arbitrary repo YAML stay indexed as
  // searchable text but mint no entities.
  return yamlGraphKind(file) !== null;
}

export function extractGraph(document: NormalizedDocument): GraphExtraction {
  const file = document.repositoryPath ?? '';
  const extension = path.extname(file).toLowerCase();
  if (!isGraphEligibleDocument(document)) return { entities: [], relations: [], errors: [] };
  if (extension === '.yml') return extractYamlGraph(document);
  if (PHP_EXTENSIONS.has(extension)) return extractPhpGraph(document);
  return { entities: [], relations: [], errors: [] };
}
