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

// Exported so unit tests can call it with arbitrary arg arrays without spawning a child process.
// Returns null if valid, or an error string if invalid.
export function validateArgFlag(name: string, argv: string[]): string | null {
  let occurrences = 0;
  for (let _i = 0; _i < argv.length; _i++) {
    const arg = argv[_i];
    if (arg === name) {
      const next = argv[_i + 1];
      if (next === undefined || next.startsWith('--')) return `${name} requires a value`;
      if (next.trim() === '') return `${name} requires a non-whitespace value`;
      occurrences++;
      if (occurrences > 1) return `${name} cannot be specified more than once`;
    } else if (arg.startsWith(`${name}=`)) {
      const val = arg.slice(name.length + 1);
      if (val === '' || val.trim() === '') return `${name} requires a value`;
      if (val.startsWith('--')) return `${name} value must not start with "--"`;
      occurrences++;
      if (occurrences > 1) return `${name} cannot be specified more than once`;
    }
  }
  return null;
}

// Eagerly validate value-requiring flags at module load: rejects bare flags, empty/whitespace values,
// values starting with "--", and duplicate occurrences. Value check runs before the duplicate count
// so a bare trailing flag reports the most actionable error ("requires a value", not "specified more than once").
for (const name of ['--profile', '--emit', '--adapter', '--model'] as const) {
  const err = validateArgFlag(name, rawArgs);
  if (err) { process.stderr.write(`${err}\n`); process.exit(1); }
}

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
export const refreshCodeGraph = args.has('--refresh-codegraph');
export const checkProfile = args.has('--check-profile');
export const checkAll = args.has('--check-all');
export const checkReview = args.has('--check-review');
export const checkSecurity = args.has('--check-security');
export const checkMemory = args.has('--check-memory');
export const strict = args.has('--strict');
export const listProfiles = args.has('--list-profiles');
export const checkUpdates = args.has('--check-updates');
export const checkUpgrade = args.has('--check-upgrade');
export const isProfileExplicit = getArgValue('--profile') !== null;
export const addModel = args.has('--add-model');
export const listModels = args.has('--list-models');
export const removeModel = args.has('--remove-model');
export const decompose = args.has('--decompose');
export const contextPack = args.has('--context-pack');
export const compileContext = args.has('--compile-context');
export const checkApproval = args.has('--check-approval');
export const checkEvaluation = args.has('--check-evaluation');
export const statusSummary = args.has('--status-summary');
export const diffSummary = args.has('--diff-summary');
export const testSummary = args.has('--test-summary');
export const skipUpdateCheck = args.has('--skip-update-check') || process.env.FORGEAI_SKIP_UPDATE_CHECK === '1';
export const watch = args.has('--watch');
export const emit = args.has('--emit');
export const emitPayload = getArgValue('--emit');
export const validateArtifact = args.has('--validate-artifact');
export const route = args.has('--route');
export const stream = args.has('--stream');
export const expandContext = args.has('--expand-context');
export const listRuns = args.has('--list-runs');

export function getArgValue(name: string): string | null {
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (arg === name) return rawArgs[index + 1] ?? null;
    if (arg.startsWith(`${name}=`)) return arg.slice(name.length + 1);
  }

  return null;
}

export const requestedProfile = getArgValue('--profile') ?? 'base';
