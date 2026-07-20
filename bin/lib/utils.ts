import fs, { constants } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { root, packageJsonPath, packageName } from './context.js';

export function formatStatus(status: string, label: string): string {
  return `${status.padEnd(16)} ${label}`;
}

export function commandExists(command: string | undefined): boolean {
  if (!command) return false;

  if (command.includes('/') || command.includes('\\')) {
    try {
      fs.accessSync(path.resolve(root, command), constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }

  const pathEntries = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  const extensions =
    process.platform === 'win32'
      ? (process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';')
      : [''];

  for (const entry of pathEntries) {
    for (const extension of extensions) {
      try {
        fs.accessSync(path.join(entry, `${command}${extension}`), constants.X_OK);
        return true;
      } catch {
        // Keep searching PATH.
      }
    }
  }

  return false;
}

export function readJsonIfPresent<T>(relativePath: string): T | null {
  const absolutePath = path.join(root, relativePath);
  if (!fs.existsSync(absolutePath)) return null;
  return JSON.parse(fs.readFileSync(absolutePath, 'utf8')) as T;
}

export function readJsonFileIfPresent<T>(absolutePath: string): T | null {
  if (!fs.existsSync(absolutePath)) return null;
  return JSON.parse(fs.readFileSync(absolutePath, 'utf8')) as T;
}

export function countTodos(relativePath: string): number {
  const absolutePath = path.join(root, relativePath);
  if (!fs.existsSync(absolutePath)) return 0;
  const content = fs.readFileSync(absolutePath, 'utf8');
  return (content.match(/\bTODO\b/g) || []).length;
}

export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function parseSemver(versionValue: unknown): [number, number, number] | null {
  if (typeof versionValue !== 'string') return null;
  const match = versionValue.trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function compareSemver(left: string | undefined, right: string | undefined): number {
  const leftParts = parseSemver(left);
  const rightParts = parseSemver(right);
  if (!leftParts || !rightParts) return 0;

  for (let index = 0; index < leftParts.length; index += 1) {
    if (leftParts[index] > rightParts[index]) return 1;
    if (leftParts[index] < rightParts[index]) return -1;
  }

  return 0;
}

export function listFilesRecursive(directory: string, baseDirectory = directory): string[] {
  if (!fs.existsSync(directory)) return [];

  const files: string[] = [];

  for (const item of fs.readdirSync(directory)) {
    const absolutePath = path.join(directory, item);
    const stat = fs.statSync(absolutePath);

    if (stat.isDirectory()) {
      files.push(...listFilesRecursive(absolutePath, baseDirectory));
      continue;
    }

    files.push(path.relative(baseDirectory, absolutePath).split(path.sep).join('/'));
  }

  return files.sort();
}

export function getPackageVersion(): string {
  try {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as { version?: string };
    return packageJson.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

export function getLatestPackageVersion(): { version: string | null; error: string | null } {
  const mockedVersion = process.env.FORGEAI_TEST_LATEST_VERSION;
  if (mockedVersion) return { version: mockedVersion, error: null };

  const result = spawnSync('npm', ['view', packageName, 'version', '--json'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 3000,
    maxBuffer: 1024 * 1024
  });

  if (result.error) return { version: null, error: result.error.message };
  if (result.status !== 0) return { version: null, error: (result.stderr || result.stdout || 'npm view failed').trim() };

  const rawVersion = result.stdout.trim().replace(/^"|"$/g, '');
  return parseSemver(rawVersion) ? { version: rawVersion, error: null } : { version: null, error: `invalid npm version: ${rawVersion}` };
}

export function runCommand(command: string, commandArgs: string[], cwd = root): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(command, commandArgs, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 10
  });

  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? ''
  };
}

export function runGit(commandArgs: string[]): { status: number | null; stdout: string; stderr: string } {
  return runCommand('git', commandArgs);
}

export function firstNonEmptyLine(value: string): string | null {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) ?? null;
}
