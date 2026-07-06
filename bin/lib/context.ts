import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const root = path.resolve(process.cwd());
// Modules live in bin/lib, so package assets are two levels up.
export const templateDir = path.resolve(__dirname, '../../templates');
export const profilesDir = path.resolve(__dirname, '../../profiles');
export const packageJsonPath = path.resolve(__dirname, '../../package.json');
export const packageName = 'forgeai-agentic-init';

export const rawArgs = process.argv.slice(2);
export const args = new Set(rawArgs);
export const help = args.has('--help') || args.has('-h');
export const version = args.has('--version') || args.has('-v');
export const force = args.has('--force');
export const upgrade = args.has('--upgrade');
export const dryRun = args.has('--dry-run');
export const check = args.has('--check');
export const checkGit = args.has('--check-git');
export const checkSessions = args.has('--check-sessions');
export const checkLifecycle = args.has('--check-lifecycle');
export const checkCodeGraph = args.has('--check-codegraph');
export const checkProfile = args.has('--check-profile');
export const checkAll = args.has('--check-all');
export const checkReview = args.has('--check-review');
export const checkSecurity = args.has('--check-security');
export const checkMemory = args.has('--check-memory');
export const strict = args.has('--strict');
export const listProfiles = args.has('--list-profiles');
export const checkUpdates = args.has('--check-updates');
export const addModel = args.has('--add-model');
export const listModels = args.has('--list-models');
export const removeModel = args.has('--remove-model');
export const decompose = args.has('--decompose');
export const checkApproval = args.has('--check-approval');
export const checkEvaluation = args.has('--check-evaluation');
export const skipUpdateCheck = args.has('--skip-update-check') || process.env.FORGEAI_SKIP_UPDATE_CHECK === '1';

export function getArgValue(name: string): string | null {
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (arg === name) return rawArgs[index + 1] ?? null;
    if (arg.startsWith(`${name}=`)) return arg.slice(name.length + 1);
  }

  return null;
}

export const requestedProfile = getArgValue('--profile') ?? 'base';
