import fs from 'node:fs';
import path from 'node:path';
import type { HarnessManifest } from './types.js';
import { root, packageName, dryRun, force, upgrade } from './context.js';
import { getPackageVersion, getErrorMessage } from './utils.js';

export function createManifest(profile: string): HarnessManifest {
  return {
    version: 1,
    package: packageName,
    package_version: getPackageVersion(),
    profile,
    initialized_at: new Date().toISOString()
  };
}

export function writeManifest(profile: string): void {
  const relativePath = '.ai/manifest.json';
  const destination = path.join(root, relativePath);
  const content = `${JSON.stringify(createManifest(profile), null, 2)}\n`;

  if (dryRun) {
    console.log(`would create ${relativePath}`);
    return;
  }

  if (fs.existsSync(destination) && !force && !upgrade) {
    console.log(`skip ${relativePath} already exists. Use --force or --upgrade to overwrite.`);
    return;
  }

  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, content);
  console.log(`created ${relativePath}`);
}

export type ManifestResult =
  | { state: 'missing' }
  | { state: 'invalid'; reason: string }
  | { state: 'valid'; data: HarnessManifest };

export function readManifestResult(): ManifestResult {
  const manifestPath = path.join(root, '.ai', 'manifest.json');
  if (!fs.existsSync(manifestPath)) return { state: 'missing' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    return { state: 'invalid', reason: getErrorMessage(error) };
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    const kind = parsed === null ? 'null' : Array.isArray(parsed) ? 'array' : typeof parsed;
    return { state: 'invalid', reason: `manifest content is not an object (got ${kind})` };
  }
  return { state: 'valid', data: parsed as HarnessManifest };
}

export function readManifest(): HarnessManifest | null {
  const result = readManifestResult();
  if (result.state === 'missing') return null;
  if (result.state === 'invalid') {
    console.log(`invalid .ai/manifest.json: ${result.reason} (treating as no manifest)`);
    return null;
  }
  return result.data;
}
