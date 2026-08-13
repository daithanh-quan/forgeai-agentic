import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeGo, goParser } from '../bin/lib/go-analysis.js';

// ─── declarations ─────────────────────────────────────────────────────────────

test('top-level func only; nested func (inside braces) ignored', () => {
  const src = 'func Outer() {\n  var inner = func() {}\n}\n';
  const decls = analyzeGo(src, 'a.go').declarations;
  assert.deepEqual(decls.map((d) => d.name), ['Outer']);
});

test('func: kind=function, exported by uppercase', () => {
  const src = 'func ListUsers() {}\nfunc internal() {}\n';
  const decls = analyzeGo(src, 'a.go').declarations;
  assert.equal(decls.find((d) => d.name === 'ListUsers')!.kind, 'function');
  assert.equal(decls.find((d) => d.name === 'ListUsers')!.exported, true);
  assert.equal(decls.find((d) => d.name === 'internal')!.exported, false);
});

test('method with pointer receiver: name=Method, search_names=[Method, T.Method]', () => {
  const src = 'func (r *Repo) Save(item int) error {\n  return nil\n}\n';
  const decl = analyzeGo(src, 'a.go').declarations[0];
  assert.equal(decl.name, 'Save');
  assert.deepEqual(decl.search_names, ['Save', 'Repo.Save']);
  assert.equal(decl.exported, true);
});

test('method with value receiver: same search_names shape', () => {
  const src = 'func (s Store) get() int {\n  return 0\n}\n';
  const decl = analyzeGo(src, 'a.go').declarations[0];
  assert.equal(decl.name, 'get');
  assert.deepEqual(decl.search_names, ['get', 'Store.get']);
  assert.equal(decl.exported, false);
});

test('method is NOT in exports if receiver type is uppercase but method is lowercase', () => {
  const src = 'func (r *Repo) internal() {}\n';
  assert.deepEqual(analyzeGo(src, 'a.go').exports, []);
});

test('type struct → kind=class; type interface → kind=class; type alias → kind=type', () => {
  const src = 'type User struct {\n  ID int\n}\ntype Reader interface {\n  Read() error\n}\ntype ID = int\n';
  const decls = analyzeGo(src, 'a.go').declarations;
  assert.equal(decls.find((d) => d.name === 'User')!.kind, 'class');
  assert.equal(decls.find((d) => d.name === 'Reader')!.kind, 'class');
  assert.equal(decls.find((d) => d.name === 'ID')!.kind, 'type');
});

test('single const and var: kind=variable', () => {
  const src = 'const Pi = 3.14\nvar Count int\n';
  const decls = analyzeGo(src, 'a.go').declarations;
  assert.equal(decls.find((d) => d.name === 'Pi')!.kind, 'variable');
  assert.equal(decls.find((d) => d.name === 'Count')!.kind, 'variable');
});

test('const A, B = 1, 2: both names in search_names (multi-name inline decl)', () => {
  // Regression: extractNamesFromDecl must split LHS by comma before =
  const src = 'const A, B = 1, 2\n';
  assert.deepEqual(analyzeGo(src, 'a.go').declarations[0].search_names, ['A', 'B']);
});

test('var X, Y int: both names in search_names (multi-name inline decl)', () => {
  // Regression: extractNamesFromDecl must split LHS by comma before type
  const src = 'var X, Y int\n';
  assert.deepEqual(analyzeGo(src, 'a.go').declarations[0].search_names, ['X', 'Y']);
});

test('grouped const: one span, all names in search_names, per-name export', () => {
  const src = 'const (\n  Alpha = 1\n  beta = 2\n  Gamma = 3\n)\n';
  const decls = analyzeGo(src, 'a.go').declarations;
  assert.equal(decls.length, 1);
  assert.equal(decls[0].name, 'Alpha');
  assert.deepEqual(decls[0].search_names, ['Alpha', 'beta', 'Gamma']);
  assert.deepEqual(analyzeGo(src, 'a.go').exports, ['Alpha', 'Gamma']);
});

test('grouped const: scanner does not absorb identifiers past the closing )', () => {
  const src = 'const (\n  A = 1\n)\nfunc Leak() {}\n';
  const decls = analyzeGo(src, 'a.go').declarations;
  const grouped = decls.find((d) => d.kind === 'variable')!;
  assert.deepEqual(grouped.search_names, ['A']);
  assert.ok(decls.some((d) => d.name === 'Leak'), 'Leak is a separate declaration');
});

test('grouped var: one span, all names', () => {
  const src = 'var (\n  X int\n  Y string\n)\n';
  const decl = analyzeGo(src, 'a.go').declarations[0];
  assert.deepEqual(decl.search_names, ['X', 'Y']);
});

test('grouped type: one span, all names', () => {
  const src = 'type (\n  Foo struct{}\n  Bar interface{}\n)\n';
  const decl = analyzeGo(src, 'a.go').declarations[0];
  assert.deepEqual(decl.search_names, ['Foo', 'Bar']);
  assert.deepEqual(analyzeGo(src, 'a.go').exports, ['Bar', 'Foo']);
});

test('grouped const with nested call: inner ) does not terminate the group early', () => {
  // Regression: parseGroupedNames must check parenDepthBefore; the ) of fn(...) is nested
  const src = 'const (\n\tA = fn(\n\t\t1,\n\t)\n\tB = 2\n)\n';
  const decl = analyzeGo(src, 'a.go').declarations[0];
  assert.deepEqual(decl.search_names, ['A', 'B'], 'B must not be lost when nested ) appears first');
});

