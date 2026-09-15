import type { SourceAnalysis, SourceDeclaration, SourceDeclarationKind, ParsedImport } from './source-analysis.js';
import type { LanguageParser, ImportResolution, ImportResolutionContext } from './language-registry.js';

type Line = { text: string; start: number };
type LineMeta = { inStringAtStart: boolean; continued: boolean; topLevel: boolean };

function toLines(content: string): Line[] {
  const lines: Line[] = [];
  let offset = 0;
  for (const text of content.split('\n')) {
    lines.push({ text, start: offset });
    offset += text.length + 1; // account for the split '\n'
  }
  return lines;
}

const indentOf = (text: string): number => text.length - text.trimStart().length;

/** Remove a trailing `#` comment from a single line, ignoring `#` inside single-
 *  or double-quoted string literals (with backslash escaping). Used when joining
 *  or validating logical lines whose original per-line comments must not leak
 *  into parsed values. Triple-quoted strings are not expected in these contexts. */
function stripLineComment(text: string): string {
  let quote = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\') { i++; continue; }
      if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '#') {
      return text.slice(0, i);
    }
  }
  return text;
}

/** One char-accurate pass. Per line records: whether it begins inside a
 *  triple-quoted string, whether it continues the previous logical line
 *  (open brackets / open string / trailing backslash), and whether it starts a
 *  new column-0 logical statement. Skips `#` comments and single-line strings. */
function scanLines(lines: Line[]): LineMeta[] {
  const meta: LineMeta[] = [];
  let inString = false, delimiter = '', depth = 0, continued = false;
  for (const { text } of lines) {
    const inStringAtStart = inString, continuedAtStart = continued, depthAtStart = depth;
    let i = 0;
    while (i < text.length) {
      if (inString) {
        if (text.startsWith(delimiter, i)) { inString = false; i += 3; } else i++;
        continue;
      }
      const ch = text[i];
      if (ch === '#') break;
      if (text.startsWith('"""', i) || text.startsWith("'''", i)) { inString = true; delimiter = text.slice(i, i + 3); i += 3; continue; }
      if (ch === '"' || ch === "'") { i++; while (i < text.length && text[i] !== ch) { if (text[i] === '\\') i++; i++; } i++; continue; }
      if (ch === '(' || ch === '[' || ch === '{') depth++;
      else if (ch === ')' || ch === ']' || ch === '}') depth = Math.max(0, depth - 1);
      i++;
    }
    const backslash = !inString && /\\\s*$/.test(text.split('#')[0]);
    continued = inString || depth > 0 || backslash;
    const trimmed = text.trim();
    const topLevel = !inStringAtStart && !continuedAtStart && depthAtStart === 0
      && trimmed.length > 0 && !trimmed.startsWith('#') && indentOf(text) === 0;
    meta.push({ inStringAtStart, continued: continuedAtStart, topLevel });
  }
  return meta;
}

/** Location of the suite colon that ends a def/class header: the first `:` at
 *  bracket depth 0 (so colons inside params/annotations/defaults are ignored).
 *  Searches only `[headerLine, limit)` — the header must close before the next
 *  top-level statement. Returns null for a malformed header with no suite colon,
 *  so it can never absorb the `:` of the following declaration. */
function headerEnd(lines: Line[], headerLine: number, limit: number): { line: number; col: number } | null {
  let inString = false, delimiter = '', depth = 0;
  for (let j = headerLine; j < limit; j++) {
    const text = lines[j].text;
    let i = 0;
    while (i < text.length) {
      if (inString) { if (text.startsWith(delimiter, i)) { inString = false; i += 3; } else i++; continue; }
      const ch = text[i];
      if (ch === '#') break;
      if (text.startsWith('"""', i) || text.startsWith("'''", i)) { inString = true; delimiter = text.slice(i, i + 3); i += 3; continue; }
      if (ch === '"' || ch === "'") { i++; while (i < text.length && text[i] !== ch) { if (text[i] === '\\') i++; i++; } i++; continue; }
      if (ch === '(' || ch === '[' || ch === '{') depth++;
      else if (ch === ')' || ch === ']' || ch === '}') depth = Math.max(0, depth - 1);
      else if (ch === ':' && depth === 0) return { line: j, col: i };
      i++;
    }
  }
  return null;
}

