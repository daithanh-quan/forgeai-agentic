import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { root, templateDir, dryRun, force, upgrade, requestedProfile, isProfileExplicit } from './context.js';
import { readManifestResult, writeManifest } from './manifest.js';
import { resolveProfile, profilePath, warnMonorepoSecondaryStack, parseCompositeProfile, detectConfidence, normalizeProfile } from './profiles.js';
import { compareSemver, getPackageVersion, getErrorMessage, formatStatus, parseSemver } from './utils.js';
import { collectMigrationNotes, printMigrationNotes } from './upgrade-notes.js';

export function usage(): string {
  return `Usage:
  forgeai-init [--dry-run] [--force] [--profile <name|auto>]
  forgeai-init try "<objective>"
  forgeai-init --repair-codegraph
  forgeai-init --upgrade
  forgeai-init --check
  forgeai-init --check-updates
  forgeai-init --check-upgrade
  forgeai-init --check-git
  forgeai-init --check-sessions
  forgeai-init --check-lifecycle
  forgeai-init --check-codegraph [--strict]
  forgeai-init --refresh-codegraph
  forgeai-init --check-profile
  forgeai-init --check-all
  forgeai-init --check-review
  forgeai-init --check-security
  forgeai-init --check-memory
  forgeai-init --check-approval
  forgeai-init --check-evaluation
  forgeai-init --decompose --objective "<description>" [--compact] [--output <file>]
  forgeai-init --context-pack --objective "<description>" [--max-depth <0-5>] [--max-nodes <1-50>] [--include-excluded "<glob>[,<glob>...]"] [--output <file>]
  forgeai-init --compile-context --objective "<description>" [--task <id>] [--mode baseline|compact] [--experiment <EXP-id>] [--budget <tokens>] [--include-excluded "<glob>[,<glob>...]"] [--output <json>]
  forgeai-init --expand-context --artifact <path> --need-context <path> [--budget <tokens>] [--include-excluded "<glob>[,<glob>...]"] [--output <json>]
  forgeai-init --status-summary
  forgeai-init --diff-summary
  forgeai-init --test-summary
  forgeai-init --watch
  forgeai-init --emit '<json>'
  forgeai-init --list-profiles
  forgeai-init --add-model <provider> [--model <id>] [options]
  forgeai-init --list-models
  forgeai-init --remove-model <provider>
  forgeai-init --version
  forgeai-init --help

Options:
  --repair-codegraph
                Restore a malformed .ai/codegraph/graph.json from the
                package template. Creates a uniquely named backup first.
                Refuses if the file is already valid JSON or cannot be read.
  try           Preview ForgeAI context selection for an objective without
                initializing. Reads source files, detects languages, and
                prints the files that would be selected — no .ai/ required,
                no file writes, no network calls after the package is local.
  --dry-run     Print files that would be created without writing them.
  --force       Overwrite existing harness files during initialization.
  --upgrade     Overwrite installed ForgeAI harness files with this package version.
  --profile     Apply an optional stack profile: auto, nextjs, sveltekit, node-api,
                tauri, monorepo, python-api, mobile, go, rust, fastapi, django,
                or react-native.
                Combine profiles with +: --profile nextjs+monorepo.
  --check       Validate installed ForgeAI harness files and model adapters.
  --check-updates
                Check npm for the latest ForgeAI version, even in non-interactive mode.
  --check-upgrade
                Compare the installed harness version (.ai/manifest.json
                package_version) to the running CLI version. Outcomes: ok
                (match, exits 0), outdated (harness older, exits 1),
                cli-too-old (harness newer, exits 1). No network access —
                suitable for CI use.
  --check-git   Validate git branch, worktree, remote, hooks, and PR/MR tooling.
  --check-sessions
                Validate active agent sessions for overlapping write scopes.
  --check-lifecycle
                Validate lifecycle state files and task journals.
  --check-codegraph
                Validate CodeGraph artifacts for graph-guided context selection.
                Add --strict to exit non-zero when the graph is still a template.
  --refresh-codegraph
                Parse TypeScript, JavaScript, Python, and Go source files and
                write a deterministic dependency graph. This is the only command
                that updates .ai/codegraph/dependency-graph.json.
  --check-profile
                Validate the installed profile against detected project signals.
  --check-all   Run the harness, CodeGraph (strict), lifecycle, profile,
                review, security, memory, approval, and evaluation checks
                together and return one aggregated exit code.
  --check-review
                Validate that gated task journals carry real validation
                evidence and a completed reviewer scorecard before merge.
  --check-security
                Scan for supply-chain risks (pipe-to-shell installs,
                off-registry/unpinned deps, install scripts, private keys)
  --check-memory
                Validate .ai/MEMORY.md for stale knowledge (dead path
                references, leftover TODOs, over-age entries, malformed
                decision entries).
  --check-approval
                Fail when high-risk task journals in gated lifecycle states
                (review, revision, acceptance, delivery, closed) lack an
                ## Approval section with a human sign-off date.
  --check-evaluation
                [deprecated] Validate the manual .ai/evaluation/*.md run files.
                Superseded by --evaluate / --report.
  --evaluate --task <id> [--outcome pass|fail --reason "<text>" [--by "<name>"]]
             [--clear-outcome] [--force]
                Build a structured evaluation record for a task from its review
                scorecard, journal, run records, and context artifact. For a
                "Needs human decision" verdict, --outcome pass|fail (with a
                required --reason, and optional --by naming the decider) records a
                human override with provenance. Re-evaluating without override
                flags PRESERVES an existing override while its verdict is still
                "Needs human decision" (refreshing metrics only); if the verdict
                has changed, or the prior record is corrupt, it exits 1 — use
                --clear-outcome to re-derive, --outcome to re-decide, or --force to
                overwrite a corrupt record. Do not run --evaluate on one task
                concurrently (last-writer-wins; no locking).
  --report [--json] [--min-samples <n>]
                Aggregate evaluation records by model tier (pass rate, token
                cost, latency, retries) plus a baseline/compact experiments
                section with an advisory, and a Routing advisory (lowest-token
                tier within tolerance). --json emits the aggregate for CI;
                --min-samples overrides both sample gates: the experiment
                advisory pair threshold and the routing tier sample gate.
  --decompose   Emit a scored task decomposition template for an objective.
                Requires --objective "<description>". Add --compact for a
                smaller delegation-ready assignment plan. Use --output <file>
                to write to a file instead of stdout.
  --context-pack
                Emit a dependency-aware context pack for an objective. Refuses
                missing or stale generated graphs. Requires --objective.
                Defaults: --max-depth 2 and --max-nodes 12. Use --output <file>
                to write to a file instead of stdout.
  --compile-context
                Compile selected source nodes (TypeScript, JavaScript, Python,
                Go) into a bounded JSON artifact. Requires a fresh dependency graph and
                --objective. Defaults: --budget 6000, --max-depth 2,
                --max-nodes 12. With --output, also writes a Markdown rendering;
                override its path with --markdown-output <file>.
  --validate-artifact
                Validate a compiled context artifact: checks schema, structure,
                dependency graph health, fingerprint, path membership, and token
                estimate consistency. Requires --artifact <path>.
  --route       Route a compiled context artifact to a configured adapter.
                Checks .ai/api-adapters.json first (Anthropic, OpenAI, Gemini
                via native API), then .ai/cli-adapters.json. Requires
                --artifact <path>. Optional: --adapter <name>, --model <id>.
                API keys via env vars: ANTHROPIC_API_KEY, OPENAI_API_KEY,
                GOOGLE_API_KEY. Never add keys to project files.
  --list-runs   Print all API adapter run records from .ai/state/runs/.
  --expand-context
                Validate a need_context request and compile a supplemental context
                artifact containing only the additionally requested symbols, files,
                or tests. Requires --artifact <path> and --need-context <path>.
                Use --budget <tokens> to override the default (remaining primary
                capacity). With --output <json>, also writes a Markdown rendering.
  --include-excluded "<glob>[,<glob>...]"
                Keep paths the active profile would otherwise exclude, for
                --context-pack, --compile-context, and --expand-context. Globs are
                repo-relative; absolute paths and "."/".." segments are rejected.
  --status-summary
                Emit a compact markdown summary of git status (branch, last
                commit, staged/unstaged/untracked counts, file list). Fallback
                for environments without rtk.
  --diff-summary
                Emit a structured Markdown summary of git diff --numstat HEAD
                (changed files table, exact insertions/deletions). Fallback for
                environments without rtk.
  --test-summary
                Auto-detect scripts from package.json (typecheck, lint, test,
                build), run each in order, and emit a compact markdown report
                with per-script pass/fail and duration. Stops at first failure.
                Fallback for environments without rtk.
  --watch       Start the terminal orchestration monitor. It reads NDJSON
                workflow events from .forgeai.pipe or FORGEAI_PIPE.
  --emit <json> Write one manual workflow event to the terminal monitor pipe.
                Router-based delegation emits assignment lifecycle events
                automatically when the monitor is running.
  --skip-update-check
                Skip the npm latest-version preflight check.
  --list-profiles
                Print supported profile names.
  --add-model <provider>
                Register your own model CLI as a routable adapter in
                .ai/cli-adapters.json. Defaults: --command <provider>,
                --args ["--model","{model}"], --input stdin,
                --healthcheck-args ["--version"], --healthcheck-timeout 5000.
  --model <id>  Model id for the adapter; required with --tier.
  --command <cmd>
                Executable to invoke (defaults to the provider name).
  --args <json|csv>
                Adapter args; keep the {model} placeholder, not a literal id.
  --input <stdin|argv>
                How the assignment is passed to the CLI (default stdin).
  --healthcheck-args <csv>
                Healthcheck args used to detect a missing CLI (default --version).
  --healthcheck-timeout <ms>
                Healthcheck timeout in milliseconds (default 5000).
  --quota-patterns <csv>
                Output substrings that signal quota/rate-limit failures.
  --tier <fast|standard|strong>
                Also repoint this routing tier in .ai/model-routing.yaml at the
                new provider/model. Omit to leave routing untouched.
  --list-models Print configured adapters and whether each CLI is on PATH.
  --remove-model <provider>
                Delete an adapter from .ai/cli-adapters.json.
  --version     Print the package version.
  --help        Print this help text.
`;
}

