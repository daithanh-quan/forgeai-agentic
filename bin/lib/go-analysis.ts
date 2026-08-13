import type { SourceAnalysis, SourceDeclaration, SourceDeclarationKind, ParsedImport } from './source-analysis.js';
import type { LanguageParser, ImportResolution, ImportResolutionContext } from './language-registry.js';

// ─── scanner ─────────────────────────────────────────────────────────────────

type ScanState = {
  braceDepth: number;
  parenDepth: number;
  bracketDepth: number;
  inBlockComment: boolean;
  inInterpString: boolean;
  inRawString: boolean;
  inRune: boolean;
};

function makeState(): ScanState {
  return { braceDepth: 0, parenDepth: 0, bracketDepth: 0, inBlockComment: false, inInterpString: false, inRawString: false, inRune: false };
}

// Scan one line, update all depth counters, return effective content (strings/comments stripped).
// Import paths live inside strings and must be extracted from line.text, never from effective.
function scanLine(line: string, state: ScanState): string {
  let effective = '';
  let i = 0;
  while (i < line.length) {
    const ch = line[i];
    if (state.inBlockComment) {
      if (ch === '*' && line[i + 1] === '/') { state.inBlockComment = false; i += 2; } else i++;
      continue;
    }
    if (state.inRawString) { if (ch === '`') state.inRawString = false; i++; continue; }
    if (state.inInterpString) { if (ch === '\\') { i += 2; continue; } if (ch === '"') state.inInterpString = false; i++; continue; }
    if (state.inRune) { if (ch === '\\') { i += 2; continue; } if (ch === "'") state.inRune = false; i++; continue; }
    if (ch === '/' && line[i + 1] === '/') break;
    if (ch === '/' && line[i + 1] === '*') { state.inBlockComment = true; i += 2; continue; }
    if (ch === '`') { state.inRawString = true; i++; continue; }
    if (ch === '"') { state.inInterpString = true; i++; continue; }
    if (ch === "'") { state.inRune = true; i++; continue; }
    if (ch === '{') state.braceDepth++;
    else if (ch === '}') { if (state.braceDepth > 0) state.braceDepth--; }
    else if (ch === '(') state.parenDepth++;
    else if (ch === ')') { if (state.parenDepth > 0) state.parenDepth--; }
    else if (ch === '[') state.bracketDepth++;
    else if (ch === ']') { if (state.bracketDepth > 0) state.bracketDepth--; }
    effective += ch;
    i++;
  }
  return effective;
}

type LineInfo = {
  text: string;
  start: number;
  effective: string;
  braceDepthBefore: number;
  parenDepthBefore: number;
  bracketDepthBefore: number;
  inBlockCommentBefore: boolean;
};

function toLines(content: string): LineInfo[] {
  const lines: LineInfo[] = [];
  const state = makeState();
  let offset = 0;
  for (const text of content.split('\n')) {
    const { braceDepth, parenDepth, bracketDepth, inBlockComment } = state;
    const effective = scanLine(text, state);
    lines.push({ text, start: offset, effective, braceDepthBefore: braceDepth, parenDepthBefore: parenDepth, bracketDepthBefore: bracketDepth, inBlockCommentBefore: inBlockComment });
    offset += text.length + 1;
  }
  return lines;
}

function isAtTopLevel(line: LineInfo): boolean {
  return line.braceDepthBefore === 0 && line.parenDepthBefore === 0 && line.bracketDepthBefore === 0;
}

// ─── spans ────────────────────────────────────────────────────────────────────

