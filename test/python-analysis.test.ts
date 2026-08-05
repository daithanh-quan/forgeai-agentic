import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzePython } from '../bin/lib/python-analysis.js';

test('top-level def/class only; nested ignored', () => {
  const src = 'def foo():\n    def nested():\n        pass\n    return 1\n\nclass Bar:\n    def m(self):\n        pass\n';
  assert.deepEqual(analyzePython(src, 'm.py').declarations.map((d) => [d.kind, d.name]), [['function', 'foo'], ['class', 'Bar']]);
});

test('span ends at the next top-level statement, not the next def', () => {
  const src = 'def first():\n    pass\n\nSETTING = 1\nfrom app import service\n\ndef second():\n    pass\n';
  const first = analyzePython(src, 'm.py').declarations.find((d) => d.name === 'first')!;
  const slice = src.slice(first.start, first.end);
  assert.ok(slice.includes('pass'));
  assert.ok(!slice.includes('SETTING'), 'span must stop before SETTING');
  assert.ok(!slice.includes('service'));
});

test('span includes decorators (incl. multiline) and full body', () => {
  const src = '@app.get(\n    "/users",\n)\nasync def list_users(\n    limit: int = 10,\n) -> list[User]:\n    return users[:limit]\n\ndef other():\n    pass\n';
  const decl = analyzePython(src, 'm.py').declarations.find((d) => d.name === 'list_users')!;
  const slice = src.slice(decl.start, decl.end);
  assert.ok(slice.startsWith('@app.get('), 'starts at multiline decorator');
  assert.ok(slice.includes('return users[:limit]'));
  assert.ok(!slice.includes('def other'));
  assert.equal(decl.signature, 'async def list_users(\n    limit: int = 10,\n) -> list[User]:');
});

test('colon inside annotations/defaults does not truncate the signature', () => {
  const src = 'def f(x: dict = {1: 2}) -> int:\n    return x[1]\n';
  assert.equal(analyzePython(src, 'm.py').declarations[0].signature, 'def f(x: dict = {1: 2}) -> int:');
});

test('.pyi stub span includes the inline ellipsis body', () => {
  const src = 'def f() -> int: ...\n';
  const decl = analyzePython(src, 'm.pyi').declarations[0];
  assert.equal(src.slice(decl.start, decl.end), 'def f() -> int: ...');
});

test('signature stops at the suite colon, excluding any inline body', () => {
  assert.equal(analyzePython('def f() -> int: ...\n', 'm.pyi').declarations[0].signature, 'def f() -> int:');
  assert.equal(analyzePython('def g(): return 1\n', 'm.py').declarations[0].signature, 'def g():');
});

test('def inside comment or docstring is ignored', () => {
  const src = '# def commented():\n"""\ndef in_docstring():\n"""\ndef real():\n    pass\n';
  assert.deepEqual(analyzePython(src, 'm.py').declarations.map((d) => d.name), ['real']);
});

test('a malformed header without a suite colon is skipped and never absorbs the next declaration', () => {
  const src = 'def broken()\n\ndef valid():\n    return 1\n';
  const decls = analyzePython(src, 'm.py').declarations;
  assert.deepEqual(decls.map((d) => d.name), ['valid']);
  assert.equal(decls[0].signature, 'def valid():');
});

test('CRLF and non-ASCII keep UTF-16/code-unit offsets self-consistent', () => {
  // Identifiers stay ASCII (parser scope); Unicode lives in the body and prior
  // statement so offset math is still exercised across multi-byte characters.
  const src = 'GREETING = "π-λ"\r\ndef handler():\r\n    return "café π"\r\n\ndef next_one():\r\n    pass\r\n';
  const decl = analyzePython(src, 'm.py').declarations.find((d) => d.name === 'handler')!;
  assert.ok(src.slice(decl.start, decl.end).includes('return "café π"'));
  assert.ok(!src.slice(decl.start, decl.end).includes('next_one'));
});

test('malformed unterminated triple-string does not crash and yields no bogus decls', () => {
  const src = 'x = """\ndef never():\n    pass\n';
  assert.deepEqual(analyzePython(src, 'm.py').declarations, []);
});

test('__all__ overrides exports; dynamic __all__ falls back to public names', () => {
  assert.deepEqual(analyzePython('__all__ = ["a", "b"]\ndef a():\n    pass\ndef c():\n    pass\n', 'm.py').exports, ['a', 'b']);
  assert.deepEqual(analyzePython('__all__ = ["a", compute()]\ndef a():\n    pass\ndef d():\n    pass\n', 'm.py').exports, ['a', 'd']);
});

test('annotated __all__ is parsed from the RHS literal, not the annotation brackets', () => {
  assert.deepEqual(analyzePython('__all__: list[str] = ["a"]\ndef a():\n    pass\ndef b():\n    pass\n', 'm.py').exports, ['a']);
});

test('__all__ with comments stays valid and does not fall back', () => {
  const src = '__all__ = [\n    "a",  # public API\n]\ndef a():\n    pass\ndef internal():\n    pass\n';
  assert.deepEqual(analyzePython(src, 'm.py').exports, ['a']);
});

test('a # inside an __all__ string literal is not treated as a comment', () => {
  assert.deepEqual(analyzePython('__all__ = ["a#b"]\ndef c():\n    pass\n', 'm.py').exports, ['a#b']);
});

test('a private name listed in __all__ is exported', () => {
  const a = analyzePython('__all__ = ["_x"]\ndef _x():\n    pass\n', 'm.py');
  assert.deepEqual(a.exports, ['_x']);
  assert.equal(a.declarations[0].exported, true);
});

test('public/private fallback and test detection', () => {
  const a = analyzePython('def public():\n    pass\ndef _private():\n    pass\ndef test_it():\n    pass\nclass TestThing:\n    pass\n', 'm.py');
  assert.deepEqual(a.exports, ['public']);
  assert.deepEqual(a.declarations.map((d) => d.kind), ['function', 'function', 'test', 'test']);
});

test('import grammar → specifiers, including function-local and parenthesized', () => {
  const src = [
    'import a.b.c',
    'import a, b',
    'import a as z',
    'from x import y',
    'from .x import y',
    'from ..a.b import c',
    'from . import m, n',
    'from pkg import (',
    '    one,',
    '    two,',
    ')',
    'def handler():',
    '    from app.services import load_user',
    '    return load_user'
  ].join('\n') + '\n';
  const imports = analyzePython(src, 'm.py').imports;
  assert.deepEqual(imports.map((i) => i.specifier),
    ['a.b.c', 'a', 'b', 'a', 'x', '.x', '..a.b', '.m', '.n', 'pkg', 'app.services']);
  const paren = imports.find((i) => i.specifier === 'pkg')!;
  assert.ok(src.slice(paren.start, paren.end).includes('two,'), 'paren import span covers all members');
});

test('parenthesized relative import strips per-line comments before splitting names', () => {
  const src = 'from . import (\n    x,  # first\n    y,\n)\n';
  assert.deepEqual(analyzePython(src, 'm.py').imports.map((i) => i.specifier), ['.x', '.y']);
});