// Files/dirs that hold project- or run-specific content populated by the
// agent or human, plus user-tuned routing config (cli-adapters.json,
// model-routing.yaml) that may carry custom providers added via --add-model,
// and the security policy that may carry human-approved exceptions.
// On --upgrade they are preserved if they already exist so an upgrade never
// clobbers a populated CodeGraph, project context, run state, or custom models.
// They remain overwritable with explicit --force.
export const PRESERVE_ON_UPGRADE_FILES = new Set([
  '.ai/PROJECT.md',
  '.ai/MEMORY.md',
  '.ai/AGENT_REGISTRY.md',
  '.ai/cli-adapters.json',
  '.ai/api-adapters.json',
  '.ai/model-routing.yaml',
  '.ai/security-policy.yaml',
  '.ai/codegraph/graph.json',
  '.ai/codegraph/dependency-graph.json',
  '.ai/codegraph/hotspots.md',
  '.ai/state/CURRENT.md',
  '.ai/state/sessions.md'
]);

// Run state populated by agent/human is preserved; harness-managed templates and
// reference docs under .ai/state (lifecycle.md, the task journal template, smoke
// assignments) keep updating on upgrade. Real per-task journals are run state.
export function isPreservedOnUpgrade(dest: string): boolean {
  const relative = path.relative(root, dest).split(path.sep).join('/');
  if (PRESERVE_ON_UPGRADE_FILES.has(relative)) return true;
  if (/^\.ai\/state\/tasks\/.+\.md$/.test(relative) && relative !== '.ai/state/tasks/_template.md') {
    return true;
  }
  if (/^\.ai\/state\/reviews\/.+\.md$/.test(relative) && relative !== '.ai/state/reviews/_template.md') {
    return true;
  }
  if (/^\.ai\/state\/evaluations\/.+\.json$/.test(relative)) {
    return true;
  }
  if (/^\.ai\/state\/context-escapes\/.+\.json$/.test(relative)) {
    return true;
  }
  return false;
}

