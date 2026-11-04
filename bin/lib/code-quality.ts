import fs from 'node:fs';
import path from 'node:path';
import { root, strict } from './context.js';
import { allExtensions, parserForFile } from './language-registry.js';
import { formatStatus, runCommand } from './utils.js';

const DEFAULT_MAX_COMPLEXITY = 10;
const DEFAULT_MAX_SIMILARITY = 0.8;
const MIN_DUPLICATE_TOKENS = 20;
const SHINGLE_SIZE = 3;

const IGNORED_DIRS = new Set(['.ai', '.git', 'node_modules', 'dist', 'build', 'coverage', 'templates', 'test', 'tests']);
const NON_METHOD_NAMES = new Set(['if', 'for', 'while', 'switch', 'catch']);
const STRUCTURAL_KEYWORDS = new Set([
  'if', 'else', 'for', 'of', 'in', 'while', 'do', 'switch', 'case', 'default',
  'return', 'continue', 'break', 'try', 'catch', 'finally', 'throw', 'new',
  'await', 'async', 'const', 'let', 'var', 'def', 'elif', 'except', 'match', 'pub', 'fn', 'func'
]);

export type FunctionQualityMetric = {
  path: string;
  name: string;
  start_line: number;
  end_line: number;
  complexity: number;
  coverage: number | null;
  crap_score: number | null;
};

export type DuplicateFunctionPair = {
  first: { path: string; name: string; start_line: number; end_line: number };
  second: { path: string; name: string; start_line: number; end_line: number };
  similarity: number;
};

export type CodeQualityReport = {
  checked_files: string[];
  functions_analyzed: number;
  complex_functions: FunctionQualityMetric[];
  duplicates: DuplicateFunctionPair[];
  passed: boolean;
};

export function stripCommentsAndStrings(source: string): string {
  return source.replace(
    /\/\/[^\r\n]*|\/\*[\s\S]*?\*\/|#[^\r\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\/(?![/*])(?:\\.|\[(?:\\.|[^\]\\])*\]|[^/\\\r\n])+\/[gimsuy]*/g,
    (match) => (match.startsWith('//') || match.startsWith('/*') || match.startsWith('#') ? ' ' : '""')
  );
}

export function computeCyclomaticComplexity(source: string): number {
  const sanitized = stripCommentsAndStrings(source);
  const matches = sanitized.match(/\b(?:if|for|while|case|catch|elif|except)\b|\?\?|\|\||&&|\?(?![.?:\w])/g);
  return 1 + (matches?.length ?? 0);
}

export function computeCrapScore(complexity: number, coverage = 1): number {
  const clamped = Math.max(0, Math.min(1, coverage));
  const raw = complexity ** 2 * (1 - clamped) ** 3 + complexity;
  return Math.round(raw * 100) / 100;
}

