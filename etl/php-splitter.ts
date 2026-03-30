/**
 * PHP-aware code splitter for Drupal contrib module source files.
 *
 * Splits PHP source files at semantic boundaries (classes, methods, functions)
 * and YAML files at top-level key boundaries. Uses balanced-brace counting
 * rather than a full AST parser for reliability with well-formed Drupal code.
 */

// ── Exported Types ─────────────────────────────────────────────

export interface SplitChunk {
  /** The chunk text (code + preceding docblock). */
  text: string;
  /** Class name / function name / YAML key. */
  symbolName: string;
  /** Symbol classification. */
  symbolType: 'class' | 'method' | 'function' | 'service' | 'route' | 'config';
  /** PHP namespace if available, otherwise null. */
  namespace: string | null;
}

// ── Regex Patterns ─────────────────────────────────────────────

/**
 * Matches a class/interface/trait/enum declaration with optional preceding docblock.
 * Includes capture of modifiers, keyword, name, extends/implements, and opening brace.
 */
const CLASS_START_RE =
  /(?:\/\*\*[\s\S]*?\*\/\s*)?((?:(?:abstract|final|readonly)\s+)*(?:class|interface|trait|enum)\s+\w+[^{]*)\{/g;

/**
 * Matches a method declaration (with visibility modifiers) and optional preceding docblock.
 * Ends with the opening brace of the method body.
 */
const METHOD_RE =
  /(?:\/\*\*[\s\S]*?\*\/\s*)?((?:(?:public|protected|private|static|abstract|final)\s+)*function\s+\w+[^{]*)\{/g;

/**
 * Matches any named function declaration with optional preceding docblock.
 * Ends with the opening parenthesis of the parameter list.
 */
const FUNC_START_RE = /(?:\/\*\*[\s\S]*?\*\/\s*)?function\s+(\w+)\s*\(/g;

/** Matches the PHP namespace declaration. */
const NAMESPACE_RE = /^namespace\s+([\w\\]+)\s*;/m;

/** Matches top-level `use` import lines. */
const USE_BLOCK_RE = /^use\s+[\w\\]+(?:\s+as\s+\w+)?\s*;/gm;

/** Detects OOP keywords — signals class-boundary splitting mode. */
const OOP_DETECT_RE = /\b(?:class|interface|trait|enum)\s+\w+/;

/** Matches a YAML top-level key (starts at column 0, not a comment or list item). */
const TOP_LEVEL_KEY_RE = /^([a-zA-Z0-9_.\-]+):/;

// ── Constants ───────────────────────────────────────────────────

/** Class bodies larger than this threshold are split further at method boundaries. */
const LARGE_CLASS_THRESHOLD = 8_000;

/** Functions shorter than this are skipped (getters, one-liners, etc.). */
const MIN_FUNCTION_LENGTH = 100;

/** Class header stub is truncated to this many characters when prefixing method chunks. */
const CLASS_HEADER_STUB_LENGTH = 200;

// ── Internal Helpers ────────────────────────────────────────────

/**
 * Returns the position of the closing `}` that balances the opening `{` at
 * `openBracePos`. Returns -1 if the braces are unbalanced.
 */
function findBodyEnd(content: string, openBracePos: number): number {
  let depth = 0;
  for (let i = openBracePos; i < content.length; i++) {
    const ch = content[i];
    if (ch === '{') {
      depth++;
    }
    else if (ch === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Extracts the PHP namespace from file content, or null if absent. */
function extractNamespace(content: string): string | null {
  return content.match(NAMESPACE_RE)?.[1] ?? null;
}

/** Collects all top-level `use` import lines from file content. */
function extractUseStatements(content: string): string {
  const uses: string[] = [];
  USE_BLOCK_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = USE_BLOCK_RE.exec(content)) !== null) {
    uses.push(m[0].trim());
  }
  return uses.join('\n');
}

/** Builds a namespace + use-statement preamble string. */
function buildNamespaceBlock(namespace: string | null, useStatements: string): string {
  const parts: string[] = [];
  if (namespace) parts.push(`namespace ${namespace};`);
  if (useStatements) parts.push(useStatements);
  return parts.join('\n');
}

/**
 * Given a large class body text, splits it further at method boundaries.
 * Each resulting chunk includes a class header stub as context.
 */
function splitLargeClass(
  classText: string,
  namespace: string | null,
  useStatements: string,
  className: string,
): SplitChunk[] {
  const chunks: SplitChunk[] = [];

  // Build class header stub: truncated opening of the class for context
  const headerRaw = classText.slice(0, CLASS_HEADER_STUB_LENGTH);
  const lastNewline = headerRaw.lastIndexOf('\n');
  const headerStub = lastNewline > 0 ? headerRaw.slice(0, lastNewline) : headerRaw;
  const namespaceBlock = buildNamespaceBlock(namespace, useStatements);
  const contextPrefix = namespaceBlock
    ? `${namespaceBlock}\n\n${headerStub}\n// ...`
    : `${headerStub}\n// ...`;

  METHOD_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = METHOD_RE.exec(classText)) !== null) {
    const matchStart = match.index;
    // The METHOD_RE ends with '{', so openBracePos is the last char of the match
    const openBracePos = matchStart + match[0].length - 1;
    const bodyEnd = findBodyEnd(classText, openBracePos);
    if (bodyEnd === -1) continue;

    const methodText = classText.slice(matchStart, bodyEnd + 1);
    const nameMatch = methodText.match(/function\s+(\w+)/);
    const methodName = nameMatch?.[1] ?? 'unknown';

    chunks.push({
      text: `${contextPrefix}\n\n${methodText}`,
      symbolName: `${className}::${methodName}`,
      symbolType: 'method',
      namespace,
    });
  }

  // No methods found → return the class as a single chunk anyway
  if (chunks.length === 0) {
    const namespaceBlock2 = buildNamespaceBlock(namespace, useStatements);
    return [{
      text: namespaceBlock2 ? `${namespaceBlock2}\n\n${classText}` : classText,
      symbolName: className,
      symbolType: 'class',
      namespace,
    }];
  }

  return chunks;
}

/**
 * Splits an OOP PHP file (one that contains class/interface/trait/enum) at
 * class boundaries. Large classes are further split at method boundaries.
 */
function splitOopFile(
  content: string,
  namespace: string | null,
  useStatements: string,
): SplitChunk[] {
  const chunks: SplitChunk[] = [];
  const namespaceBlock = buildNamespaceBlock(namespace, useStatements);

  CLASS_START_RE.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = CLASS_START_RE.exec(content)) !== null) {
    const matchStart = match.index;
    // CLASS_START_RE ends with '{', openBracePos is the last char of the match
    const openBracePos = matchStart + match[0].length - 1;
    const bodyEnd = findBodyEnd(content, openBracePos);

    if (bodyEnd === -1) {
      // Malformed braces — fall back to whole file as one chunk
      return [{
        text: content,
        symbolName: 'unknown',
        symbolType: 'class',
        namespace,
      }];
    }

    const classText = content.slice(matchStart, bodyEnd + 1);
    const nameMatch = classText.match(/(?:class|interface|trait|enum)\s+(\w+)/);
    const className = nameMatch?.[1] ?? 'unknown';

    if (classText.length > LARGE_CLASS_THRESHOLD) {
      chunks.push(...splitLargeClass(classText, namespace, useStatements, className));
    }
    else {
      chunks.push({
        text: namespaceBlock ? `${namespaceBlock}\n\n${classText}` : classText,
        symbolName: className,
        symbolType: 'class',
        namespace,
      });
    }
  }

  if (chunks.length === 0) {
    return [{ text: content, symbolName: 'unknown', symbolType: 'class', namespace }];
  }

  return chunks;
}

/**
 * Splits a procedural PHP file (`.module`, `.install`, `.theme`, or `.php`
 * without OOP declarations) at named function boundaries.
 */
function splitProceduralFile(
  content: string,
  namespace: string | null,
): SplitChunk[] {
  const chunks: SplitChunk[] = [];

  FUNC_START_RE.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = FUNC_START_RE.exec(content)) !== null) {
    const funcName = match[1];
    const matchStart = match.index;
    // FUNC_START_RE ends at '(' — scan forward to find the opening brace
    const searchFrom = matchStart + match[0].length - 1;
    const openBracePos = content.indexOf('{', searchFrom);
    if (openBracePos === -1) continue;

    const bodyEnd = findBodyEnd(content, openBracePos);
    if (bodyEnd === -1) continue;

    const funcText = content.slice(matchStart, bodyEnd + 1);
    if (funcText.length < MIN_FUNCTION_LENGTH) continue;

    chunks.push({
      text: funcText,
      symbolName: funcName,
      symbolType: 'function',
      namespace,
    });
  }

  if (chunks.length === 0) {
    return [{ text: content, symbolName: 'unknown', symbolType: 'function', namespace }];
  }

  return chunks;
}

