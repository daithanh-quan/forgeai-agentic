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

export function readManifest(): HarnessManifest | null {
  const manifestPath = path.join(root, '.ai', 'manifest.json');
  if (!fs.existsSync(manifestPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as HarnessManifest;
  } catch (error) {
    console.log(`invalid .ai/manifest.json: ${getErrorMessage(error)} (treating as no manifest)`);
    return null;
  }
}