test('grouped type with interface body: inner method not included in group names', () => {
  // Regression: parseGroupedNames must filter out lines inside interface body (braceDepthBefore>0)
  const src = 'type (\n\tService interface {\n\t\tRun()\n\t}\n\tConfig struct{}\n)\n';
  const decl = analyzeGo(src, 'a.go').declarations[0];
  assert.deepEqual(decl.search_names, ['Service', 'Config']);
  assert.ok(!decl.search_names.includes('Run'), 'Run is a method signature, not a group member');
});

// ─── doc-comment inclusion ───────────────────────────────────────────────────

test('contiguous // block immediately above decl: start at comment, signature at keyword', () => {
  const src = '// ListUsers returns users.\n// It never returns nil.\nfunc ListUsers(\n\tctx interface{},\n\tlimit int,\n) ([]interface{}, error) {\n\treturn nil, nil\n}\n';
  const decl = analyzeGo(src, 'a.go').declarations[0];
  const slice = src.slice(decl.start, decl.end);
  assert.ok(slice.startsWith('// ListUsers'), 'span starts at doc comment');
  assert.ok(slice.includes('return nil, nil'), 'full body included');
  assert.ok(decl.signature, 'signature is non-null');
  assert.ok(decl.signature.startsWith('func ListUsers'), 'signature starts at keyword, not comment');
});

test('blank line between comment and decl: comment excluded from span', () => {
  const src = '// orphaned\n\nfunc Alone() {}\n';
  const decl = analyzeGo(src, 'a.go').declarations[0];
  const slice = src.slice(decl.start, decl.end);
  assert.ok(!slice.includes('orphaned'), 'blank line breaks doc-comment attachment');
});

test('/* */ block comment immediately above decl: included in span', () => {
  const src = '/* Block doc */\nfunc Documented() {}\n';
  const decl = analyzeGo(src, 'a.go').declarations[0];
  const slice = src.slice(decl.start, decl.end);
  assert.ok(slice.includes('Block doc'));
});

test('multi-line /* */ doc block: entire block included in span', () => {
  // Regression: docCommentStart only checked if immediately-preceding line started with /*;
  // the line above the declaration is `*/`, so the block was not attached.
  const src = '/*\n * Block doc\n */\nfunc F() {}\n';
  const decl = analyzeGo(src, 'a.go').declarations[0];
  const slice = src.slice(decl.start, decl.end);
  assert.ok(slice.includes('Block doc'), 'multi-line block comment content included in span');
  assert.ok(decl.signature, 'signature is non-null');
  assert.ok(decl.signature.startsWith('func F'), 'signature starts at keyword, not block comment');
});

// ─── spans ───────────────────────────────────────────────────────────────────

test('multi-line func parameter list: span covers full body, not just header', () => {
  const src = 'func First(\n  a int,\n  b int,\n) int {\n  return a + b\n}\n\nfunc Second() {}\n';
  const first = analyzeGo(src, 'a.go').declarations.find((d) => d.name === 'First')!;
  const slice = src.slice(first.start, first.end);
  assert.ok(slice.includes('return a + b'), 'body included');
  assert.ok(!slice.includes('Second'), 'stops before Second');
});

test('span trailing blank lines trimmed', () => {
  const src = 'func First() {\n  return\n}\n\n\nfunc Second() {}\n';
  const first = analyzeGo(src, 'a.go').declarations.find((d) => d.name === 'First')!;
  const slice = src.slice(first.start, first.end);
  assert.ok(!slice.endsWith('\n\n'), 'trailing blanks trimmed');
});

test('span of A does not include the doc comment of B', () => {
  // Regression: spanEnd must stop at comment lines (empty effective but raw.startsWith('//'))
  const src = 'func A() {}\n// B doc\nfunc B() {}\n';
  const a = analyzeGo(src, 'a.go').declarations.find((d) => d.name === 'A')!;
  const b = analyzeGo(src, 'a.go').declarations.find((d) => d.name === 'B')!;
  assert.ok(a.end < b.start, `A.end=${a.end} must be < B.start=${b.start}; spans do not overlap`);
  assert.ok(!src.slice(a.start, a.end).includes('B doc'), "A's span must not contain B's doc comment");
});

test('last declaration in file: span runs to EOF', () => {
  const src = 'func Only() {\n  return\n}\n';
  const decl = analyzeGo(src, 'a.go').declarations[0];
  assert.equal(decl.end, src.length); // empty trailing line: start + text.length = src.length
});

// ─── signature ───────────────────────────────────────────────────────────────

test('multi-line signature captured through opening brace (worked example from spec)', () => {
  const src = '// ListUsers returns the first `limit` users.\n// It never returns nil.\nfunc ListUsers(\n\tctx interface{},\n\tlimit int,\n) ([]interface{}, error) {\n\treturn nil, nil\n}\n';
  const decl = analyzeGo(src, 'a.go').declarations[0];
  assert.ok(decl.signature, 'signature is non-null');
  assert.ok(decl.signature.startsWith('func ListUsers('), 'starts at func');
  assert.ok(decl.signature.includes('limit int,'), 'multi-line params captured');
  assert.ok(decl.signature.endsWith('{'), 'ends at opening brace');
  assert.ok(!decl.signature.includes('ListUsers returns'), 'doc comment excluded from signature');
});