// Returns the line index where a declaration's doc comment begins, or declLine if none.
// Handles contiguous `//` lines, single-line `/* */`, and multi-line `/* ... */` blocks.
function docCommentStart(lines: LineInfo[], declLine: number): number {
  let i = declLine - 1;
  if (i < 0) return declLine;
  const prevRaw = lines[i].text.trim();
  if (prevRaw.length === 0) return declLine;
  if (prevRaw.startsWith('//')) {
    while (i > 0 && lines[i - 1].text.trim().startsWith('//')) i--;
    return i;
  }
  if (prevRaw.startsWith('/*')) return i;
  // End of multi-line block: walk back to opener; blank lines inside the block are allowed.
  if (prevRaw.startsWith('*/') || prevRaw.endsWith('*/')) {
    let j = i;
    while (j >= 0) {
      if (lines[j].text.trim().startsWith('/*')) return j;
      j--;
    }
  }
  return declLine;
}

// Span ends just before the next top-level construct. A top-level comment line (// or /*) is
// treated as a boundary because it may be the doc comment of the following declaration.
function spanEnd(lines: LineInfo[], declLine: number): number {
  let endLine = lines.length - 1;
  for (let i = declLine + 1; i < lines.length; i++) {
    if (!isAtTopLevel(lines[i])) continue;
    const eff = lines[i].effective.trim();
    const raw = lines[i].text.trim();
    if (eff.length > 0 || raw.startsWith('//') || raw.startsWith('/*')) {
      endLine = i - 1;
      while (endLine > declLine && lines[endLine].text.trim().length === 0) endLine--;
      break;
    }
  }
  return lines[endLine].start + lines[endLine].text.length;
}

type SignatureMode = 'function' | 'type_body' | 'logical_line';

// Extract signature.
// 'function'     — scan for body '{'; struct/interface preceding { = inline return type, skip it.
// 'type_body'    — scan for body '{'; any { at depth 0 (brace+paren+bracket) is the body opener.
// 'logical_line' — return effective header line directly (const / var / type alias / grouped).
function extractSignature(lines: LineInfo[], declLine: number, end: number, mode: SignatureMode): string {
  if (mode === 'logical_line') return lines[declLine].effective.trim();
  const sigState = makeState();
  const sigLines: string[] = [];
  let foundBrace = false;

  for (let i = declLine; i < lines.length && lines[i].start <= end; i++) {
    const text = lines[i].text;
    let partial = '';
    let j = 0;
    while (j < text.length) {
      const ch = text[j];
      if (sigState.inBlockComment) {
        if (ch === '*' && text[j + 1] === '/') { sigState.inBlockComment = false; j += 2; } else j++;
        continue;
      }
      if (sigState.inRawString) { if (ch === '`') sigState.inRawString = false; j++; continue; }
      if (sigState.inInterpString) { if (ch === '\\') { j += 2; continue; } if (ch === '"') sigState.inInterpString = false; j++; continue; }
      if (sigState.inRune) { if (ch === '\\') { j += 2; continue; } if (ch === "'") sigState.inRune = false; j++; continue; }
      if (ch === '/' && text[j + 1] === '/') break;
      if (ch === '/' && text[j + 1] === '*') { sigState.inBlockComment = true; j += 2; continue; }
      if (ch === '`') { sigState.inRawString = true; partial += ch; j++; continue; }
      if (ch === '"') { sigState.inInterpString = true; partial += ch; j++; continue; }
      if (ch === "'") { sigState.inRune = true; partial += ch; j++; continue; }
      if (ch === '{' && sigState.braceDepth === 0 && sigState.parenDepth === 0 && sigState.bracketDepth === 0) {
        if (mode === 'function') {
          // In function mode only: struct/interface before { signals an inline return type.
          const lastToken = partial.trimEnd().match(/\b(\w+)$/)?.[1] ?? '';
          if (lastToken === 'struct' || lastToken === 'interface') {
            // Peek: if immediately closed (e.g. interface{}), include {} and continue scanning
            let k = j + 1;
            while (k < text.length && text[k] === ' ') k++;
            if (k < text.length && text[k] === '}') {
              partial += ch; j++;
              while (j < text.length && text[j] === ' ') { partial += text[j]; j++; }
              if (j < text.length) { partial += text[j]; j++; }
              continue;
            }
            // Non-empty inline composite type (e.g. struct{ V int }): track depth and continue
            sigState.braceDepth++;
            partial += ch;
            j++;
            continue;
          }
        }
        // type_body mode, or function mode without preceding struct/interface: body opener
        partial += ch;
        foundBrace = true;
        break;
      }
      if (ch === '{') sigState.braceDepth++;
      else if (ch === '}' && sigState.braceDepth > 0) sigState.braceDepth--;
      else if (ch === '(') sigState.parenDepth++;
      else if (ch === ')' && sigState.parenDepth > 0) sigState.parenDepth--;
      else if (ch === '[') sigState.bracketDepth++;
      else if (ch === ']' && sigState.bracketDepth > 0) sigState.bracketDepth--;
      partial += ch;
      j++;
    }
    sigLines.push(partial);
    if (foundBrace) break;
  }

  if (!foundBrace) return lines[declLine].effective.trim();
  return sigLines.join('\n');
}

