import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export type RouterPayload = {
  status?: string;
  reason?: string;
  behavior?: string;
  provider?: string;
  command?: string;
  args?: string[];
  input?: string;
};

export type ExecError = Error & {
  stdout?: string | Buffer;
  stderr?: string | Buffer;
  status?: number;
};

export type HarnessManifest = {
  package_version?: string;
  profile?: string;
};

export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tsxLoader = pathToFileURL(path.join(projectRoot, 'node_modules', 'tsx', 'dist', 'loader.mjs')).href;

export const cli = path.join(projectRoot, 'bin/forgeai-init.ts');

export function parseRouterPayload(output: string): RouterPayload {
  return JSON.parse(output) as RouterPayload;
}

export function runTs(file: string, args: string[], options: Parameters<typeof execFileSync>[2] = {}): string {
  return execFileSync(process.execPath, ['--import', tsxLoader, file, ...args], {
    ...options,
    encoding: 'utf8'
  }) as string;
}