export function computeFileAction(src: string, dest: string): 'create' | 'update' | 'unchanged' {
  if (!fs.existsSync(dest)) return 'create';
  return fs.readFileSync(src).equals(fs.readFileSync(dest)) ? 'unchanged' : 'update';
}

export function copyRecursive(src: string, dest: string): void {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    if (!dryRun) fs.mkdirSync(dest, { recursive: true });
    for (const item of fs.readdirSync(src)) copyRecursive(path.join(src, item), path.join(dest, item));
    return;
  }
  if (fs.existsSync(dest)) {
    if (upgrade && !force && isPreservedOnUpgrade(dest)) {
      console.log(`preserved ${path.relative(root, dest).split(path.sep).join('/')}`);
      return;
    }
    if (!force && !upgrade) {
      console.log(`skip ${path.relative(root, dest).split(path.sep).join('/')} already exists. Use --force or --upgrade to overwrite.`);
      return;
    }
  }

  const relativePath = path.relative(root, dest).split(path.sep).join('/');

  if (upgrade) {
    const action = computeFileAction(src, dest);
    if (dryRun) {
      if (action === 'unchanged') console.log(`no change ${relativePath}`);
      else console.log(`would ${action} ${relativePath}`);
      return;
    }
    if (action === 'unchanged') {
      console.log(`no change ${relativePath}`);
      return;
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
    console.log(`${action === 'update' ? 'updated' : 'created'} ${relativePath}`);
    return;
  }

  if (dryRun) {
    console.log(`would create ${relativePath}`);
    return;
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  console.log(`created ${relativePath}`);
}

const CONTEXT_GITIGNORE_ENTRIES = ['.ai/state/context/', '.ai/state/context-routes.md', '.ai/state/runs/', '.ai/state/evaluations/', '.ai/state/context-escapes/'];

export function maintainContextGitignore(repositoryRoot: string, isDryRun: boolean): void {
  const gitignorePath = path.join(repositoryRoot, '.gitignore');
  let existing = '';
  if (fs.existsSync(gitignorePath)) {
    existing = fs.readFileSync(gitignorePath, 'utf8');
  }
  const existingLines = existing.split('\n');
  const missing = CONTEXT_GITIGNORE_ENTRIES.filter((entry) => !existingLines.includes(entry));
  if (missing.length === 0) return;
  if (isDryRun) {
    for (const entry of missing) {
      console.log(`would append ${entry} to .gitignore`);
    }
    return;
  }
  let content = existing;
  if (content.length > 0 && !content.endsWith('\n')) content += '\n';
  content += missing.join('\n') + '\n';
  fs.writeFileSync(gitignorePath, content);
}

const CODEGRAPH_GITIGNORE_ENTRIES = ['graph.json.backup.*', 'graph.json.tmp.*'];

function maintainCodeGraphGitignore(gitignorePath: string, isDryRun = false): void {
  try {
    const existing = fs.existsSync(gitignorePath) ? fs.readFileSync(gitignorePath, 'utf-8') : '';
    const existingLines = new Set(existing.split('\n').map((l) => l.trim()));
    const missing = CODEGRAPH_GITIGNORE_ENTRIES.filter((p) => !existingLines.has(p));
    if (missing.length === 0) return;
    if (isDryRun) {
      for (const p of missing) console.log(`would append ${p} to .ai/codegraph/.gitignore`);
      return;
    }
    const sep = existing.length > 0 && !existing.endsWith('\n') ? '\n' : '';
    fs.writeFileSync(gitignorePath, existing + sep + missing.join('\n') + '\n');
  } catch (err) {
    process.stderr.write(`Warning: could not write .ai/codegraph/.gitignore (${getErrorMessage(err)}). Check git status before committing.\n`);
  }
}

interface RepairCodeGraphOptions {
  graphPath?: string;
  templateGraphPath?: string;
  gitignorePath?: string;
  randomSuffix?: () => string;
}

export function runRepairCodeGraph({
  graphPath = path.join(root, '.ai', 'codegraph', 'graph.json'),
  templateGraphPath = path.join(templateDir, '.ai', 'codegraph', 'graph.json'),
  gitignorePath = path.join(path.dirname(graphPath), '.gitignore'),
  randomSuffix = () => crypto.randomBytes(4).toString('hex'),
}: RepairCodeGraphOptions = {}): void {
  if (!fs.existsSync(graphPath)) {
    process.stderr.write('Error: .ai/codegraph/graph.json not found — nothing to repair.\n');
    process.exitCode = 1;
    return;
  }
  let content: string;
  try {
    content = fs.readFileSync(graphPath, 'utf-8');
  } catch (err) {
    process.stderr.write(`Error: could not read .ai/codegraph/graph.json (${getErrorMessage(err)}).\n`);
    process.exitCode = 1;
    return;
  }
  try {
    JSON.parse(content);
    console.log(formatStatus('ok', '.ai/codegraph/graph.json is already valid JSON — nothing to repair.'));
    return;
  } catch { /* JSON parse failed — proceed with repair */ }

  maintainCodeGraphGitignore(gitignorePath);

  const MAX_RETRY = 10;
  let tmpPath: string | undefined;
  try {
    let backupPath: string;
    for (let attempt = 0; ; attempt++) {
      if (attempt >= MAX_RETRY) throw new Error('could not create unique backup path after 10 attempts');
      backupPath = `${graphPath}.backup.${randomSuffix()}`;
      try {
        fs.copyFileSync(graphPath, backupPath, fs.constants.COPYFILE_EXCL);
        break;
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      }
    }

    for (let attempt = 0; ; attempt++) {
      if (attempt >= MAX_RETRY) throw new Error('could not create unique tmp path after 10 attempts');
      const candidate = `${graphPath}.tmp.${randomSuffix()}`;
      try {
        fs.copyFileSync(templateGraphPath, candidate, fs.constants.COPYFILE_EXCL);
        tmpPath = candidate;
        break;
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      }
    }

    let tmpContent: string;
    try {
      tmpContent = fs.readFileSync(tmpPath, 'utf-8');
    } catch (err) {
      throw new Error(`could not read template copy (${getErrorMessage(err)})`);
    }
    try {
      JSON.parse(tmpContent);
    } catch {
      throw new Error('template graph.json is not valid JSON — cannot repair');
    }

    fs.renameSync(tmpPath, graphPath);
    tmpPath = undefined;

    console.log(formatStatus('ok', `repaired .ai/codegraph/graph.json (backup: ${path.relative(root, backupPath!)})`));
  } catch (err) {
    if (tmpPath) { try { fs.unlinkSync(tmpPath); } catch { /* ignore */ } }
    process.stderr.write(`Error: codegraph repair failed (${getErrorMessage(err)}).\n`);
    process.exitCode = 1;
  }
}

export function runInit(): void {
  const manifestResult = readManifestResult();
  const manifest = manifestResult.state === 'valid' ? manifestResult.data : null;
  const manifestProfile = manifest?.profile;
  const installedVersion = upgrade ? (manifest?.package_version ?? null) : null;
  const currentVersion = getPackageVersion();

  if (
    upgrade &&
    installedVersion &&
    parseSemver(installedVersion) &&
    parseSemver(currentVersion) &&
    compareSemver(installedVersion, currentVersion) > 0
  ) {
    console.error(
      `refusing downgrade: harness ${installedVersion} > CLI ${currentVersion}. ` +
      `Use a CLI version equal to or newer than the installed harness.`
    );
    process.exitCode = 1;
    return;
  }

  // Under --upgrade without an explicit --profile, a corrupt or unreadable manifest
  // cannot tell us which profile to reinstall — error rather than silently clobber.
  if (upgrade && !isProfileExplicit && manifestResult.state === 'invalid') {
    console.error(`manifest is corrupt (${manifestResult.reason}); re-run with --profile <name> to recover`);
    process.exitCode = 1;
    return;
  }

  // A valid-JSON manifest may still have a wrong-type profile field.
  if (upgrade && !isProfileExplicit && manifest !== null && typeof (manifest.profile as unknown) !== 'string') {
    console.error(
      `manifest profile has wrong type (expected string, got ${Array.isArray(manifest.profile as unknown) ? 'array' : typeof (manifest.profile as unknown)}); ` +
      `re-run with --profile <name> to recover`
    );
    process.exitCode = 1;
    return;
  }
  const profileInput = upgrade && !isProfileExplicit ? (manifestProfile ?? requestedProfile) : requestedProfile;
  const profile = resolveProfile(profileInput);
  if (profile.status === 'invalid') {
    console.error(profile.detail);
    process.exitCode = 1;
    return;
  }

  // Reject explicit profile changes when a manifest already exists unless the
  // caller passed --upgrade (which updates the manifest) or --force. Without
  // this guard, the profile files are written but the manifest keeps the old
  // profile name — an inconsistent state that is hard to detect.
  if (isProfileExplicit && manifestResult.state !== 'missing' && !upgrade && !force) {
    const detail =
      manifestResult.state === 'valid'
        ? `current: ${String((manifestResult.data.profile as unknown) ?? 'base')}`
        : 'current manifest is corrupt';
    console.error(
      `a profile is already installed (${detail}); use --upgrade --profile ${requestedProfile} to update`
    );
    process.exitCode = 1;
    return;
  }

  copyRecursive(templateDir, root);
  if (profile.status === 'ok') {
    for (const component of parseCompositeProfile(profile.profile)) {
      copyRecursive(profilePath(component), root);
    }
  } else if (requestedProfile === 'auto' && profile.status === 'unknown') {
    console.log(`profile auto skipped: ${profile.detail}`);
  }
  writeManifest(profile.profile);
  maintainCodeGraphGitignore(path.join(root, '.ai', 'codegraph', '.gitignore'), dryRun);
  // Skip the secondary-stack note when auto-profile already logged the ambiguity
  // message; they would be duplicate suggestions for the same composite profile.
  const autoAmbiguityLogged = normalizeProfile(profileInput) === 'auto' && profile.status === 'ok' && detectConfidence() === 'ambiguous';
  if (!autoAmbiguityLogged) warnMonorepoSecondaryStack(profile.profile);
  maintainContextGitignore(root, dryRun);
  console.log(dryRun ? 'Dry run complete.' : 'ForgeAI agentic markdown kit initialized.');

  if (!dryRun && fs.existsSync(path.join(root, '.ai', 'api-adapters.json'))) {
    console.log('');
    console.log('API adapters installed in .ai/api-adapters.json');
    console.log('Set one of: ANTHROPIC_API_KEY, OPENAI_API_KEY, GOOGLE_API_KEY');
    console.log('Keys must be environment variables; never add them to project files.');
  }

  if (upgrade && !dryRun) {
    const notes = collectMigrationNotes(installedVersion, currentVersion);
    printMigrationNotes(notes);
  }
}