/** Static __all__ = [ ... ] / ( ... ) whose members are ALL string literals.
 *  Parses only the RHS after the first `=` (so an `__all__: list[str]` annotation
 *  is not mistaken for the value). Returns null on absence or any dynamic member. */
function parseExplicitAll(lines: Line[], meta: LineMeta[]): string[] | null {
  const startLine = lines.findIndex((line, i) => meta[i].topLevel && /^__all__\b/.test(line.text.trimStart()));
  if (startLine === -1) return null;
  let text = stripLineComment(lines[startLine].text);
  for (let j = startLine + 1; j < lines.length && meta[j].continued; j++) text += `\n${stripLineComment(lines[j].text)}`;
  const eq = text.indexOf('=');
  if (eq === -1) return null;
  const rhs = text.slice(eq + 1).trim();
  const literal = rhs.match(/^[[(]([\s\S]*)[\])]\s*$/);
  if (!literal) return null;
  const inner = literal[1];
  if (!/^\s*(['"][^'"]*['"]\s*,?\s*)*$/.test(inner)) return null; // any non-string member → fallback
  return Array.from(inner.matchAll(/['"]([^'"]+)['"]/g), (m) => m[1]);
}

export function analyzePython(content: string, file: string): SourceAnalysis {
  const lines = toLines(content);
  const meta = scanLines(lines);
  const topStarts: number[] = [];
  for (let i = 0; i < lines.length; i++) if (meta[i].topLevel) topStarts.push(i);

  const declarations: SourceDeclaration[] = [];
  const publicNames: string[] = [];

  for (let s = 0; s < topStarts.length; s++) {
    const headerLine = topStarts[s];
    const header = lines[headerLine].text.trimStart().match(/^(async\s+def|def|class)\s+([A-Za-z_][A-Za-z0-9_]*)/);
    if (!header) continue; // import, assignment, bare decorator, or other statement

    let declStart = headerLine;
    for (let p = s - 1; p >= 0 && lines[topStarts[p]].text.trimStart().startsWith('@'); p--) declStart = topStarts[p];

    const nextTop = topStarts.find((idx) => idx > headerLine);
    const boundary = nextTop ?? lines.length;
    const headerColon = headerEnd(lines, headerLine, boundary);
    if (!headerColon) continue; // malformed header (no suite colon) → not a declaration

    let endLine = boundary - 1;
    while (endLine > headerLine && lines[endLine].text.trim().length === 0) endLine--;

    const name = header[2];
    const isClass = header[1] === 'class';
    const isTest = isClass ? name.startsWith('Test') : name.startsWith('test_');
    const kind: SourceDeclarationKind = isTest ? 'test' : isClass ? 'class' : 'function';
    const sigLines = lines.slice(headerLine, headerColon.line).map((l) => l.text);
    sigLines.push(lines[headerColon.line].text.slice(0, headerColon.col + 1));
    const signature = sigLines.join('\n');

    declarations.push({
      kind, name, search_names: [name],
      start: lines[declStart].start,
      end: lines[endLine].start + lines[endLine].text.length,
      signature, exported: false
    });
    if (!isTest && !name.startsWith('_')) publicNames.push(name);
  }

  const exports = (parseExplicitAll(lines, meta) ?? publicNames).slice().sort();
  const exportSet = new Set(exports);
  for (const declaration of declarations) declaration.exported = exportSet.has(declaration.name);

  const imports: ParsedImport[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (meta[i].inStringAtStart || meta[i].continued) continue; // imports at ANY indent, but not continuations
    const { text, start } = lines[i];
    const trimmed = stripLineComment(text).trim();
    const fromMatch = trimmed.match(/^from\s+(\.*[A-Za-z0-9_.]*)\s+import\s+(.*)$/);
    if (fromMatch) {
      let end = start + text.length;
      let names = fromMatch[2];
      if (meta[i + 1]?.continued && names.includes('(') && !names.includes(')')) {
        let j = i;
        while (j + 1 < lines.length && meta[j + 1].continued) j++;
        end = lines[j].start + lines[j].text.length;
        names = lines.slice(i, j + 1).map((l) => stripLineComment(l.text)).join(' ');
      }
      const module = fromMatch[1];
      if (/^\.+$/.test(module)) {
        const cleaned = names.replace(/^.*?import/, '').replace(/[()]/g, '');
        for (const raw of cleaned.split(',')) {
          const nm = raw.trim().split(/\s+as\s+/)[0].trim();
          if (nm) imports.push({ kind: 'static_import', specifier: `${module}${nm}`, start, end });
        }
      } else {
        imports.push({ kind: 'static_import', specifier: module, start, end });
      }
      continue;
    }
    const importMatch = trimmed.match(/^import\s+(.*)$/);
    if (importMatch) {
      for (const raw of importMatch[1].split(',')) {
        const nm = raw.trim().split(/\s+as\s+/)[0].trim();
        if (nm) imports.push({ kind: 'static_import', specifier: nm, start, end: start + text.length });
      }
    }
  }
  void file;
  return { imports, exports, declarations: declarations.sort((a, b) => a.start - b.start || a.name.localeCompare(b.name)) };
}

