import path from 'node:path';
import type { SourceAnalysis } from './source-analysis.js';

export type ImportResolution =
  | { status: 'resolved'; paths: readonly string[] }
  | { status: 'external' }
  | { status: 'unresolved_local' };

export type ImportResolutionContext = {
  sourceFiles: ReadonlySet<string>; // all indexed files, repo-relative POSIX
  goModulePath?: string;            // root go.mod module path, e.g. 'github.com/acme/svc'
};

export type LanguageParser = {
  id: string;
  extensions: readonly string[];
  analyze(content: string, file: string): SourceAnalysis;
  resolveImport(importer: string, specifier: string, context: ImportResolutionContext): ImportResolution;
};

export type LanguageParserRegistry = {
  register(parser: LanguageParser): void;
  parserForFile(file: string): LanguageParser | null;
  allExtensions(): string[];
};

function validateParser(parser: LanguageParser): void {
  const { id } = parser;
  if (typeof id !== 'string' || id.length === 0 || id !== id.trim() || id !== id.toLowerCase()) {
    throw new Error(`invalid parser id '${String(id)}': must be a non-empty, trimmed, lowercase string`);
  }
  if (!Array.isArray(parser.extensions) || parser.extensions.length === 0) {
    throw new Error(`parser '${id}' must declare at least one extension`);
  }
  const seen = new Set<string>();
  for (const extension of parser.extensions) {
    if (typeof extension !== 'string' || !extension.startsWith('.')) throw new Error(`invalid extension '${String(extension)}' for '${id}': must start with '.'`);
    if (extension.length < 2) throw new Error(`invalid extension '${extension}' for '${id}': must name a suffix`);
    if (extension !== extension.toLowerCase()) throw new Error(`invalid extension '${extension}' for '${id}': must be lowercase`);
    if (seen.has(extension)) throw new Error(`parser '${id}' lists extension '${extension}' twice`);
    seen.add(extension);
  }
}

export function createLanguageRegistry(parsers: readonly LanguageParser[] = []): LanguageParserRegistry {
  const byExtension = new Map<string, LanguageParser>();
  const ids = new Set<string>();
  const register = (parser: LanguageParser): void => {
    validateParser(parser);                                   // 1. shape
    if (ids.has(parser.id)) throw new Error(`duplicate language parser id '${parser.id}'`);
    for (const extension of parser.extensions) {              // 2. conflicts (no mutation yet)
      if (byExtension.has(extension)) throw new Error(`extension '${extension}' already registered by '${byExtension.get(extension)!.id}'`);
    }
    for (const extension of parser.extensions) byExtension.set(extension, parser); // 3. mutate
    ids.add(parser.id);
  };
  for (const parser of parsers) register(parser);
  return {
    register,
    parserForFile: (file) => byExtension.get(path.extname(file).toLowerCase()) ?? null,
    allExtensions: () => Array.from(byExtension.keys()).sort()
  };
}

import { typescriptParser } from './source-analysis.js';
import { pythonParser } from './python-analysis.js';
import { goParser } from './go-analysis.js';
import { rustParser } from './rust-analysis.js';

const productionRegistry = createLanguageRegistry([typescriptParser, pythonParser, goParser, rustParser]);

export function parserForFile(file: string): LanguageParser | null {
  return productionRegistry.parserForFile(file);
}

export function allExtensions(): string[] {
  return productionRegistry.allExtensions();
}