test('brace-less declaration signature uses the effective declaration line', () => {
  const src = 'const Pi = 3.14\n';
  const decl = analyzeGo(src, 'a.go').declarations[0];
  assert.ok(decl.signature, 'signature is non-null');
  assert.ok(decl.signature.includes('Pi'));
  assert.ok(!decl.signature.endsWith('{'));
});

test('var with composite literal: full declaration is the signature, not truncated at {', () => {
  // Regression: logical_line mode must not stop at the { in Config{Enabled: true}.
  const src = 'var Default = Config{Enabled: true}\n';
  const decl = analyzeGo(src, 'a.go').declarations[0];
  assert.equal(decl.signature, 'var Default = Config{Enabled: true}');
});

test('signature: empty function body {} is the body opener, not an inline type', () => {
  // Regression: the empty-brace peek-ahead must only fire after struct/interface, not always.
  const src = 'func F() {}\n';
  assert.equal(analyzeGo(src, 'a.go').declarations[0].signature, 'func F() {');
});

test('type Config struct{}: signature ends at opening brace (type_body mode)', () => {
  // Regression: type_body mode treats any { at depth 0 as the body opener.
  const src = 'type Config struct{}\n';
  assert.equal(analyzeGo(src, 'a.go').declarations[0].signature, 'type Config struct{');
});

test('type Reader interface{ Read() error }: signature ends at opening brace', () => {
  const src = 'type Reader interface{ Read() error }\n';
  assert.equal(analyzeGo(src, 'a.go').declarations[0].signature, 'type Reader interface{');
});

test('signature: interface{} in return type captured, not mistaken for body brace', () => {
  // Regression: extractSignature must peek ahead and treat `{}` inline as non-body
  const src = 'func New() interface{} {\n  return nil\n}\n';
  const decl = analyzeGo(src, 'a.go').declarations[0];
  assert.ok(decl.signature, 'signature is non-null');
  assert.ok(decl.signature.includes('interface{}'), `signature must contain interface{}`);
  assert.ok(decl.signature.endsWith('{'), 'body-opener { at end');
});

test('signature: struct{ V int } in return type fully captured, body-opener { last', () => {
  // Regression: empty-brace peek-ahead only handled struct{} (empty). Non-empty struct{ fields }
  // requires the "last token is struct/interface" depth-tracking path.
  const src = 'func Config() struct{ V int } {\n  return struct{ V int }{}\n}\n';
  const decl = analyzeGo(src, 'a.go').declarations[0];
  assert.equal(decl.signature, 'func Config() struct{ V int } {');
});

// ─── exports ─────────────────────────────────────────────────────────────────

test('exports: only declared identifier, not search alias — method Repo.Save exports Save only', () => {
  const src = 'func (r *Repo) Save() {}\n';
  assert.deepEqual(analyzeGo(src, 'a.go').exports, ['Save']);
  assert.ok(!analyzeGo(src, 'a.go').exports.includes('Repo.Save'), 'Repo.Save is a search alias, not an export');
});

test('exports: sorted, de-duped uppercase names; lowercase excluded', () => {
  const src = 'func Alpha() {}\nfunc beta() {}\nfunc Gamma() {}\n';
  assert.deepEqual(analyzeGo(src, 'a.go').exports, ['Alpha', 'Gamma']);
});

// ─── test files ──────────────────────────────────────────────────────────────

test('_test.go: ALL top-level kinds get kind=test (not just func), no exports', () => {
  // Spec: "its top-level declarations are emitted with kind: 'test'" — applies to type/var/const too
  const src = 'func TestFoo(t interface{}) {}\ntype HelperType struct{}\nvar helperCount int\n';
  const analysis = analyzeGo(src, 'foo_test.go');
  assert.ok(analysis.declarations.length >= 3, 'all three declarations present');
  assert.ok(analysis.declarations.every((d) => d.kind === 'test'), 'type and var also get kind=test');
  assert.deepEqual(analysis.exports, []);
  assert.ok(analysis.declarations.every((d) => !d.exported));
});

// ─── comment/string safety ───────────────────────────────────────────────────

test('func keyword inside // comment is ignored', () => {
  const src = '// func NotADecl() {}\nfunc Real() {}\n';
  assert.deepEqual(analyzeGo(src, 'a.go').declarations.map((d) => d.name), ['Real']);
});

test('func keyword inside /* */ block comment is ignored', () => {
  const src = '/* func NotADecl() {} */\nfunc Real() {}\n';
  assert.deepEqual(analyzeGo(src, 'a.go').declarations.map((d) => d.name), ['Real']);
});

test('func keyword inside interpreted string literal is ignored', () => {
  const src = 'var s = "func NotADecl() {}"\nfunc Real() {}\n';
  const decls = analyzeGo(src, 'a.go').declarations;
  assert.ok(decls.some((d) => d.name === 'Real'));
  assert.ok(!decls.some((d) => d.name === 'NotADecl'));
});

test('func keyword inside multi-line raw backtick string is ignored', () => {
  const src = 'var tmpl = `\nfunc NotADecl() {}\n`\nfunc Real() {}\n';
  const decls = analyzeGo(src, 'a.go').declarations;
  assert.ok(decls.some((d) => d.name === 'Real'));
  assert.ok(!decls.some((d) => d.name === 'NotADecl'));
});