// ─── name extraction ──────────────────────────────────────────────────────────

// Extract all declared names from a const/var/type declaration line or group member line.
// Handles: `A = 1`, `A, B = 1, 2`, `X int`, `X, Y int`, `A int = 1`.
function extractNamesFromDecl(text: string): string[] {
  const lhs = text.split(/\s*[=:]/)[0];
  return lhs
    .split(',')
    .map(s => s.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)/)?.[1])
    .filter((n): n is string => !!n && n !== '_');
}

// Classify a non-grouped type declaration as 'class' (struct or interface) or 'type' (alias/other).
// afterName is the effective text on the declaration line immediately after the type name.
// If afterName starts with '[', a bracket-depth counter scans forward to find the matching ']',
// continuing onto subsequent lines for multi-line type-parameter lists.
// Uses bracket depth (not indexOf) so nested brackets like ~[16]byte are handled correctly.
function classifyTypeKind(lines: LineInfo[], startLine: number, afterName: string): 'class' | 'type' {
  if (!afterName.startsWith('[')) {
    return (afterName.startsWith('struct') || afterName.startsWith('interface')) ? 'class' : 'type';
  }
  let depth = 0;
  // First pass: within afterName (the remainder of the declaration line)
  for (let j = 0; j < afterName.length; j++) {
    if (afterName[j] === '[') depth++;
    else if (afterName[j] === ']') {
      depth--;
      if (depth === 0) {
        const rest = afterName.slice(j + 1).trimStart();
        return (rest.startsWith('struct') || rest.startsWith('interface')) ? 'class' : 'type';
      }
    }
  }
  // Second pass: multi-line type-parameter list — scan subsequent effective lines
  for (let i = startLine + 1; i < lines.length; i++) {
    const seg = lines[i].effective;
    for (let j = 0; j < seg.length; j++) {
      if (seg[j] === '[') depth++;
      else if (seg[j] === ']') {
        depth--;
        if (depth === 0) {
          const rest = seg.slice(j + 1).trimStart();
          return (rest.startsWith('struct') || rest.startsWith('interface')) ? 'class' : 'type';
        }
      }
    }
  }
  return 'type'; // malformed or unrecognized
}

// Collect declared names from a `const (` / `var (` / `type (` group body.
// Only processes lines at direct group depth (parenDepthBefore===1, brace/bracket===0).
function parseGroupedNames(lines: LineInfo[], startLine: number): string[] {
  const names: string[] = [];
  for (let i = startLine + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.parenDepthBefore !== 1 || line.braceDepthBefore !== 0 || line.bracketDepthBefore !== 0) continue;
    const eff = line.effective.trim();
    if (eff === '') continue;
    if (eff === ')' || eff.startsWith(')')) break;
    names.push(...extractNamesFromDecl(eff));
  }
  return names;
}

// ─── helpers ─────────────────────────────────────────────────────────────────

