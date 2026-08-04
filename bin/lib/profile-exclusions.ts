import type {
  ProfileExclusionRule, ResolvedExclusionRule
} from './types.js';
import { globMatches } from './path-glob.js';

/** Expand an authored shorthand pattern into concrete globs for globMatches.
 *  Authored patterns are shorthand, not literal globs; globMatches anchors both
 *  ends and `*` does not cross `/`, so a bare `vendor/` or `*.pb.go` would never
 *  match a nested path without this expansion. */
export function normalizePatternToGlobs(raw: string): string[] {
  const p = raw.trim();
  if (p.includes('**')) return [p];
  if (p.endsWith('/')) {
    const dir = p.slice(0, -1);
    return [`**/${dir}/**`, `${dir}/**`];
  }
  return [`**/${p}`, p];
}

export function isValidPattern(p: string): boolean {
  if (typeof p !== 'string' || p.trim().length === 0) return false;
  const normalized = p.replace(/\\/g, '/');
  if (normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)) return false;
  if (normalized.split('/').some((seg) => seg === '.' || seg === '..')) return false;
  return true;
}

function specificity(rule: ResolvedExclusionRule): [number, number, string] {
  const segments = rule.pattern.replace(/\/+$/, '').split('/').length;
  return [segments, rule.pattern.length, rule.pattern];
}

export function matchExclusion(
  path: string,
  rules: ResolvedExclusionRule[],
  includeGlobs: string[]
): { matched: false } | { matched: true; rule: ResolvedExclusionRule } {
  if (includeGlobs.some((g) => globMatches(g, path))) return { matched: false };
  const hits = rules.filter((rule) =>
    normalizePatternToGlobs(rule.pattern).some((g) => globMatches(g, path))
  );
  if (hits.length === 0) return { matched: false };
  hits.sort((a, b) => {
    const [sa, la, pa] = specificity(a);
    const [sb, lb, pb] = specificity(b);
    return sb - sa || lb - la || pa.localeCompare(pb);
  });
  return { matched: true, rule: hits[0] };
}

/** Authored profile exclusion patterns. Shared patterns across profiles MUST use
 *  identical reason strings so composite resolution merges them cleanly.
 *  This table is mirrored by each profile's Markdown `## Context exclusion hints`
 *  section and guarded by test/profile-exclusion-drift.test.ts. */
export const PROFILE_EXCLUSIONS: Record<string, ProfileExclusionRule[]> = {
  go: [
    { pattern: 'vendor/', reason: 'vendored dependencies' },
    { pattern: '*.pb.go', reason: 'generated protobuf source' },
    { pattern: '*_mock.go', reason: 'generated mocks' },
  ],
  rust: [
    { pattern: 'target/', reason: 'Rust build output' },
    { pattern: '**/tests/fixtures/**', reason: 'test fixtures' },
  ],
  fastapi: [
    { pattern: 'alembic/versions/', reason: 'generated migration scripts' },
    { pattern: '__pycache__/', reason: 'Python bytecode cache' },
    { pattern: '.env', reason: 'environment secrets' },
    { pattern: '*.pyc', reason: 'Python bytecode' },
  ],
  django: [
    { pattern: 'migrations/', reason: 'auto-generated migrations' },
    { pattern: '__pycache__/', reason: 'Python bytecode cache' },
    { pattern: '.env', reason: 'environment secrets' },
    { pattern: 'staticfiles/', reason: 'collected static assets' },
    { pattern: 'media/', reason: 'user-uploaded media' },
  ],
  'react-native': [
    { pattern: 'android/', reason: 'native Android platform files' },
    { pattern: 'ios/', reason: 'native iOS platform files' },
    { pattern: 'node_modules/', reason: 'installed dependencies' },
    { pattern: '.expo/', reason: 'Expo build cache' },
  ],
  sveltekit: [
    { pattern: '.svelte-kit/', reason: 'generated SvelteKit output' },
    { pattern: 'build/', reason: 'build artifacts' },
    { pattern: 'node_modules/', reason: 'installed dependencies' },
  ],
  'python-api': [
    { pattern: '__pycache__/', reason: 'Python bytecode cache' },
    { pattern: '.env', reason: 'environment secrets' },
    { pattern: '*.pyc', reason: 'Python bytecode' },
    { pattern: '.venv/', reason: 'virtual environment' },
    { pattern: 'venv/', reason: 'virtual environment' },
  ],
  mobile: [
    { pattern: 'android/', reason: 'native Android platform files' },
    { pattern: 'ios/', reason: 'native iOS platform files' },
    { pattern: '.expo/', reason: 'Expo build cache' },
  ],
  tauri: [
    { pattern: 'src-tauri/target/', reason: 'Rust build output' },
    { pattern: 'target/', reason: 'Rust build output' },
  ],
};

export function resolveExclusions(profileNames: string[]): ResolvedExclusionRule[] {
  const byPattern = new Map<string, ResolvedExclusionRule>();
  for (const name of profileNames) {
    for (const rule of PROFILE_EXCLUSIONS[name] ?? []) {
      if (!isValidPattern(rule.pattern)) throw new Error(`invalid exclusion pattern '${rule.pattern}' for profile '${name}'`);
      const existing = byPattern.get(rule.pattern);
      if (existing) {
        if (existing.reason !== rule.reason) {
          throw new Error(
            `conflicting exclusion reasons for '${rule.pattern}': '${existing.reason}' vs '${rule.reason}'`
          );
        }
        if (!existing.profiles.includes(name)) existing.profiles.push(name);
      } else {
        byPattern.set(rule.pattern, { ...rule, profiles: [name] });
      }
    }
  }
  const resolved = Array.from(byPattern.values());
  for (const r of resolved) r.profiles.sort((a, b) => a.localeCompare(b));
  resolved.sort((a, b) => a.pattern.localeCompare(b.pattern));
  return resolved;
}

/** Parse a comma-separated --include-excluded value into normalized globs.
 *  Throws on empty members, absolute paths, or `.`/`..` segments. */
export function parseIncludeExcluded(value: string | null): string[] {
  if (value === null) return [];
  const parts = value.split(',').map((s) => s.trim());
  const out: string[] = [];
  for (const rawPart of parts) {
    const part = rawPart.replace(/\\/g, '/');
    if (part.length === 0) throw new Error('--include-excluded contains an empty entry');
    if (part.startsWith('/') || /^[A-Za-z]:\//.test(part)) throw new Error(`--include-excluded rejects absolute path '${part}'`);
    if (part.split('/').some((seg) => seg === '.' || seg === '..')) {
      throw new Error(`--include-excluded rejects '.'/'..' segment in '${part}'`);
    }
    if (!out.includes(part)) out.push(part);
  }
  return out;
}