test('malformed source stays deterministic and all offsets in bounds', () => {
  const src = 'func Broken(\nfunc Valid() {}\n';
  assert.doesNotThrow(() => analyzeGo(src, 'a.go'));
  const decls = analyzeGo(src, 'a.go').declarations;
  for (const d of decls) {
    assert.ok(d.start >= 0 && d.start <= src.length);
    assert.ok(d.end >= d.start && d.end <= src.length);
  }
});

// ─── import grammar ──────────────────────────────────────────────────────────

test('single import "fmt"', () => {
  const src = 'import "fmt"\nfunc f() {}\n';
  const imports = analyzeGo(src, 'a.go').imports;
  assert.equal(imports.length, 1);
  assert.equal(imports[0].specifier, 'fmt');
  assert.equal(imports[0].kind, 'static_import');
});

test('grouped import block: two paths extracted from raw text', () => {
  const src = 'import (\n\t"fmt"\n\t"net/http"\n)\nfunc f() {}\n';
  const imports = analyzeGo(src, 'a.go').imports;
  assert.equal(imports.length, 2);
  assert.deepEqual(imports.map((i) => i.specifier).sort(), ['fmt', 'net/http']);
});

test('aliased import: specifier is the path, alias stripped', () => {
  const src = 'import f "mymod/foo"\nfunc g() {}\n';
  assert.equal(analyzeGo(src, 'a.go').imports[0].specifier, 'mymod/foo');
});

test('dot import: specifier is the path', () => {
  const src = 'import . "mymod/foo"\nfunc g() {}\n';
  assert.equal(analyzeGo(src, 'a.go').imports[0].specifier, 'mymod/foo');
});

test('blank import: specifier is the path', () => {
  const src = 'import _ "mymod/foo"\nfunc g() {}\n';
  assert.equal(analyzeGo(src, 'a.go').imports[0].specifier, 'mymod/foo');
});

test('grouped import: // comment lines do not produce fake imports', () => {
  // Regression: raw line.text was matched directly; `// "fake/module"` would register as import.
  const src = 'import (\n\t"fmt"\n\t// "fake/module"\n)\nfunc f() {}\n';
  const imports = analyzeGo(src, 'a.go').imports;
  assert.equal(imports.length, 1, `expected 1 import, got ${imports.length}: ${imports.map((i) => i.specifier).join(', ')}`);
  assert.equal(imports[0].specifier, 'fmt');
});

test('grouped import: multi-line /* */ block comment does not produce fake imports', () => {
  // Regression: inBlockCommentBefore covers lines inside a /* */ block.
  const src = 'import (\n\t/*\n\t"fake/module"\n\t*/\n\t"fmt"\n)\nfunc f() {}\n';
  const imports = analyzeGo(src, 'a.go').imports;
  assert.equal(imports.length, 1, `expected 1 import, got ${imports.length}: ${imports.map((i) => i.specifier).join(', ')}`);
  assert.equal(imports[0].specifier, 'fmt');
});

test('grouped import: /* opens on same line as fake string — opening line masked correctly', () => {
  // The line `/* "fake/module"` has inBlockCommentBefore=false; maskComments must handle the
  // opening /* on the same line (not rely on inBlockCommentBefore alone).
  const src = 'import (\n\t/* "fake/module"\n\t*/\n\t"fmt"\n)\nfunc f() {}\n';
  const imports = analyzeGo(src, 'a.go').imports;
  assert.equal(imports.length, 1, `expected 1 import, got ${imports.length}: ${imports.map((i) => i.specifier).join(', ')}`);
  assert.equal(imports[0].specifier, 'fmt');
});

test('single import: inline /* */ comment does not produce fake import', () => {
  // Regression: single import handler also used raw line.text; `import /* "x" */ "fmt"` grabbed "x".
  const src = 'import /* "fake" */ "fmt"\nfunc f() {}\n';
  const imports = analyzeGo(src, 'a.go').imports;
  assert.equal(imports.length, 1, `expected 1 import, got ${imports.length}`);
  assert.equal(imports[0].specifier, 'fmt');
});

// ─── generics ────────────────────────────────────────────────────────────────

test('generic type: kind=class, name=Cache, signature ends at opening brace', () => {
  // Regression: type Cache[K comparable] struct{} — rest starts with '[K' not 'struct',
  // so the parser must skip the type-parameter list before checking struct/interface.
  const src = 'type Cache[K comparable] struct{}\n';
  const decl = analyzeGo(src, 'a.go').declarations[0];
  assert.equal(decl.kind, 'class');
  assert.equal(decl.name, 'Cache');
  assert.ok(decl.signature, 'signature is non-null');
  assert.equal(decl.signature, 'type Cache[K comparable] struct{');
});

test('generic type with two type params: kind=class', () => {
  const src = 'type Pair[K comparable, V any] struct{ Key K; Val V }\n';
  const decl = analyzeGo(src, 'a.go').declarations[0];
  assert.equal(decl.kind, 'class');
  assert.equal(decl.name, 'Pair');
});

test('generic method with pointer receiver *Cache[K]: name=Get, search_names=[Get, Cache.Get]', () => {
  // Regression: method regex failed on *Cache[K] because [K] appeared before ')'.
  const src = 'func (c *Cache[K]) Get(key K) {}\n';
  const decl = analyzeGo(src, 'a.go').declarations[0];
  assert.equal(decl.name, 'Get');
  assert.deepEqual(decl.search_names, ['Get', 'Cache.Get']);
});

