import path from 'node:path';
import type { GraphExtraction, NormalizedDocument } from '../types.js';
import { extractPhpGraph } from './php.js';
import { extractYamlGraph } from './yaml.js';

export function extractGraph(document: NormalizedDocument): GraphExtraction {
  const file = document.repositoryPath ?? '';
  const extension = path.extname(file).toLowerCase();
  if (extension === '.yml') return extractYamlGraph(document);
  if (['.php', '.module', '.install', '.theme'].includes(extension)) return extractPhpGraph(document);
  return { entities: [], relations: [], errors: [] };
}
