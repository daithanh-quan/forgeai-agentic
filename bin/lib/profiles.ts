import fs from 'node:fs';
import path from 'node:path';
import type { PackageJson } from './types.js';
import { root, profilesDir } from './context.js';
import { formatStatus, getErrorMessage, listFilesRecursive } from './utils.js';
import { readManifest } from './manifest.js';

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
  if (fileExists('pyproject.toml') || fileExists('requirements.txt') || fileExists('uv.lock') || fileExists('poetry.lock') || fileExists('Pipfile')) stacks.push('python-api');
  if (hasDependency(packageJson, ['react-native', 'expo']) || fileExists('pubspec.yaml') || fileExists('ios') || fileExists('android')) stacks.push('mobile');

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

// The monorepo profile is intentionally generic; if the repo also signals a
// concrete stack (Next.js, an API framework, etc.) the stack-specific workflow
// is not bundled, so surface that instead of silently dropping it.
export function warnMonorepoSecondaryStack(installedProfile: string): void {
  if (installedProfile !== 'monorepo') return;
  const secondary = detectMonorepoSecondaryStack();
  if (!secondary) return;
  console.log(`note: detected monorepo + ${secondary}; the monorepo profile does not bundle ${secondary}-specific workflow`);
}

export function resolveProfile(profile: string): { status: 'ok' | 'none' | 'invalid' | 'unknown'; profile: string; detail: string } {
  const normalized = normalizeProfile(profile);
  if (normalized === 'base' || normalized === 'none') {
    return { status: 'none', profile: 'base', detail: 'base harness only' };
  }

  const resolvedProfile = normalized === 'auto' ? detectProjectProfile() : normalized;
  if (!resolvedProfile) {
    return { status: 'unknown', profile: 'base', detail: 'auto profile could not detect a supported stack' };
  }

  const availableProfiles = getAvailableProfiles();
  if (!availableProfiles.includes(resolvedProfile)) {
    return {
      status: 'invalid',
      profile: resolvedProfile,
      detail: `unknown profile "${resolvedProfile}". Available profiles: ${availableProfiles.join(', ') || 'none'}`
    };
  }

  return { status: 'ok', profile: resolvedProfile, detail: normalized === 'auto' ? `auto detected ${resolvedProfile}` : resolvedProfile };
}

export function runCheckProfile(): void {
  console.log('ForgeAI profile check');
  console.log('');

  const manifest = readManifest();
  const installedProfile = manifest?.profile ?? 'base';
  const detectedProfile = detectProjectProfile();
  const availableProfiles = getAvailableProfiles();

  console.log(formatStatus(manifest ? 'ok' : 'missing', manifest ? `.ai/manifest.json profile: ${installedProfile}` : '.ai/manifest.json'));
  console.log(formatStatus(detectedProfile ? 'detected' : 'unknown', detectedProfile ?? 'no supported stack profile detected'));
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
    console.log('Result: base harness installed. Run forgeai-init --profile <name> to add stack-specific guidance if needed.');
    return;
  }

  const installedProfilePath = profilePath(installedProfile);
  if (!fs.existsSync(installedProfilePath)) {
    console.log(formatStatus('invalid', `installed profile ${installedProfile} is not supported by this package version`));
    console.log('');
    console.log('Result: installed profile is not recognized.');
    process.exitCode = 1;
    return;
  }

  const requiredProfileFiles = listFilesRecursive(installedProfilePath);
  let missingProfileFiles = 0;
  for (const relativePath of requiredProfileFiles) {
    const exists = fs.existsSync(path.join(root, relativePath));
    if (!exists) missingProfileFiles += 1;
    console.log(formatStatus(exists ? 'ok' : 'missing', relativePath));
  }

  if (detectedProfile && detectedProfile !== installedProfile) {
    console.log('');
    console.log(`Result: profile mismatch. Installed ${installedProfile}, but project signals look like ${detectedProfile}.`);
    process.exitCode = 1;
    return;
  }

  if (missingProfileFiles > 0) {
    console.log('');
    console.log('Result: profile files are incomplete. Re-run forgeai-init --profile with the same profile.');
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