test('generic type with interface constraint: { inside constraint not mistaken for body opener', () => {
  // Regression: extractSignature checked braceDepth===0 && parenDepth===0 but not bracketDepth===0.
  const src = 'type Ordered[T interface{comparable}] struct{ Value T }\n';
  const decl = analyzeGo(src, 'a.go').declarations[0];
  assert.equal(decl.kind, 'class');
  assert.equal(decl.name, 'Ordered');
  assert.ok(decl.signature, 'signature is non-null');
  assert.ok(decl.signature.endsWith('{'), 'ends at the struct body opener, not constraint {');
  assert.ok(decl.signature.includes('interface{comparable}'), 'constraint is part of signature');
});

test('generic type with nested-bracket constraint ~[16]byte: kind=class', () => {
  // Regression: indexOf(']') found the ] inside [16]byte instead of the type-param list closer.
  const src = 'type Buffer[T ~[16]byte] struct{}\n';
  const decl = analyzeGo(src, 'a.go').declarations[0];
  assert.equal(decl.kind, 'class');
  assert.equal(decl.name, 'Buffer');
  assert.ok(decl.signature, 'signature is non-null');
  assert.ok(decl.signature.endsWith('{'), 'signature ends at body opener');
});

test('multi-line type-parameter list: kind=class, name correct, signature captures through body opener', () => {
  // classifyTypeKind scans subsequent lines when bracketDepth does not close on decl line.
  const src = 'type Cache[\n\tK comparable,\n\tV any,\n] struct{}\n';
  const decl = analyzeGo(src, 'a.go').declarations[0];
  assert.equal(decl.kind, 'class');
  assert.equal(decl.name, 'Cache');
  assert.ok(decl.signature, 'signature is non-null');
  assert.ok(decl.signature.endsWith('{'), 'signature ends at body opener');
  assert.ok(decl.signature.includes('K comparable'), 'multi-line params in signature');
});

// ─── resolveImport ───────────────────────────────────────────────────────────

test('goParser.resolveImport: absent goModulePath → external', () => {
  assert.deepEqual(
    goParser.resolveImport('main.go', 'github.com/acme/svc/store', { sourceFiles: new Set(['store/db.go']) }),
    { status: 'external' }
  );
});

test('goParser.resolveImport: stdlib path → external', () => {
  assert.deepEqual(
    goParser.resolveImport('main.go', 'fmt', { sourceFiles: new Set(), goModulePath: 'github.com/acme/svc' }),
    { status: 'external' }
  );
});

test('goParser.resolveImport: intra-module path → resolved with sorted non-test .go files', () => {
  const files = new Set(['store/db.go', 'store/repo.go', 'store/repo_test.go', 'other/x.go']);
  const result = goParser.resolveImport('main.go', 'github.com/acme/svc/store', { sourceFiles: files, goModulePath: 'github.com/acme/svc' });
  assert.deepEqual(result, { status: 'resolved', paths: ['store/db.go', 'store/repo.go'] });
});

test('goParser.resolveImport: import equals module path → root package files', () => {
  const files = new Set(['main.go', 'util.go', 'main_test.go']);
  const result = goParser.resolveImport('cmd/run.go', 'github.com/acme/svc', { sourceFiles: files, goModulePath: 'github.com/acme/svc' });
  assert.deepEqual(result, { status: 'resolved', paths: ['main.go', 'util.go'] });
});

test('goParser.resolveImport: module-prefixed dir with no importable files → unresolved_local', () => {
  const files = new Set(['store/repo_test.go']);
  const result = goParser.resolveImport('main.go', 'github.com/acme/svc/store', { sourceFiles: files, goModulePath: 'github.com/acme/svc' });
  assert.deepEqual(result, { status: 'unresolved_local' });
});

// ─── regression: grouped import opening-line ─────────────────────────────────

test('grouped import: specifier on same line as opening paren is not lost', () => {
  // Regression: `import ( "fmt"` — inImportBlock was set but the import on
  // that same line was never parsed, so "fmt" was silently dropped.
  const src = 'import ( "fmt"\n\t"net/http"\n)\nfunc f() {}\n';
  const imports = analyzeGo(src, 'a.go').imports;
  assert.equal(imports.length, 2, `expected 2 imports, got ${imports.length}: ${imports.map((i) => i.specifier).join(', ')}`);
  assert.deepEqual(imports.map((i) => i.specifier).sort(), ['fmt', 'net/http']);
});

test('grouped import: opening-line specifier inside // comment is not captured', () => {
  // The // comment makes the "fake" unreachable, but the real import on line 2 must survive.
  const src = 'import ( // "fake"\n\t"fmt"\n)\nfunc f() {}\n';
  const imports = analyzeGo(src, 'a.go').imports;
  assert.equal(imports.length, 1, `expected 1 import, got ${imports.length}`);
  assert.equal(imports[0].specifier, 'fmt');
});

// ─── regression: var/const with func type — no phantom names ─────────────────

test('var with func type: only the declared name, not parameter-list identifiers', () => {
  // Regression: `var Callback func(int, string)` — extractNamesFromDecl split on ALL
  // commas, so "string" was extracted as a second name and added to exports.
  const src = 'var Callback func(int, string)\n';
  const decl = analyzeGo(src, 'a.go').declarations[0];
  assert.deepEqual(decl.search_names, ['Callback'], `got: ${JSON.stringify(decl.search_names)}`);
  assert.deepEqual(analyzeGo(src, 'a.go').exports, ['Callback']);
});