// ── Public API ─────────────────────────────────────────────────

/**
 * Splits a PHP source file into semantic chunks at class or function boundaries.
 *
 * @param content    Raw file content.
 * @param filePath   Path (for context only; currently unused in splitting logic).
 * @param moduleName Drupal module name (for context only).
 * @returns Array of `SplitChunk` objects, or empty array for trivial files.
 */
export function splitPhpFile(
  content: string,
  filePath: string,
  moduleName: string,
): SplitChunk[] {
  // Detect trivial files: only `<?php` tag + comments, no real code
  const stripped = content
    .replace(/^<\?php\s*/m, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')
    .trim();
  if (stripped.length === 0) return [];

  const namespace = extractNamespace(content);
  const useStatements = extractUseStatements(content);

  if (OOP_DETECT_RE.test(content)) {
    return splitOopFile(content, namespace, useStatements);
  }

  return splitProceduralFile(content, namespace);
}

/**
 * Splits a YAML file into semantic chunks.
 *
 * - `.services.yml` → one chunk per service definition (`symbolType: 'service'`)
 * - `.routing.yml`  → one chunk per route (`symbolType: 'route'`)
 * - `.info.yml`     → whole file as one chunk (`symbolType: 'config'`)
 * - `.schema.yml` and others → one chunk per top-level key (`symbolType: 'config'`)
 *
 * @param content    Raw file content.
 * @param filePath   Path to the file (for context only).
 * @param moduleName Drupal module name (for context only).
 * @param fileName   Base file name used to determine the YAML type.
 * @returns Array of `SplitChunk` objects.
 */
export function splitYamlFile(
  content: string,
  filePath: string,
  moduleName: string,
  fileName: string,
): SplitChunk[] {
  // Determine symbol type from file name
  const symbolType: SplitChunk['symbolType'] = fileName.endsWith('.services.yml')
    ? 'service'
    : fileName.endsWith('.routing.yml')
      ? 'route'
      : 'config';

  // info.yml → whole file as one chunk
  if (fileName.endsWith('.info.yml')) {
    return [{
      text: content.trim(),
      symbolName: moduleName,
      symbolType: 'config',
      namespace: null,
    }];
  }

  // Other YAML files → split by top-level keys
  const lines = content.split('\n');
  const keyStarts: Array<{ key: string; lineIndex: number }> = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Skip blank lines, comment lines, and indented lines
    if (!line || line.startsWith(' ') || line.startsWith('\t') || line.startsWith('#')) {
      continue;
    }
    const m = line.match(TOP_LEVEL_KEY_RE);
    if (m) {
      keyStarts.push({ key: m[1], lineIndex: i });
    }
  }

  if (keyStarts.length === 0) {
    // No recognisable top-level keys — return whole file
    return [{
      text: content.trim(),
      symbolName: fileName,
      symbolType,
      namespace: null,
    }];
  }

  return keyStarts.map((ks, i) => {
    const endLine = keyStarts[i + 1]?.lineIndex ?? lines.length;
    const text = lines.slice(ks.lineIndex, endLine).join('\n').trim();
    return {
      text,
      symbolName: ks.key,
      symbolType,
      namespace: null,
    };
  });
}
