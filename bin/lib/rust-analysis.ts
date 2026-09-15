import type { SourceAnalysis, SourceDeclaration, SourceDeclarationKind, ParsedImport } from './source-analysis.js';
import type { LanguageParser, ImportResolution, ImportResolutionContext } from './language-registry.js';

type Line = { text: string; start: number };
const linesOf = (content: string): Line[] => {
  const result: Line[] = [];
  let start = 0;
  for (const text of content.split('\n')) { result.push({ text, start }); start += text.length + 1; }
  return result;
};

function stripComment(text: string): string { return text.replace(/\/\/.*$/, '').trim(); }

function declarationEnd(lines: Line[], start: number): number {
  let depth = 0, opened = false;
  for (let i = start; i < lines.length; i++) {
    for (const ch of stripComment(lines[i].text)) {
      if (ch === '{') { opened = true; depth++; }
      else if (ch === '}' && opened) depth--;
    }
    if ((opened && depth === 0) || (!opened && /;\s*$/.test(stripComment(lines[i].text)))) return i;
  }
  return lines.length - 1;
}

function signature(lines: Line[], start: number, end: number): string {
  return lines.slice(start, Math.min(end + 1, start + 8)).map((line) => stripComment(line.text)).join('\n').trim();
}

function moduleCandidates(root: string, modulePath: string): string[] {
  const base = [root, modulePath].filter(Boolean).join('/');
  return [`${base}.rs`, `${base}/mod.rs`];
}

function rustRoot(sourceFiles: ReadonlySet<string>): string {
  if (sourceFiles.has('src/lib.rs') || sourceFiles.has('src/main.rs')) return 'src';
  return '';
}

export function analyzeRust(content: string, _file: string): SourceAnalysis {
  const lines = linesOf(content);
  const imports: ParsedImport[] = [];
  const declarations: SourceDeclaration[] = [];
  const publicNames: string[] = [];
  const declPattern = /^(pub(?:\([^)]*\))?\s+)?(async\s+)?(fn|struct|enum|trait|type|const|static)\s+([A-Za-z_][A-Za-z0-9_]*)/;

  for (let i = 0; i < lines.length; i++) {
    const clean = stripComment(lines[i].text);
    const useMatch = clean.match(/^(?:pub\s+)?use\s+([^;]+);?/);
    if (useMatch) imports.push({ kind: 'static_import', specifier: useMatch[1].trim(), start: lines[i].start, end: lines[i].start + lines[i].text.length });
    const modMatch = clean.match(/^(?:pub\s+)?mod\s+([A-Za-z_][A-Za-z0-9_]*)\s*;/);
    if (modMatch) imports.push({ kind: 'static_import', specifier: `self::${modMatch[1]}`, start: lines[i].start, end: lines[i].start + lines[i].text.length });
    const match = clean.match(declPattern);
    if (!match) continue;
    const name = match[4];
    const kind = match[3] === 'fn' ? 'function' : match[3] === 'struct' ? 'class' : match[3] as SourceDeclarationKind;
    const exported = Boolean(match[1]);
    const endLine = declarationEnd(lines, i);
    declarations.push({ kind, name, search_names: [name], start: lines[i].start, end: lines[endLine].start + lines[endLine].text.length, signature: signature(lines, i, endLine), exported });
    if (exported) publicNames.push(name);
    i = endLine;
  }
  return { imports, exports: [...new Set(publicNames)].sort(), declarations: declarations.sort((a, b) => a.start - b.start || a.name.localeCompare(b.name)) };
}

export const rustParser: LanguageParser = {
  id: 'rust',
  extensions: ['.rs'],
  analyze: analyzeRust,
  resolveImport(importer: string, specifier: string, { sourceFiles }: ImportResolutionContext): ImportResolution {
    const root = rustRoot(sourceFiles);
    const normalized = specifier.replace(/[;{}]/g, '').trim();
    const external = /^(std|core|alloc|[A-Za-z0-9_-]+::)/.test(normalized) && !/^(crate|self|super)::/.test(normalized);
    if (external) return { status: 'external' };
    const parts = normalized.split('::').filter(Boolean);
    let base = root;
    if (parts[0] === 'crate') parts.shift();
    else if (parts[0] === 'self') { parts.shift(); base = importer.includes('/') ? importer.slice(0, importer.lastIndexOf('/')) : root; }
    else if (parts[0] === 'super') {
      parts.shift();
      const dir = importer.includes('/') ? importer.slice(0, importer.lastIndexOf('/')) : root;
      base = dir.includes('/') ? dir.slice(0, dir.lastIndexOf('/')) : '';
    } else if (parts.length === 0) return { status: 'unresolved_local' };
    // A use path may name an item inside a module (`crate::store::Db`), so
    // probe progressively shorter module prefixes until a source module exists.
    let target: string | undefined;
    for (let length = parts.length; length > 0 && !target; length--) {
      target = moduleCandidates(base, parts.slice(0, length).join('/')).find((file) => sourceFiles.has(file));
    }
    return target ? { status: 'resolved', paths: [target] } : { status: 'unresolved_local' };
  }
};