function normalizeLcovSourcePath(rawPath: string, repositoryRoot?: string): string {
  const trimmed = rawPath.trim().replace(/\\/g, '/');
  if (repositoryRoot) {
    const resolvedRoot = path.resolve(repositoryRoot).replace(/\\/g, '/');
    const resolvedFile = path.resolve(repositoryRoot, trimmed).replace(/\\/g, '/');
    if (resolvedFile.startsWith(`${resolvedRoot}/`)) {
      return resolvedFile.slice(resolvedRoot.length + 1);
    }
  }
  return trimmed.replace(/^\.\//, '');
}

export function parseLcovCoverage(lcovText: string, repositoryRoot?: string): Map<string, Map<number, number>> {
  const byFile = new Map<string, Map<number, number>>();
  let currentFile: string | null = null;
  for (const rawLine of lcovText.split(/\r?\n/)) {
    if (rawLine.startsWith('SF:')) {
      currentFile = normalizeLcovSourcePath(rawLine.slice(3), repositoryRoot);
      if (!byFile.has(currentFile)) byFile.set(currentFile, new Map());
    } else if (rawLine.startsWith('DA:') && currentFile) {
      const [lineStr, hitsStr] = rawLine.slice(3).split(',');
      byFile.get(currentFile)!.set(Number(lineStr), Number(hitsStr));
    }
  }
  return byFile;
}

function loadLcovCoverage(repositoryRoot: string): Map<string, Map<number, number>> | null {
  const lcovPath = path.join(repositoryRoot, 'coverage', 'lcov.info');
  if (!fs.existsSync(lcovPath)) return null;
  return parseLcovCoverage(fs.readFileSync(lcovPath, 'utf8'), repositoryRoot);
}

function resolveFileCoverage(
  lcov: Map<string, Map<number, number>> | null,
  relativeFile: string
): Map<number, number> | undefined {
  if (!lcov) return undefined;
  const direct = lcov.get(relativeFile);
  if (direct) return direct;
  const suffix = `/${relativeFile}`;
  const matches = [...lcov.entries()].filter(([key]) => key.endsWith(suffix));
  return matches.length === 1 ? matches[0][1] : undefined;
}

function coverageForSpan(
  lcov: Map<string, Map<number, number>> | null,
  relativeFile: string,
  startLine: number,
  endLine: number
): number | null {
  const fileCoverage = resolveFileCoverage(lcov, relativeFile);
  if (!fileCoverage) return null;
  let total = 0;
  let covered = 0;
  for (const [line, hits] of fileCoverage.entries()) {
    if (line >= startLine && line <= endLine) {
      total += 1;
      if (hits > 0) covered += 1;
    }
  }
  return total === 0 ? null : Math.round((covered / total) * 100) / 100;
}

function extractBodySlice(source: string): string {
  const openBrace = source.indexOf('{');
  const closeBrace = source.lastIndexOf('}');
  if (openBrace !== -1 && closeBrace > openBrace) {
    return source.slice(openBrace + 1, closeBrace);
  }
  const firstNewline = source.indexOf('\n');
  return firstNewline === -1 ? source : source.slice(firstNewline + 1);
}

function normalizeToken(token: string): string {
  if (/^\d/.test(token)) return '$NUM';
  if (token === '""') return '$STR';
  if (/^[A-Za-z_$]/.test(token)) return STRUCTURAL_KEYWORDS.has(token) ? token : '$ID';
  return token;
}

function structuralTokens(source: string): string[] {
  const body = stripCommentsAndStrings(extractBodySlice(source))
    .replace(/:\s*[A-Za-z_$][\w.<>\[\]|&\s,{}?]*(?=[)=;])/g, '');
  const raw = body.match(/""|\d+(?:\.\d+)?|[A-Za-z_$][\w$]*|===|!==|==|!=|<=|>=|=>|\?\?|\|\||&&|[+\-*/%<>!?().[\]{}]/g) ?? [];
  return raw.map(normalizeToken);
}

function shingleMultiset(tokens: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (let index = 0; index <= tokens.length - SHINGLE_SIZE; index += 1) {
    const shingle = tokens.slice(index, index + SHINGLE_SIZE).join(' ');
    counts.set(shingle, (counts.get(shingle) ?? 0) + 1);
  }
  return counts;
}

export function computeStructuralSimilarity(firstSource: string, secondSource: string): number {
  const firstTokens = structuralTokens(firstSource);
  const secondTokens = structuralTokens(secondSource);
  if (firstTokens.length < SHINGLE_SIZE || secondTokens.length < SHINGLE_SIZE) return 0;

  const firstShingles = shingleMultiset(firstTokens);
  const secondShingles = shingleMultiset(secondTokens);
  const total = firstTokens.length - SHINGLE_SIZE + 1 + (secondTokens.length - SHINGLE_SIZE + 1);
  let overlap = 0;
  for (const [shingle, count] of firstShingles.entries()) {
    overlap += Math.min(count, secondShingles.get(shingle) ?? 0);
  }
  return Math.round(((2 * overlap) / total) * 100) / 100;
}

function lineNumberAt(content: string, offset: number): number {
  let line = 1;
  for (let index = 0; index < offset && index < content.length; index += 1) {
    if (content.charCodeAt(index) === 10) line += 1;
  }
  return line;
}

function findMatchingDelimiter(sanitized: string, openIndex: number, openChar: string, closeChar: string): number {
  let depth = 0;
  for (let index = openIndex; index < sanitized.length; index += 1) {
    if (sanitized[index] === openChar) depth += 1;
    else if (sanitized[index] === closeChar) {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
  }
  return -1;
}

function extractClassMethodSpans(
  content: string,
  className: string,
  classStart: number,
  classEnd: number
): Array<{ name: string; start: number; end: number }> {
  const classSlice = content.slice(classStart, classEnd);
  const sanitized = stripCommentsAndStrings(classSlice);
  const pattern = /\n\s*(?:(?:public|private|protected|static|async|override|readonly|get|set)\s+)*([A-Za-z_$][\w$]*)\s*\(/g;
  const methods: Array<{ name: string; start: number; end: number }> = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(sanitized)) !== null) {
    const methodName = match[1];
    if (NON_METHOD_NAMES.has(methodName)) continue;
    const closeParenEnd = findMatchingDelimiter(sanitized, match.index + match[0].length - 1, '(', ')');
    const openBraceOffset = closeParenEnd === -1 ? -1 : sanitized.indexOf('{', closeParenEnd);
    if (openBraceOffset === -1 || sanitized.slice(closeParenEnd, openBraceOffset).includes(';')) continue;
    const endOffset = findMatchingDelimiter(sanitized, openBraceOffset, '{', '}');
    if (endOffset === -1) continue;
    const startOffset = match.index + match[0].search(/\S/);
    methods.push({ name: `${className}.${methodName}`, start: classStart + startOffset, end: classStart + endOffset });
    pattern.lastIndex = endOffset;
  }
  return methods;
}