test('var with two named-param func type: no phantom names (PairFn case)', () => {
  const src = 'var PairFn func(A, B int)\n';
  const decl = analyzeGo(src, 'a.go').declarations[0];
  assert.deepEqual(decl.search_names, ['PairFn']);
  assert.deepEqual(analyzeGo(src, 'a.go').exports, ['PairFn']);
});

test('multi-name var with func type: both declared names only, type params excluded', () => {
  const src = 'var Handler, Fallback func(int, string)\n';
  const decl = analyzeGo(src, 'a.go').declarations[0];
  assert.deepEqual(decl.search_names, ['Handler', 'Fallback']);
  assert.ok(!decl.search_names.includes('string'), '"string" must not appear in search_names');
});

test('const with generic-type value: names extracted at depth 0 only', () => {
  // const A, B = SomeGeneric[X, Y]{} — the commas inside [] are depth 1
  const src = 'const A, B = 1, 2\n';
  const decl = analyzeGo(src, 'a.go').declarations[0];
  assert.deepEqual(decl.search_names, ['A', 'B']);
});

// ─── regression: logical_line signature preserves string literals ─────────────

test('const with string literal: signature preserves the string value', () => {
  // Regression: logical_line returned line.effective which strips string contents.
  // `const Version = "1.0"` came out as `const Version =`.
  const src = 'const Version = "1.0"\n';
  const decl = analyzeGo(src, 'a.go').declarations[0];
  assert.equal(decl.signature, 'const Version = "1.0"', `got: ${JSON.stringify(decl.signature)}`);
});

test('var with string literal: signature preserves the string value', () => {
  const src = 'var Label = "hello"\n';
  const decl = analyzeGo(src, 'a.go').declarations[0];
  assert.equal(decl.signature, 'var Label = "hello"');
});

test('const with raw backtick string: signature preserves the raw string', () => {
  const src = 'const Query = `SELECT * FROM users`\n';
  const decl = analyzeGo(src, 'a.go').declarations[0];
  assert.ok(decl.signature, 'signature is non-null');
  assert.ok(decl.signature!.includes('SELECT'), `signature must include raw string content: got ${JSON.stringify(decl.signature)}`);
});

test('const with trailing // comment: comment excluded from signature', () => {
  const src = 'const Pi = 3.14 // ratio\n';
  const decl = analyzeGo(src, 'a.go').declarations[0];
  assert.ok(decl.signature, 'signature is non-null');
  assert.ok(!decl.signature!.includes('ratio'), `trailing comment must not appear in signature: got ${JSON.stringify(decl.signature)}`);
  assert.ok(decl.signature!.includes('3.14'), 'numeric literal preserved');
});

// ─── regression: inline fully-closed grouped import ──────────────────────────

test('inline grouped import: single spec closes block on same line; func after it is not swallowed', () => {
  // Regression: `import ("fmt")` — parser set inImportBlock=true but never closed
  // it, so func F() on the next line was consumed by the stuck import scanner.
  const src = 'import ("fmt")\nfunc F() {}\n';
  const analysis = analyzeGo(src, 'a.go');
  assert.equal(analysis.imports.length, 1, `expected 1 import, got ${analysis.imports.length}`);
  assert.equal(analysis.imports[0].specifier, 'fmt');
  assert.ok(analysis.declarations.some((d) => d.name === 'F'), 'F must be declared, not swallowed by stuck inImportBlock');
});

test('inline grouped import: multiple specs on one line; subsequent decl not swallowed', () => {
  const src = 'import ("fmt"; "net/http")\nfunc G() {}\n';
  const analysis = analyzeGo(src, 'a.go');
  assert.deepEqual(analysis.imports.map((i) => i.specifier).sort(), ['fmt', 'net/http']);
  assert.ok(analysis.declarations.some((d) => d.name === 'G'), 'G declared after inline block');
});

// ─── regression: grouped import member-line edge cases ───────────────────────

test('grouped import: closing ) on same line as spec — spec is not lost', () => {
  // Regression: member-line handler checked eff.startsWith(')') before extracting specs.
  // For `\t"fmt")`, effective is `\t)` (string stripped), so ) check fired first.
  const src = 'import (\n\t"fmt")\nfunc F() {}\n';
  const analysis = analyzeGo(src, 'a.go');
  assert.equal(analysis.imports.length, 1, `expected 1 import, got ${analysis.imports.length}: ${analysis.imports.map((i) => i.specifier).join(', ')}`);
  assert.equal(analysis.imports[0].specifier, 'fmt');
  assert.ok(analysis.declarations.some((d) => d.name === 'F'), 'F not swallowed after block closes');
});

test('grouped import: multiple specs on a member line (semicolon-separated)', () => {
  // Regression: member-line handler used .match() (single match) instead of all matches.
  const src = 'import (\n\t"fmt"; "net/http"\n)\nfunc F() {}\n';
  const imports = analyzeGo(src, 'a.go').imports;
  assert.equal(imports.length, 2, `expected 2 imports, got ${imports.length}: ${imports.map((i) => i.specifier).join(', ')}`);
  assert.deepEqual(imports.map((i) => i.specifier).sort(), ['fmt', 'net/http']);
});

// ─── regression: multiline raw string ────────────────────────────────────────

