import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLanguageRegistry } from '../bin/lib/language-registry.js';
import type { LanguageParser } from '../bin/lib/language-registry.js';

const stub = (id: string, extensions: string[]): LanguageParser => ({
  id, extensions,
  analyze: () => ({ imports: [], exports: [], declarations: [] }),
  resolveImport: () => ({ status: 'external' })
});

test('parserForFile matches by lowercased extension; null for unknown', () => {
  const r = createLanguageRegistry([stub('ts', ['.ts']), stub('py', ['.py', '.pyi'])]);
  assert.equal(r.parserForFile('a/b.TS')?.id, 'ts');
  assert.equal(r.parserForFile('a/b.pyi')?.id, 'py');
  assert.equal(r.parserForFile('a/b.md'), null);
});

test('allExtensions is the sorted union', () => {
  const r = createLanguageRegistry([stub('ts', ['.ts', '.tsx']), stub('py', ['.py'])]);
  assert.deepEqual(r.allExtensions(), ['.py', '.ts', '.tsx']);
});

test('rejects bad ids and extensions', () => {
  assert.throws(() => createLanguageRegistry([stub('', ['.a'])]), /parser id/);
  assert.throws(() => createLanguageRegistry([stub(' ts', ['.a'])]), /parser id/);
  assert.throws(() => createLanguageRegistry([stub('TS', ['.a'])]), /parser id/);
  assert.throws(() => createLanguageRegistry([stub('x', [])]), /at least one extension/);
  assert.throws(() => createLanguageRegistry([stub('x', ['ts'])]), /start with '\.'/);
  assert.throws(() => createLanguageRegistry([stub('x', ['.'])]), /name a suffix/);
  assert.throws(() => createLanguageRegistry([stub('x', ['.TS'])]), /lowercase/);
  assert.throws(() => createLanguageRegistry([stub('x', ['.a', '.a'])]), /twice/);
});

test('rejects duplicate id and duplicate extension across parsers', () => {
  assert.throws(() => createLanguageRegistry([stub('x', ['.a']), stub('x', ['.b'])]), /duplicate .*id/);
  assert.throws(() => createLanguageRegistry([stub('a', ['.ts']), stub('b', ['.ts'])]), /already registered/);
});

test('a failed register leaves the registry unmutated (atomic)', () => {
  const r = createLanguageRegistry([stub('a', ['.a'])]);
  assert.throws(() => r.register(stub('b', ['.b', '.a'])), /already registered/);
  assert.deepEqual(r.allExtensions(), ['.a']);       // .b was NOT added
  assert.equal(r.parserForFile('x.b'), null);
});

// --- Task 2: typescriptParser ---
import { typescriptParser } from '../bin/lib/source-analysis.js';

test('typescriptParser resolves relative specifiers with extension + index probing', () => {
  const files = new Set(['src/a.ts', 'src/util/index.ts']);
  assert.deepEqual(typescriptParser.resolveImport('src/entry.ts', './a', { sourceFiles: files }), { status: 'resolved', path: 'src/a.ts' });
  assert.deepEqual(typescriptParser.resolveImport('src/entry.ts', './util', { sourceFiles: files }), { status: 'resolved', path: 'src/util/index.ts' });
});

test('typescriptParser resolves a .js specifier to a .ts file', () => {
  const files = new Set(['src/a.ts']);
  assert.deepEqual(typescriptParser.resolveImport('src/entry.ts', './a.js', { sourceFiles: files }), { status: 'resolved', path: 'src/a.ts' });
});

test('typescriptParser classifies bare and missing specifiers', () => {
  assert.deepEqual(typescriptParser.resolveImport('src/entry.ts', 'react', { sourceFiles: new Set() }), { status: 'external' });
  assert.deepEqual(typescriptParser.resolveImport('src/entry.ts', './missing', { sourceFiles: new Set() }), { status: 'unresolved_local' });
});

test('typescriptParser never resolves a relative specifier to a .py file', () => {
  const files = new Set(['src/a.py']);
  assert.deepEqual(typescriptParser.resolveImport('src/entry.ts', './a', { sourceFiles: files }), { status: 'unresolved_local' });
});

// --- Task 4: pythonParser resolution ---
import { pythonParser } from '../bin/lib/python-analysis.js';

test('pythonParser resolves a named relative import to the sibling module only', () => {
  const withSibling = new Set(['pkg/sub/x.py', 'pkg/sub/__init__.py']);
  assert.deepEqual(pythonParser.resolveImport('pkg/sub/mod.py', '.x', { sourceFiles: withSibling }), { status: 'resolved', path: 'pkg/sub/x.py' });
  const initOnly = new Set(['pkg/sub/__init__.py']); // sibling missing → NOT the package init
  assert.deepEqual(pythonParser.resolveImport('pkg/sub/mod.py', '.missing', { sourceFiles: initOnly }), { status: 'unresolved_local' });
});

test('pythonParser resolves parent-relative and absolute-from-root', () => {
  assert.deepEqual(pythonParser.resolveImport('pkg/sub/mod.py', '..a', { sourceFiles: new Set(['pkg/a/__init__.py']) }), { status: 'resolved', path: 'pkg/a/__init__.py' });
  assert.deepEqual(pythonParser.resolveImport('app/views.py', 'app.models', { sourceFiles: new Set(['app/models.py']) }), { status: 'resolved', path: 'app/models.py' });
});

test('pythonParser resolves a pure-dot package import to its __init__ without a leading slash', () => {
  assert.deepEqual(pythonParser.resolveImport('mod.py', '.x', { sourceFiles: new Set(['x.py']) }), { status: 'resolved', path: 'x.py' });
  assert.deepEqual(pythonParser.resolveImport('mod.py', '.', { sourceFiles: new Set(['__init__.py']) }), { status: 'resolved', path: '__init__.py' });
  assert.deepEqual(pythonParser.resolveImport('pkg/mod.py', '.', { sourceFiles: new Set(['pkg/__init__.py']) }), { status: 'resolved', path: 'pkg/__init__.py' });
});

test('pythonParser classifies unresolved relative, external absolute, over-dot', () => {
  assert.deepEqual(pythonParser.resolveImport('app/views.py', '.missing', { sourceFiles: new Set() }), { status: 'unresolved_local' });
  assert.deepEqual(pythonParser.resolveImport('app/views.py', 'os', { sourceFiles: new Set() }), { status: 'external' });
  assert.deepEqual(pythonParser.resolveImport('a.py', '...x', { sourceFiles: new Set() }), { status: 'unresolved_local' });
});

// --- Task 5: production registry ---
import { parserForFile as prodParserForFile, allExtensions as prodAllExtensions } from '../bin/lib/language-registry.js';

test('production registry routes ts and py and unions both extension sets', () => {
  assert.equal(prodParserForFile('a/b.ts')?.id, 'typescript');
  assert.equal(prodParserForFile('a/b.py')?.id, 'python');
  assert.equal(prodParserForFile('a/b.pyi')?.id, 'python');
  assert.equal(prodParserForFile('a/b.md'), null);
  const extensions = prodAllExtensions();
  assert.ok(extensions.includes('.ts') && extensions.includes('.py') && extensions.includes('.pyi'));
  assert.deepEqual(extensions, [...extensions].sort());
});