type AnalyzedFunction = FunctionQualityMetric & {
  source: string;
  tokenCount: number;
};

function buildAnalyzedFunction(
  content: string,
  relativeFile: string,
  name: string,
  start: number,
  end: number,
  lcov: Map<string, Map<number, number>> | null
): AnalyzedFunction {
  const slice = content.slice(start, end);
  const startLine = lineNumberAt(content, start);
  const endLine = lineNumberAt(content, end);
  const complexity = computeCyclomaticComplexity(slice);
  const coverage = coverageForSpan(lcov, relativeFile, startLine, endLine);
  return {
    path: relativeFile,
    name,
    start_line: startLine,
    end_line: endLine,
    complexity,
    coverage,
    crap_score: coverage === null ? null : computeCrapScore(complexity, coverage),
    source: slice,
    tokenCount: structuralTokens(slice).length
  };
}

function extractFunctionsFromFile(
  repositoryRoot: string,
  relativeFile: string,
  lcov: Map<string, Map<number, number>> | null
): AnalyzedFunction[] {
  const parser = parserForFile(relativeFile);
  const fullPath = path.join(repositoryRoot, relativeFile);
  if (!parser || !fs.existsSync(fullPath)) return [];
  const content = fs.readFileSync(fullPath, 'utf8');
  const analysis = parser.analyze(content, relativeFile);
  const out: AnalyzedFunction[] = [];

  for (const decl of analysis.declarations) {
    if (decl.kind === 'function') {
      out.push(buildAnalyzedFunction(content, relativeFile, decl.name, decl.start, decl.end, lcov));
    } else if (decl.kind === 'class') {
      for (const method of extractClassMethodSpans(content, decl.name, decl.start, decl.end)) {
        out.push(buildAnalyzedFunction(content, relativeFile, method.name, method.start, method.end, lcov));
      }
    }
  }
  return out;
}

function toSummaryRef(fn: AnalyzedFunction) {
  return { path: fn.path, name: fn.name, start_line: fn.start_line, end_line: fn.end_line };
}

function findDuplicatePairs(
  targetFunctions: AnalyzedFunction[],
  baselineFunctions: AnalyzedFunction[],
  maxSimilarity: number
): DuplicateFunctionPair[] {
  const eligibleTargets = targetFunctions.filter((fn) => fn.tokenCount >= MIN_DUPLICATE_TOKENS);
  const eligibleBaseline = baselineFunctions.filter((fn) => fn.tokenCount >= MIN_DUPLICATE_TOKENS);
  const duplicates: DuplicateFunctionPair[] = [];

  for (let i = 0; i < eligibleTargets.length; i += 1) {
    const first = eligibleTargets[i];
    const peers = [...eligibleTargets.slice(i + 1), ...eligibleBaseline];
    for (const second of peers) {
      const similarity = computeStructuralSimilarity(first.source, second.source);
      if (similarity >= maxSimilarity) {
        duplicates.push({ first: toSummaryRef(first), second: toSummaryRef(second), similarity });
      }
    }
  }
  return duplicates;
}

function isSupportedSourceFile(relativeFile: string, supportedExtensions: Set<string>): boolean {
  const normalized = relativeFile.split(path.sep).join('/');
  const segments = normalized.split('/');
  if (segments.some((segment) => IGNORED_DIRS.has(segment))) return false;
  if (/\.(?:test|spec)\.[A-Za-z0-9]+$/.test(normalized)) return false;
  return supportedExtensions.has(path.extname(normalized).toLowerCase());
}

function walkSourceFiles(dir: string, repositoryRoot: string, extensions: Set<string>, out: string[]): void {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (IGNORED_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkSourceFiles(full, repositoryRoot, extensions, out);
    } else if (entry.isFile()) {
      const rel = path.relative(repositoryRoot, full).split(path.sep).join('/');
      if (isSupportedSourceFile(rel, extensions)) out.push(rel);
    }
  }
}