// Returns text with comment regions replaced by spaces, preserving string literals intact.
// Tracks interpreted and raw string state so comment-like sequences inside strings are not masked.
function maskComments(text: string, startInBlock: boolean): string {
  let out = '';
  let i = 0;
  let inBlock = startInBlock;
  let inStr = false;
  let inRaw = false;
  while (i < text.length) {
    if (inBlock) {
      if (text[i] === '*' && text[i + 1] === '/') { out += '  '; i += 2; inBlock = false; }
      else { out += ' '; i++; }
    } else if (inStr) {
      if (text[i] === '\\') { out += text[i]; out += text[i + 1] ?? ''; i += 2; }
      else if (text[i] === '"') { out += text[i]; i++; inStr = false; }
      else { out += text[i]; i++; }
    } else if (inRaw) {
      if (text[i] === '`') { out += text[i]; i++; inRaw = false; }
      else { out += text[i]; i++; }
    } else {
      if (text[i] === '/' && text[i + 1] === '/') {
        while (i < text.length) { out += ' '; i++; }
      } else if (text[i] === '/' && text[i + 1] === '*') {
        out += '  '; i += 2; inBlock = true;
      } else if (text[i] === '"') {
        out += text[i]; i++; inStr = true;
      } else if (text[i] === '`') {
        out += text[i]; i++; inRaw = true;
      } else {
        out += text[i]; i++;
      }
    }
  }
  return out;
}

function isUppercase(name: string): boolean {
  if (!name) return false;
  const ch = String.fromCodePoint(name.codePointAt(0)!);
  return ch === ch.toUpperCase() && ch !== ch.toLowerCase();
}

// ─── analyzer ────────────────────────────────────────────────────────────────