test('multiline raw string with // line inside: spanEnd does not stop at the literal line', () => {
  // Regression: spanEnd saw raw.startsWith('//') and stopped inside the raw string.
  // LineInfo.inRawStringBefore must suppress that check.
  const src = 'const Query = `SELECT\n// not a Go comment\nFROM users`\nfunc F() {}\n';
  const decl = analyzeGo(src, 'a.go').declarations.find((d) => d.name === 'Query')!;
  assert.ok(decl, 'Query declaration found');
  const slice = src.slice(decl.start, decl.end);
  assert.ok(slice.includes('FROM users'), `span must include full raw string: got ${JSON.stringify(slice)}`);
  assert.ok(!slice.includes('func F'), "F must not be included in Query's span");
});

test('multiline raw string: signature includes all lines of the raw string', () => {
  const src = 'const Query = `SELECT\n// not a Go comment\nFROM users`\n';
  const decl = analyzeGo(src, 'a.go').declarations[0];
  assert.ok(decl.signature, 'signature is non-null');
  assert.ok(decl.signature!.includes('SELECT'), 'first raw string line in signature');
  assert.ok(decl.signature!.includes('FROM users'), 'last raw string line in signature');
  assert.ok(decl.signature!.includes('// not a Go comment'), '// inside raw string preserved as literal');
});

// ─── regression: multi-line logical signature ────────────────────────────────

test('multi-line const: signature includes continuation line containing string value', () => {
  // Regression: logical_line read only the first line, so `const X =` was the
  // entire signature and the `"value"` on the continuation line was lost.
  const src = 'const X =\n\t"value"\n';
  const decl = analyzeGo(src, 'a.go').declarations[0];
  assert.ok(decl.signature, 'signature is non-null');
  assert.ok(decl.signature!.includes('"value"'), `continuation line captured: got ${JSON.stringify(decl.signature)}`);
});

test('multi-line var: signature includes continuation line containing string literal', () => {
  // A string-only continuation is the common case the scanner can detect:
  // effective text for `\t"..."` is empty (string stripped), so spanEnd does not
  // stop there, the span covers both lines, and the signature includes both.
  const src = 'var Template =\n\t"SELECT * FROM users WHERE id = ?"\n';
  const decl = analyzeGo(src, 'a.go').declarations[0];
  assert.ok(decl.signature, 'signature is non-null');
  assert.ok(decl.signature!.includes('SELECT'), `got: ${JSON.stringify(decl.signature)}`);
});

// ─── regression: declaration continuation (non-string) ───────────────────────

test('continuation: const = numeric; span and signature include value', () => {
  // Regression: spanEnd treated any non-empty effective top-level line as a new construct.
  // `42` has non-empty effective, so it was incorrectly cut from the span.
  const src = 'const Answer =\n\t42\nfunc F() {}\n';
  const decl = analyzeGo(src, 'a.go').declarations.find((d) => d.name === 'Answer')!;
  assert.ok(decl, 'Answer declaration found');
  const slice = src.slice(decl.start, decl.end);
  assert.ok(slice.includes('42'), `span must include value: got ${JSON.stringify(slice)}`);
  assert.ok(!slice.includes('func F'), "F must not be included in Answer's span");
  assert.ok(decl.signature, 'signature is non-null');
  assert.ok(decl.signature!.includes('42'), `signature must include value: got ${JSON.stringify(decl.signature)}`);
});

test('continuation: var = expr + operator continuation; span includes both lines', () => {
  // `var Total = left +` ends with `+` which does not trigger ASI — next line is continuation.
  const src = 'var Total = left +\n\tright\nfunc F() {}\n';
  const decl = analyzeGo(src, 'a.go').declarations.find((d) => d.name === 'Total')!;
  assert.ok(decl, 'Total declaration found');
  const slice = src.slice(decl.start, decl.end);
  assert.ok(slice.includes('right'), `span must include continuation line: got ${JSON.stringify(slice)}`);
  assert.ok(!slice.includes('func F'), "F must not be included in Total's span");
});

test('continuation: comment-only line inside continuation is not treated as a doc-comment boundary', () => {
  // `const Answer =` ends with `=` → continuation. The `// computed` line must be
  // skipped as an inline comment, not as a doc-comment boundary for the next decl.
  const src = 'const Answer =\n\t// computed\n\t42\nfunc F() {}\n';
  const decl = analyzeGo(src, 'a.go').declarations.find((d) => d.name === 'Answer')!;
  assert.ok(decl, 'Answer declaration found');
  const slice = src.slice(decl.start, decl.end);
  assert.ok(slice.includes('42'), `span must include value after inline comment: got ${JSON.stringify(slice)}`);
  assert.ok(!slice.includes('func F'), "F must not be included in Answer's span");
});

test('continuation: var with multi-line name list yields all names and correct span', () => {
  // `var First,` ends with `,` → continuation. `Second int` is the continuation line.
  // extractNamesFromDecl must see the joined effective to find both names.
  const src = 'var First,\n\tSecond int\nfunc F() {}\n';
  const decl = analyzeGo(src, 'a.go').declarations.find((d) => d.name === 'First')!;
  assert.ok(decl, 'First declaration found');
  assert.deepEqual([...decl.search_names].sort(), ['First', 'Second']);
  const slice = src.slice(decl.start, decl.end);
  assert.ok(slice.includes('Second'), `span must include Second: got ${JSON.stringify(slice)}`);
  assert.ok(!slice.includes('func F'), "F must not be included in the span");
});

test('continuation: Second from multi-line var declaration appears in exports', () => {
  const src = 'var First,\n\tSecond int\n';
  const { exports } = analyzeGo(src, 'a.go');
  assert.ok(exports.includes('First'), 'First is exported');
  assert.ok(exports.includes('Second'), 'Second is exported');
});