export function analyzeFilesQuality(
  repositoryRoot: string,
  files: string[],
  options: { maxComplexity?: number; maxSimilarity?: number; compareAgainstRepo?: boolean } = {}
): CodeQualityReport {
  const maxComplexity = options.maxComplexity ?? DEFAULT_MAX_COMPLEXITY;
  const maxSimilarity = options.maxSimilarity ?? DEFAULT_MAX_SIMILARITY;
  const sortedFiles = [...new Set(files)].sort();
  const targetSet = new Set(sortedFiles);
  const lcov = loadLcovCoverage(repositoryRoot);
  const targetFunctions = sortedFiles.flatMap((file) => extractFunctionsFromFile(repositoryRoot, file, lcov));

  const repoFiles: string[] = [];
  if (options.compareAgainstRepo !== false) {
    walkSourceFiles(repositoryRoot, repositoryRoot, new Set(allExtensions()), repoFiles);
  }
  const baselineFunctions = repoFiles
    .filter((file) => !targetSet.has(file))
    .sort()
    .flatMap((file) => extractFunctionsFromFile(repositoryRoot, file, lcov));

  const complexFunctions = targetFunctions
    .filter((fn) => fn.complexity >= maxComplexity || (fn.crap_score !== null && fn.crap_score >= maxComplexity))
    .map(({ source: _s, tokenCount: _t, ...metric }) => metric);
  const duplicates = findDuplicatePairs(targetFunctions, baselineFunctions, maxSimilarity);

  return {
    checked_files: sortedFiles,
    functions_analyzed: targetFunctions.length,
    complex_functions: complexFunctions,
    duplicates,
    passed: complexFunctions.length === 0 && duplicates.length === 0
  };
}

export function discoverTargetQualityFiles(repositoryRoot: string, strictMode = false): string[] {
  const extensions = new Set(allExtensions());
  if (!strictMode) {
    const rev = runCommand('git', ['rev-parse', '--verify', 'HEAD'], repositoryRoot);
    const status = runCommand('git', ['status', '--porcelain=v1'], repositoryRoot);
    if (rev.status === 0 && status.status === 0) {
      return status.stdout
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => line.slice(3).split(' -> ').at(-1)!.trim())
        .filter((file) => isSupportedSourceFile(file, extensions) && fs.existsSync(path.join(repositoryRoot, file)));
    }
  }
  const files: string[] = [];
  walkSourceFiles(repositoryRoot, repositoryRoot, extensions, files);
  return files.sort();
}

export function runCheckQuality(options: { strict?: boolean } = { strict }): void {
  console.log('ForgeAI code quality check');
  console.log('');

  const files = discoverTargetQualityFiles(root, Boolean(options.strict));
  const report = analyzeFilesQuality(root, files);

  if (report.checked_files.length === 0) {
    console.log(formatStatus('ok', 'no modified source files to inspect (pass --strict to scan all source files)'));
    console.log('');
    console.log('Result: code quality gate satisfied.');
    return;
  }

  for (const fn of report.complex_functions) {
    const crapSuffix = fn.crap_score !== null ? `, CRAP ${fn.crap_score}` : '';
    console.log(
      formatStatus('invalid', `${fn.path}:${fn.start_line}-${fn.end_line} function "${fn.name}" has complexity ${fn.complexity}${crapSuffix} (must be < ${DEFAULT_MAX_COMPLEXITY})`)
    );
  }

  for (const dup of report.duplicates) {
    console.log(
      formatStatus(
        'invalid',
        `${dup.first.path}:${dup.first.start_line} "${dup.first.name}" and ${dup.second.path}:${dup.second.start_line} "${dup.second.name}" have structural similarity ${dup.similarity} (must be < ${DEFAULT_MAX_SIMILARITY})`
      )
    );
  }

  if (report.passed) {
    console.log(formatStatus('ok', `${report.functions_analyzed} functions across ${report.checked_files.length} file(s) satisfy complexity (< ${DEFAULT_MAX_COMPLEXITY}) and duplication (< ${DEFAULT_MAX_SIMILARITY}) gates`));
    console.log('');
    console.log('Result: code quality gate satisfied.');
    return;
  }

  console.log('');
  console.log('Result: code quality gate failed. Split complex functions (< 10) and eliminate structural duplication (< 0.8).');
  process.exitCode = 1;
}