export function analyzeGo(content: string, file: string): SourceAnalysis {
  const isTestFile = file.endsWith('_test.go');
  const lines = toLines(content);
  const declarations: SourceDeclaration[] = [];
  const imports: ParsedImport[] = [];
  let inImportBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // ── Import block: checked BEFORE isAtTopLevel because member lines have parenDepthBefore=1 ──
    if (inImportBlock) {
      const eff = line.effective.trim();
      if (eff === ')' || eff.startsWith(')')) { inImportBlock = false; continue; }
      const m = maskComments(line.text, line.inBlockCommentBefore).match(/"([^"]+)"/);
      if (m) imports.push({ kind: 'static_import', specifier: m[1], start: line.start, end: line.start + line.text.length });
      continue;
    }

    if (!isAtTopLevel(line)) continue;
    const eff = line.effective.trim();
    if (eff === '') continue;

    // ── Single-line import ────────────────────────────────────────────────────
    if (eff.startsWith('import ') || eff === 'import(') {
      const rest = eff.slice('import'.length).trim();
      if (rest === '(' || rest.startsWith('(')) {
        inImportBlock = true;
      } else {
        const m = maskComments(line.text, false).match(/"([^"]+)"/);
        if (m) imports.push({ kind: 'static_import', specifier: m[1], start: line.start, end: line.start + line.text.length });
      }
      continue;
    }

    // ── Declaration parsing ───────────────────────────────────────────────────
    const isFuncDecl = eff.startsWith('func ') || eff === 'func(';
    const isTypeDecl = !isFuncDecl && (eff.startsWith('type ') || eff === 'type(');
    const isConstDecl = !isFuncDecl && !isTypeDecl && (eff.startsWith('const ') || eff === 'const(');
    const isVarDecl = !isFuncDecl && !isTypeDecl && !isConstDecl && (eff.startsWith('var ') || eff === 'var(');

    if (!isFuncDecl && !isTypeDecl && !isConstDecl && !isVarDecl) continue;

    let kind: SourceDeclarationKind;
    let name: string;
    let search_names: string[];

    if (isFuncDecl) {
      const methodMatch = eff.match(/^func\s+\(\s*(?:[A-Za-z_][A-Za-z0-9_]*)?\s*\*?\s*([A-Za-z_][A-Za-z0-9_]*)(?:\[[^\]]*\])?\s*\)\s+([A-Za-z_][A-Za-z0-9_]*)/);
      if (methodMatch) {
        name = methodMatch[2];
        search_names = [methodMatch[2], `${methodMatch[1]}.${methodMatch[2]}`];
      } else {
        const plainMatch = eff.match(/^func\s+([A-Za-z_][A-Za-z0-9_]*)/);
        if (!plainMatch) continue;
        name = plainMatch[1];
        search_names = [name];
      }
      kind = 'function';

    } else if (isTypeDecl) {
      const afterType = eff.slice('type'.length).trim();
      if (afterType.startsWith('(')) {
        const names = parseGroupedNames(lines, i);
        if (names.length === 0) continue;
        name = names[0];
        search_names = names;
        kind = 'type';
      } else {
        const m = afterType.match(/^([A-Za-z_][A-Za-z0-9_]*)/);
        if (!m) continue;
        name = m[1];
        search_names = [name];
        kind = classifyTypeKind(lines, i, afterType.slice(name.length).trimStart());
      }

    } else {
      const keyword = isConstDecl ? 'const' : 'var';
      const afterKeyword = eff.slice(keyword.length).trim();
      if (afterKeyword.startsWith('(')) {
        const names = parseGroupedNames(lines, i);
        if (names.length === 0) continue;
        name = names[0];
        search_names = names;
      } else {
        const names = extractNamesFromDecl(afterKeyword);
        if (names.length === 0) continue;
        name = names[0];
        search_names = names;
      }
      kind = 'variable';
    }

    const docStart = docCommentStart(lines, i);
    const end = spanEnd(lines, i);
    const sigMode: SignatureMode =
      isFuncDecl ? 'function' :
      (isTypeDecl && kind === 'class') ? 'type_body' :
      'logical_line';
    const sig = extractSignature(lines, i, end, sigMode);
    const finalKind: SourceDeclarationKind = isTestFile ? 'test' : kind;
    declarations.push({
      kind: finalKind, name, search_names,
      start: lines[docStart].start,
      end,
      signature: sig,
      exported: isTestFile ? false : isUppercase(name)
    });
  }

  // Exports: functions contribute only d.name (methods' search aliases excluded).
  // All other kinds contribute all search_names (correct for grouped decls).
  const exportNames: string[] = [];
  for (const d of declarations) {
    if (isTestFile || d.kind === 'test') continue;
    if (d.kind === 'function') {
      exportNames.push(d.name);
    } else {
      exportNames.push(...d.search_names);
    }
  }
  const exports = [...new Set(exportNames.filter(isUppercase))].sort();

  return {
    imports,
    exports,
    declarations: declarations.sort((a, b) => a.start - b.start || a.name.localeCompare(b.name))
  };
}

// ─── parser ──────────────────────────────────────────────────────────────────

const GO_EXTENSIONS = ['.go'] as const;

export const goParser: LanguageParser = {
  id: 'go',
  extensions: GO_EXTENSIONS,
  analyze: analyzeGo,
  resolveImport(
    _importer: string,
    specifier: string,
    { sourceFiles, goModulePath }: ImportResolutionContext
  ): ImportResolution {
    if (!goModulePath) return { status: 'external' };
    let pkgDir: string;
    if (specifier === goModulePath) {
      pkgDir = '';
    } else if (specifier.startsWith(goModulePath + '/')) {
      pkgDir = specifier.slice(goModulePath.length + 1);
    } else {
      return { status: 'external' };
    }
    const paths: string[] = [];
    for (const f of sourceFiles) {
      if (!f.endsWith('.go') || f.endsWith('_test.go')) continue;
      const dir = f.includes('/') ? f.slice(0, f.lastIndexOf('/')) : '';
      if (dir === pkgDir) paths.push(f);
    }
    paths.sort();
    return paths.length > 0 ? { status: 'resolved', paths } : { status: 'unresolved_local' };
  }
};