// ─── regression: non-ASI keywords do not terminate declaration ────────────────

test('non-ASI keyword chan: var type split across lines is one declaration', () => {
  // `var Ch chan` ends with keyword `chan` which is NOT in Go's ASI list → continuation.
  const src = 'var Ch chan\n\tint\nfunc F() {}\n';
  const decl = analyzeGo(src, 'a.go').declarations.find((d) => d.name === 'Ch')!;
  assert.ok(decl, 'Ch declaration found');
  const slice = src.slice(decl.start, decl.end);
  assert.ok(slice.includes('int'), `span must include type continuation: got ${JSON.stringify(slice)}`);
  assert.ok(!slice.includes('func F'), "F must not be in Ch's span");
});

test('non-ASI keyword map: var type split across lines is one declaration', () => {
  const src = 'var Lookup map\n\t[string]int\nfunc F() {}\n';
  const decl = analyzeGo(src, 'a.go').declarations.find((d) => d.name === 'Lookup')!;
  assert.ok(decl, 'Lookup declaration found');
  const slice = src.slice(decl.start, decl.end);
  assert.ok(slice.includes('[string]int'), `span must include type: got ${JSON.stringify(slice)}`);
  assert.ok(!slice.includes('func F'), "F must not be in Lookup's span");
});

test('non-ASI keyword struct: type body on next line is included in span', () => {
  // `type Config struct` ends with `struct` (non-ASI keyword) → { on next line is continuation.
  const src = 'type Config struct\n{\n\tEnabled bool\n}\nfunc F() {}\n';
  const decl = analyzeGo(src, 'a.go').declarations.find((d) => d.name === 'Config')!;
  assert.ok(decl, 'Config declaration found');
  const slice = src.slice(decl.start, decl.end);
  assert.ok(slice.includes('Enabled'), `span must include struct body: got ${JSON.stringify(slice)}`);
  assert.ok(!slice.includes('func F'), "F must not be in Config's span");
});

test('non-ASI keyword interface: type body on next line is included in span', () => {
  const src = 'type Runner interface\n{\n\tRun()\n}\nfunc F() {}\n';
  const decl = analyzeGo(src, 'a.go').declarations.find((d) => d.name === 'Runner')!;
  assert.ok(decl, 'Runner declaration found');
  const slice = src.slice(decl.start, decl.end);
  assert.ok(slice.includes('Run()'), `span must include interface body: got ${JSON.stringify(slice)}`);
  assert.ok(!slice.includes('func F'), "F must not be in Runner's span");
});

// ─── regression: float literal ending in . is not treated as continuation ────

test('selector on identifier ending with digit: pkg2.Value is continuation not float', () => {
  // Regression: the single-char check `/[0-9_]/.test(penultimate)` mistook `pkg2.` for a
  // float literal. Full token scan must see that pkg2 starts with a letter → member access.
  const src = 'var X = pkg2.\n\tValue\nfunc F() {}\n';
  const decl = analyzeGo(src, 'a.go').declarations.find((d) => d.name === 'X')!;
  assert.ok(decl, 'X found');
  const slice = src.slice(decl.start, decl.end);
  assert.ok(slice.includes('Value'), `span must include continuation: got ${JSON.stringify(slice)}`);
  assert.ok(!slice.includes('func F'), "F must not be in X's span");
});

test('selector on identifier ending with underscore: pkg_.Value is continuation not float', () => {
  const src = 'var X = pkg_.\n\tValue\nfunc F() {}\n';
  const decl = analyzeGo(src, 'a.go').declarations.find((d) => d.name === 'X')!;
  assert.ok(decl, 'X found');
  const slice = src.slice(decl.start, decl.end);
  assert.ok(slice.includes('Value'), `span must include continuation: got ${JSON.stringify(slice)}`);
});

test('raw string closes mid-line with trailing operator: continuation is captured', () => {
  // Regression: when raw string closed, lastMasked was hardcoded to `` ` `` (backtick only),
  // dropping ` +` on the same closing line. The next line was then not seen as continuation.
  const src = 'var X = `a\nb` +\n\tsuffix\nfunc F() {}\n';
  const decl = analyzeGo(src, 'a.go').declarations.find((d) => d.name === 'X')!;
  assert.ok(decl, 'X found');
  const slice = src.slice(decl.start, decl.end);
  assert.ok(slice.includes('suffix'), `span must include suffix after raw string: got ${JSON.stringify(slice)}`);
  assert.ok(!slice.includes('func F'), "F must not be in X's span");
});

test('float literal 1. terminates declaration — next const not absorbed into span', () => {
  // `1.` is a valid Go float literal. The trailing `.` is not a member-access operator,
  // so the line triggers ASI and the next declaration must not be merged into the span.
  const src = 'const X = 1.\nconst Y = 2\n';
  const decls = analyzeGo(src, 'a.go').declarations;
  const x = decls.find((d) => d.name === 'X')!;
  const y = decls.find((d) => d.name === 'Y')!;
  assert.ok(x, 'X found');
  assert.ok(y, 'Y found');
  const xSlice = src.slice(x.start, x.end);
  assert.ok(!xSlice.includes('const Y'), `Y must not be absorbed into X's span: got ${JSON.stringify(xSlice)}`);
  assert.ok(decls.length === 2, `expected 2 declarations, got ${decls.length}`);
});
