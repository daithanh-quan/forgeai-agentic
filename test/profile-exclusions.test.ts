import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizePatternToGlobs, isValidPattern, matchExclusion,
  PROFILE_EXCLUSIONS, resolveExclusions, parseIncludeExcluded
} from '../bin/lib/profile-exclusions.js';
import type { ResolvedExclusionRule } from '../bin/lib/types.js';

// --- normalization (Task 1) ---

test('directory shorthand expands to root and nested globs', () => {
  assert.deepEqual(normalizePatternToGlobs('vendor/'), ['**/vendor/**', 'vendor/**']);
});

test('nested directory shorthand', () => {
  assert.deepEqual(
    normalizePatternToGlobs('alembic/versions/'),
    ['**/alembic/versions/**', 'alembic/versions/**']
  );
});

test('filename glob matches root and any depth', () => {
  assert.deepEqual(normalizePatternToGlobs('*.pb.go'), ['**/*.pb.go', '*.pb.go']);
});

test('dotfile matches root and any depth', () => {
  assert.deepEqual(normalizePatternToGlobs('.env'), ['**/.env', '.env']);
});

test('already-recursive glob passes through unchanged', () => {
  assert.deepEqual(normalizePatternToGlobs('**/tests/fixtures/**'), ['**/tests/fixtures/**']);
});

// --- validation + matching (Task 2) ---

const rules: ResolvedExclusionRule[] = [
  { pattern: 'migrations/', reason: 'generated migrations', profiles: ['django'] },
  { pattern: '*.pb.go', reason: 'generated protobuf', profiles: ['go'] },
];

test('matchExclusion omits a nested excluded path', () => {
  const r = matchExclusion('app/migrations/0001.py', rules, []);
  assert.equal(r.matched, true);
  assert.equal(r.matched && r.rule.pattern, 'migrations/');
});

test('matchExclusion keeps a non-matching path', () => {
  assert.equal(matchExclusion('app/views.py', rules, []).matched, false);
});

test('include glob overrides an exclusion', () => {
  assert.equal(matchExclusion('app/migrations/0001.py', rules, ['**/migrations/**']).matched, false);
});

test('most-specific rule wins on overlap', () => {
  const overlap: ResolvedExclusionRule[] = [
    { pattern: 'a/', reason: 'dir a', profiles: ['x'] },
    { pattern: 'a/b/', reason: 'dir a/b', profiles: ['y'] },
  ];
  const r = matchExclusion('a/b/c.ts', overlap, []);
  assert.equal(r.matched && r.rule.pattern, 'a/b/');
});

test('isValidPattern rejects absolute and traversal patterns', () => {
  assert.equal(isValidPattern('/etc/passwd'), false);
  assert.equal(isValidPattern('../secrets'), false);
  assert.equal(isValidPattern('C:\\secrets\\file'), false);
  assert.equal(isValidPattern(''), false);
  assert.equal(isValidPattern('migrations/'), true);
});

// --- policy table + resolution (Task 3) ---

test('go profile has expected patterns', () => {
  assert.deepEqual(
    PROFILE_EXCLUSIONS.go.map((r) => r.pattern),
    ['vendor/', '*.pb.go', '*_mock.go']
  );
});

test('resolveExclusions unions and dedupes shared patterns across a composite', () => {
  const resolved = resolveExclusions(['django', 'python-api']);
  const pycache = resolved.filter((r) => r.pattern === '__pycache__/');
  assert.equal(pycache.length, 1);
  assert.deepEqual(pycache[0].profiles, ['django', 'python-api']);
});

test('resolveExclusions returns [] for a profile with no table', () => {
  assert.deepEqual(resolveExclusions(['nextjs']), []);
});

test('resolved rules are sorted by pattern', () => {
  const resolved = resolveExclusions(['django']);
  const patterns = resolved.map((r) => r.pattern);
  assert.deepEqual(patterns, [...patterns].sort((a, b) => a.localeCompare(b)));
});

test('shared patterns across profiles use identical reasons (composite-safe)', () => {
  // Any pattern appearing in multiple profiles must carry the same reason,
  // otherwise resolveExclusions throws on composition.
  const seen = new Map<string, string>();
  for (const list of Object.values(PROFILE_EXCLUSIONS)) {
    for (const r of list) {
      const prev = seen.get(r.pattern);
      if (prev !== undefined) assert.equal(r.reason, prev, `reason drift for ${r.pattern}`);
      else seen.set(r.pattern, r.reason);
    }
  }
});

// --- --include-excluded parser (Task 5) ---

test('parseIncludeExcluded splits, trims, dedupes', () => {
  assert.deepEqual(parseIncludeExcluded(' a/** , b/** , a/** '), ['a/**', 'b/**']);
});

test('parseIncludeExcluded normalizes Windows separators', () => {
  assert.deepEqual(parseIncludeExcluded('src\\generated\\**'), ['src/generated/**']);
});

test('parseIncludeExcluded returns [] for null', () => {
  assert.deepEqual(parseIncludeExcluded(null), []);
});

test('parseIncludeExcluded rejects empty member, absolute, and traversal', () => {
  assert.throws(() => parseIncludeExcluded('a/**,,b/**'));
  assert.throws(() => parseIncludeExcluded('/etc/**'));
  assert.throws(() => parseIncludeExcluded('C:\\secrets\\**'));
  assert.throws(() => parseIncludeExcluded('../x'));
});
