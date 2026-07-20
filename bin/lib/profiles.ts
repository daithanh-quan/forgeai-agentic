import fs from 'node:fs';
import path from 'node:path';
import type { PackageJson } from './types.js';
import { root, profilesDir } from './context.js';
import { formatStatus, getErrorMessage, listFilesRecursive } from './utils.js';
import { readManifestResult } from './manifest.js';

export function getAvailableProfiles(): string[] {
  if (!fs.existsSync(profilesDir)) return [];
  return fs
    .readdirSync(profilesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

export function profilePath(profile: string): string {
  return path.join(profilesDir, profile);
}

export function normalizeProfile(profile: string): string {
  return profile.trim().toLowerCase();
}

export function parseCompositeProfile(profile: string): string[] {
  return profile.split('+').map((p) => p.trim());
}

export function getProjectPackageJson(): PackageJson | null {
  const absolutePath = path.join(root, 'package.json');
  if (!fs.existsSync(absolutePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(absolutePath, 'utf8')) as PackageJson;
  } catch (error) {
    console.log(`invalid package.json: ${getErrorMessage(error)} (profile detection skipped)`);
    return null;
  }
}

export function hasDependency(packageJson: PackageJson | null, names: string[]): boolean {
  const dependencies = {
    ...(packageJson?.dependencies ?? {}),
    ...(packageJson?.devDependencies ?? {})
  };

  return names.some((name) => dependencies[name] !== undefined);
}

export function fileExists(relativePath: string): boolean {
  return fs.existsSync(path.join(root, relativePath));
}

// requirements.txt: one package per non-comment line; extract name token only.
function parsePythonPackageNames(content: string): Set<string> {
  const names = new Set<string>();
  for (const rawLine of content.split('\n')) {
    const line = rawLine.split('#')[0].trim();
    if (!line || line.startsWith('-')) continue;
    const match = line.match(/^([A-Za-z0-9]([A-Za-z0-9._-]*[A-Za-z0-9])?)/);
    if (match) names.add(match[1].toLowerCase().replace(/[-_.]+/g, '-'));
  }
  return names;
}

// Pipfile: extract keys from [packages] and [dev-packages] sections.
// Line-by-line so `[` inside inline table values (e.g., extras = ["standard"])
// does not prematurely end the section — same strategy as the Poetry parser.
function parsePipfileDeps(content: string): Set<string> {
  const names = new Set<string>();
  const norm = (s: string) => s.toLowerCase().replace(/[-_.]+/g, '-');
  const sectionHeaderRe = /^\[(?:packages|dev-packages)\]$/;
  const allLines = content.split('\n');
  for (let i = 0; i < allLines.length; i++) {
    if (!sectionHeaderRe.test(allLines[i].trim())) continue;
    for (let j = i + 1; j < allLines.length; j++) {
      const line = allLines[j].trim();
      if (!line || line.startsWith('#')) continue;
      if (line.startsWith('[')) break; // next Pipfile section header
      // Match key before = or { (handles string values and inline tables alike)
      const key = line.match(/^([A-Za-z0-9]([A-Za-z0-9._-]*[A-Za-z0-9])?)\s*[={]/)?.[1];
      if (key) names.add(norm(key));
    }
  }
  return names;
}

// Replace TOML triple-quoted multi-line strings with empty equivalents so that
// field-looking lines inside them (e.g. `dependencies = ["fastapi"]` in a
// project description) don't become false-positive matches.
//
// Known limits (both require a proper TOML scanner to fix — deferred to Phase 16.1):
//  • Triple-quoted values inside an array (e.g. `["""fastapi"""]`) are stripped,
//    producing a false-negative for that package.
//  • `"""` inside a line comment (e.g. `# """ example`) is not comment-aware, so
//    the span between it and the next `"""` is incorrectly stripped.
// In practice, neither form appears in real pyproject.toml dependency arrays.
function stripTomlMultilineStrings(content: string): string {
  return content
    .replace(/"""[\s\S]*?"""/g, '""')
    .replace(/'''[\s\S]*?'''/g, "''");
}

// Strip TOML line comments (#) outside quoted strings so commented-out sections
// don't trigger false positives. Handles both " and ' quoted values; treats \\
// as an escape only inside double-quoted strings (TOML basic strings).
function stripTomlComments(content: string): string {
  return content
    .split('\n')
    .map((line) => {
      let i = 0;
      while (i < line.length) {
        const ch = line[i];
        if (ch === '"' || ch === "'") {
          const quote = ch;
          i++;
          while (i < line.length && line[i] !== quote) {
            if (line[i] === '\\' && quote === '"') i++;
            i++;
          }
          i++;
          continue;
        }
        if (ch === '#') return line.slice(0, i);
        i++;
      }
      return line;
    })
    .join('\n');
}

// Bracket-counting scanner: returns the content between the first `key = [`
// and its matching `]`, skipping `[`/`]` inside quoted strings. This correctly
// handles package extras such as "uvicorn[standard]".
function extractTomlArrayContent(content: string, key: string): string | null {
  const startRe = new RegExp(`\\b${key}\\s*=\\s*\\[`);
  const startMatch = startRe.exec(content);
  if (!startMatch) return null;
  const start = startMatch.index + startMatch[0].length;
  let depth = 0;
  let inStr = false;
  let strChar = '';
  for (let i = start; i < content.length; i++) {
    const ch = content[i];
    if (inStr) {
      if (ch === '\\' && strChar === '"') { i++; continue; }
      if (ch === strChar) inStr = false;
    } else if (ch === '"' || ch === "'") {
      inStr = true; strChar = ch;
    } else if (ch === '[') {
      depth++;
    } else if (ch === ']') {
      if (depth === 0) return content.slice(start, i);
      depth--;
    }
  }
  return null;
}

// pyproject.toml: PEP 621 inline/multiline dependency arrays; Poetry/PDM section keys.
function parsePyprojectDeps(content: string): Set<string> {
  const stripped = stripTomlComments(stripTomlMultilineStrings(content));
  const names = new Set<string>();
  const norm = (s: string) => s.toLowerCase().replace(/[-_.]+/g, '-');

  // PEP 621 / PDM / Hatch: dependencies = ["pkg>=1.0", ...] possibly multiline.
  // Bracket counting correctly handles package extras like "uvicorn[standard]".
  const arrayContent = extractTomlArrayContent(stripped, 'dependencies');
  if (arrayContent !== null) {
    for (const m of arrayContent.matchAll(/"([^"]+)"|'([^']+)'/g)) {
      const spec = (m[1] ?? m[2]).trim();
      const name = spec.match(/^([A-Za-z0-9]([A-Za-z0-9._-]*[A-Za-z0-9])?)/)?.[1];
      if (name) names.add(norm(name));
    }
  }

  // Poetry: [tool.poetry.dependencies], [tool.poetry.dev-dependencies],
  //         [tool.poetry.group.<name>.dependencies]. Parse line-by-line so
  //         `[` inside inline table values (e.g., extras = ["standard"]) does
  //         not prematurely end the section.
  const sectionHeaderRe = /^\[tool\.poetry(?:\.group\.[^\]]+)?\.(?:dev-)?dependencies\]$/;
  const allLines = stripped.split('\n');
  for (let i = 0; i < allLines.length; i++) {
    if (!sectionHeaderRe.test(allLines[i].trim())) continue;
    for (let j = i + 1; j < allLines.length; j++) {
      const line = allLines[j].trim();
      if (!line) continue;
      if (line.startsWith('[')) break; // next TOML section header
      // Match key before = or { (handles string values and inline tables alike)
      const key = line.match(/^([A-Za-z0-9]([A-Za-z0-9._-]*[A-Za-z0-9])?)\s*[={]/)?.[1];
      // Skip 'python' — it's a Python version constraint, not a package
      if (key && key.toLowerCase() !== 'python') names.add(norm(key));
    }
  }

  return names;
}

export function hasPythonDependency(names: string[]): boolean {
  const normalized = names.map((n) => n.toLowerCase().replace(/[-_.]+/g, '-'));

  const reqPath = path.join(root, 'requirements.txt');
  if (fs.existsSync(reqPath)) {
    const pkgs = parsePythonPackageNames(fs.readFileSync(reqPath, 'utf8'));
    if (normalized.some((n) => pkgs.has(n))) return true;
  }

  const pipfilePath = path.join(root, 'Pipfile');
  if (fs.existsSync(pipfilePath)) {
    const pkgs = parsePipfileDeps(fs.readFileSync(pipfilePath, 'utf8'));
    if (normalized.some((n) => pkgs.has(n))) return true;
  }

  const pyprojectPath = path.join(root, 'pyproject.toml');
  if (fs.existsSync(pyprojectPath)) {
    const pkgs = parsePyprojectDeps(fs.readFileSync(pyprojectPath, 'utf8'));
    if (normalized.some((n) => pkgs.has(n))) return true;
  }

  return false;
}

// Returns every stack the project signals, in selection-priority order. The
// first entry is what `--profile auto` installs; later entries let us warn when
// e.g. a monorepo also carries Next.js or API signals.
export function detectProjectStacks(): string[] {
  const packageJson = getProjectPackageJson();
  const stacks: string[] = [];

  if (fileExists('src-tauri') || fileExists('tauri.conf.json') || fileExists('tauri.conf.json5')) stacks.push('tauri');
  if (fileExists('pnpm-workspace.yaml') || fileExists('turbo.json') || fileExists('nx.json') || fileExists('lerna.json') || packageJson?.workspaces) stacks.push('monorepo');
  if (hasDependency(packageJson, ['next']) || fileExists('next.config.js') || fileExists('next.config.mjs') || fileExists('next.config.ts')) stacks.push('nextjs');
  if (hasDependency(packageJson, ['express', 'fastify', '@nestjs/core', 'hono', 'koa'])) stacks.push('node-api');
  const hasPythonProjectFiles = fileExists('pyproject.toml') || fileExists('requirements.txt') || fileExists('uv.lock') || fileExists('poetry.lock') || fileExists('Pipfile');
  if (hasPythonProjectFiles) {
    const hasFastAPI = hasPythonDependency(['fastapi']);
    const hasDjango = hasPythonDependency(['django']);
    if (hasFastAPI) stacks.push('fastapi');
    if (hasDjango) stacks.push('django');
    if (!hasFastAPI && !hasDjango) stacks.push('python-api');
  }
  if (hasDependency(packageJson, ['react-native', 'expo'])) {
    stacks.push('react-native');
  } else if (fileExists('pubspec.yaml') || fileExists('ios') || fileExists('android')) {
    stacks.push('mobile');
  }
  // Non-JS/Python ecosystems — appended last with lower selection priority.
  // A polyglot repo may still detect these alongside JS/Python stacks.
  if (fileExists('go.mod')) stacks.push('go');
  if (fileExists('Cargo.toml')) stacks.push('rust');

  return stacks;
}

export function detectProjectProfile(): string | null {
  return detectProjectStacks()[0] ?? null;
}

export function detectMonorepoSecondaryStack(): string | null {
  const stacks = detectProjectStacks();
  if (stacks[0] !== 'monorepo') return null;
  return stacks.find((stack) => stack !== 'monorepo') ?? null;
}

export function detectConfidence(): 'unknown' | 'confident' | 'ambiguous' {
  const primaryStacks = detectProjectStacks().filter((s) => s !== 'monorepo');
  if (primaryStacks.length === 0) return 'unknown';
  return primaryStacks.length > 1 ? 'ambiguous' : 'confident';
}

// The monorepo profile is intentionally generic; if the repo also signals a
// concrete stack (Next.js, an API framework, etc.) the stack-specific workflow
// is not bundled, so surface that instead of silently dropping it.
export function warnMonorepoSecondaryStack(installedProfile: string): void {
  const components = parseCompositeProfile(installedProfile);
  if (!components.includes('monorepo')) return;
  if (components.length > 1) return;
  const stacks = detectProjectStacks();
  const secondary = stacks.filter((s) => s !== 'monorepo');
  if (secondary.length === 0) return;
  const label = secondary.length === 1 ? secondary[0] : secondary.join(', ');
  const suggestion = stacks.join('+');
  console.log(`note: detected monorepo + ${label}; consider --profile ${suggestion} for combined guidance`);
}

export function resolveProfile(profile: string): { status: 'ok' | 'none' | 'invalid' | 'unknown'; profile: string; detail: string } {
  const normalized = normalizeProfile(profile);
  if (normalized === 'base' || normalized === 'none') {
    return { status: 'none', profile: 'base', detail: 'base harness only' };
  }

  let resolvedProfile: string | null;
  if (normalized === 'auto') {
    resolvedProfile = detectProjectProfile();
    if (!resolvedProfile) {
      return { status: 'unknown', profile: 'base', detail: 'auto profile could not detect a supported stack' };
    }
    if (detectConfidence() === 'ambiguous') {
      // Include all detected stacks (including monorepo) in the suggestion.
      const allDetected = detectProjectStacks();
      const suggestion = allDetected.join('+');
      console.log(
        `note: multiple stacks detected (${allDetected.join(', ')}); installing ${resolvedProfile}. ` +
        `For combined guidance use --profile ${suggestion}.`
      );
    }
  } else {
    resolvedProfile = normalized;
  }

  // Structural validation of the composite form.
  const rawParts = parseCompositeProfile(resolvedProfile);
  if (rawParts.some((p) => p === '')) {
    return {
      status: 'invalid',
      profile: resolvedProfile,
      detail: 'invalid composite: profile contains an empty component (check for leading, trailing, or consecutive "+")'
    };
  }
  const seen = new Set<string>();
  for (const part of rawParts) {
    if (part === 'base' || part === 'none') {
      return {
        status: 'invalid',
        profile: resolvedProfile,
        detail: `"${part}" cannot be used as a composite component`
      };
    }
    if (seen.has(part)) {
      return {
        status: 'invalid',
        profile: resolvedProfile,
        detail: `duplicate profile component "${part}" in composite "${resolvedProfile}"`
      };
    }
    seen.add(part);
  }

  const availableProfiles = getAvailableProfiles();
  for (const component of rawParts) {
    if (!availableProfiles.includes(component)) {
      return {
        status: 'invalid',
        profile: resolvedProfile,
        detail: `unknown profile component "${component}". Available profiles: ${availableProfiles.join(', ') || 'none'}`
      };
    }
  }

  const detail = normalized === 'auto'
    ? `auto detected ${resolvedProfile}`
    : rawParts.length > 1
      ? `composite: ${rawParts.join(' + ')}`
      : resolvedProfile;

  return { status: 'ok', profile: resolvedProfile, detail };
}

export function runCheckProfile(): void {
  console.log('ForgeAI profile check');
  console.log('');

  const manifestResult = readManifestResult();

  if (manifestResult.state === 'invalid') {
    console.log(formatStatus('invalid', `.ai/manifest.json: ${manifestResult.reason}`));
    console.log('');
    console.log('Result: manifest is corrupt. Re-run forgeai-init --upgrade --profile <name> to recover.');
    process.exitCode = 1;
    return;
  }

  const manifest = manifestResult.state === 'valid' ? manifestResult.data : null;
  const rawProfile: unknown = manifest?.profile;
  if (manifest && typeof rawProfile !== 'string') {
    console.log(formatStatus('invalid', `.ai/manifest.json profile field has wrong type (expected string, got ${Array.isArray(rawProfile) ? 'array' : typeof rawProfile})`));
    console.log('');
    console.log('Result: installed profile is corrupt. Re-run forgeai-init --upgrade --profile <name> to fix.');
    process.exitCode = 1;
    return;
  }
  const installedProfile = (rawProfile as string | undefined) ?? 'base';
  const detectedProfile = detectProjectProfile();
  const availableProfiles = getAvailableProfiles();

  const confidence = detectConfidence();
  const detectedLabel = detectedProfile
    ? `${detectedProfile} (${confidence})`
    : 'no supported stack profile detected (confidence: unknown)';

  console.log(formatStatus(manifest ? 'ok' : 'missing', manifest ? `.ai/manifest.json profile: ${installedProfile}` : '.ai/manifest.json'));
  console.log(formatStatus(detectedProfile ? 'detected' : 'unknown', detectedLabel));
  console.log(formatStatus('available', availableProfiles.join(', ') || 'none'));
  warnMonorepoSecondaryStack(installedProfile);

  if (!manifest) {
    console.log('');
    console.log('Result: profile unknown. Re-run forgeai-init with --profile <name> or --profile auto to create a manifest.');
    process.exitCode = 1;
    return;
  }

  if (installedProfile === 'base') {
    console.log('');
    console.log('Result: base harness installed. Run forgeai-init --upgrade --profile <name> to add stack-specific guidance if needed.');
    return;
  }

  // Validate composite structure from manifest (catches manually corrupted manifests).
  const rawParts = parseCompositeProfile(installedProfile);
  if (rawParts.some((p) => p === '')) {
    console.log(formatStatus('invalid', `manifest profile "${installedProfile}" has an invalid composite structure (empty component)`));
    console.log('');
    console.log('Result: installed profile is corrupt. Re-run forgeai-init --upgrade --profile <name> to fix.');
    process.exitCode = 1;
    return;
  }
  const seenParts = new Set<string>();
  for (const part of rawParts) {
    if (part === 'base' || part === 'none' || seenParts.has(part)) {
      console.log(formatStatus('invalid', `manifest profile "${installedProfile}" contains invalid component "${part}"`));
      console.log('');
      console.log('Result: installed profile is corrupt. Re-run forgeai-init --upgrade --profile <name> to fix.');
      process.exitCode = 1;
      return;
    }
    seenParts.add(part);
  }
  const components = rawParts;

  let missingProfileFiles = 0;
  let hasInvalidComponent = false;

  for (const component of components) {
    const componentPath = profilePath(component);
    if (!fs.existsSync(componentPath)) {
      console.log(formatStatus('invalid', `profile component "${component}" is not supported by this package version`));
      hasInvalidComponent = true;
      continue;
    }
    const requiredFiles = listFilesRecursive(componentPath);
    for (const relativePath of requiredFiles) {
      const exists = fs.existsSync(path.join(root, relativePath));
      if (!exists) missingProfileFiles += 1;
      console.log(formatStatus(exists ? 'ok' : 'missing', relativePath));
    }
  }

  if (hasInvalidComponent) {
    console.log('');
    console.log('Result: installed profile is not recognized.');
    process.exitCode = 1;
    return;
  }

  // Mismatch: at least one installed component must appear in detected stacks.
  // If no stacks detected, skip (cannot judge).
  const detectedStacks = detectProjectStacks();
  if (detectedStacks.length > 0 && !components.some((c) => detectedStacks.includes(c))) {
    const primaryDetected = detectedStacks.filter((s) => s !== 'monorepo');
    const detectedDisplay = primaryDetected.length > 0 ? primaryDetected.join(', ') : detectedStacks.join(', ');
    console.log('');
    console.log(`Result: profile mismatch. Installed "${installedProfile}", but project signals look like ${detectedDisplay}.`);
    process.exitCode = 1;
    return;
  }

  if (missingProfileFiles > 0) {
    console.log('');
    console.log(`Result: profile files are incomplete. Re-run forgeai-init --upgrade --profile ${installedProfile}.`);
    process.exitCode = 1;
    return;
  }

  console.log('');
  console.log('Result: profile installed and consistent.');
}

// Aggregates the harness, CodeGraph, lifecycle, and profile checks into one
// pass so an agent or CI step gets a single readiness verdict. CodeGraph is run
// in strict mode here: a still-template graph means the harness is not ready.
// Each underlying check only sets process.exitCode on failure (never resets it
// to 0), so the aggregated exit code reflects any sub-check failure.