const PY_EXTENSIONS = ['.py', '.pyi'] as const;

function moduleCandidates(base: string): string[] {
  return [`${base}.py`, `${base}.pyi`, `${base}/__init__.py`, `${base}/__init__.pyi`];
}

function packageInit(dir: string): string[] {
  const base = dir.length ? `${dir}/__init__` : '__init__';
  return [`${base}.py`, `${base}.pyi`];
}

export const pythonParser: LanguageParser = {
  id: 'python',
  extensions: PY_EXTENSIONS,
  analyze: analyzePython,
  resolveImport(importer: string, specifier: string, { sourceFiles }: ImportResolutionContext): ImportResolution {
    if (specifier.startsWith('.')) {
      const dots = specifier.match(/^\.+/)![0].length;
      const rest = specifier.slice(dots).replace(/\./g, '/');
      const importerDir = importer.includes('/') ? importer.slice(0, importer.lastIndexOf('/')) : '';
      let dirParts = importerDir.length ? importerDir.split('/') : [];
      const upLevels = dots - 1;
      if (upLevels > dirParts.length) return { status: 'unresolved_local' };
      if (upLevels > 0) dirParts = dirParts.slice(0, dirParts.length - upLevels);
      const dir = dirParts.join('/');
      // Named relative import → sibling module only (no package-__init__ fallback in
      // this phase). Pure-dot import (`.`/`..`) → the referenced package's __init__.
      const candidates = rest
        ? moduleCandidates(dir.length ? `${dir}/${rest}` : rest)
        : packageInit(dir);
      const target = candidates.find((candidate) => sourceFiles.has(candidate));
      return target ? { status: 'resolved', paths: [target] } : { status: 'unresolved_local' };
    }
    const modulePath = specifier.replace(/\./g, '/');
    const roots = ['', 'src'].filter((root) => root === '' || [...sourceFiles].some((file) => file.startsWith(`${root}/`)));
    const target = roots.flatMap((root) => moduleCandidates(root ? `${root}/${modulePath}` : modulePath)).find((candidate) => sourceFiles.has(candidate));
    return target ? { status: 'resolved', paths: [target] } : { status: 'external' };
  }
};
