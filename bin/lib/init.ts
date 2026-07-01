import fs from 'node:fs';
import path from 'node:path';
import { root, templateDir, dryRun, force, upgrade, requestedProfile } from './context.js';
import { readManifest, writeManifest } from './manifest.js';
import { resolveProfile, profilePath, warnMonorepoSecondaryStack } from './profiles.js';

export function usage(): string {
  return `Usage:
  forgeai-init [--dry-run] [--force] [--profile <name|auto>]
  forgeai-init --upgrade
  forgeai-init --check
  forgeai-init --check-updates
  forgeai-init --check-git
  forgeai-init --check-sessions
  forgeai-init --check-lifecycle
  forgeai-init --check-codegraph [--strict]
  forgeai-init --check-profile
  forgeai-init --check-all
  forgeai-init --check-review
  forgeai-init --list-profiles
  forgeai-init --add-model <provider> [--model <id>] [options]
  forgeai-init --list-models
  forgeai-init --remove-model <provider>
  forgeai-init --version
  forgeai-init --help

Options:
  --dry-run     Print files that would be created without writing them.
  --force       Overwrite existing harness files during initialization.
  --upgrade     Overwrite installed ForgeAI harness files with this package version.
  --profile     Apply an optional stack profile: auto, nextjs, node-api, tauri, monorepo, python-api, or mobile.
  --check       Validate installed ForgeAI harness files and model adapters.
  --check-updates
                Check npm for the latest ForgeAI version, even in non-interactive mode.
  --check-git   Validate git branch, worktree, remote, hooks, and PR/MR tooling.
  --check-sessions
                Validate active agent sessions for overlapping write scopes.
  --check-lifecycle
                Validate lifecycle state files and task journals.
  --check-codegraph
                Validate CodeGraph artifacts for graph-guided context selection.
                Add --strict to exit non-zero when the graph is still a template.
  --check-profile
                Validate the installed profile against detected project signals.
  --check-all   Run the harness, CodeGraph (strict), lifecycle, and profile
                checks together and return one aggregated exit code.
  --check-review
                Validate that gated task journals carry real validation
                evidence and a completed reviewer scorecard before merge.
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
// model-routing.yaml) that may carry custom providers added via --add-model.
// On --upgrade they are preserved if they already exist so an upgrade never
// clobbers a populated CodeGraph, project context, run state, or custom models.
// They remain overwritable with explicit --force.
export const PRESERVE_ON_UPGRADE_FILES = new Set([
  '.ai/PROJECT.md',
  '.ai/MEMORY.md',
  '.ai/AGENT_REGISTRY.md',
  '.ai/cli-adapters.json',
  '.ai/model-routing.yaml',
  '.ai/codegraph/graph.json',
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
  return false;
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
      console.log(`preserved ${path.relative(root, dest)}`);
      return;
    }
    if (!force && !upgrade) {
      console.log(`skip ${path.relative(root, dest)} already exists. Use --force or --upgrade to overwrite.`);
      return;
    }
  }
  if (dryRun) console.log(`would create ${path.relative(root, dest)}`);
  else {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
    console.log(`created ${path.relative(root, dest)}`);
  }
}

export function runInit(): void {
  const manifestProfile = readManifest()?.profile;
  const profile = resolveProfile(upgrade ? (manifestProfile ?? requestedProfile) : requestedProfile);
  if (profile.status === 'invalid') {
    console.error(profile.detail);
    process.exitCode = 1;
    return;
  }
  copyRecursive(templateDir, root);
  if (profile.status === 'ok') {
    copyRecursive(profilePath(profile.profile), root);
  } else if (requestedProfile === 'auto' && profile.status === 'unknown') {
    console.log(`profile auto skipped: ${profile.detail}`);
  }
  writeManifest(profile.profile);
  warnMonorepoSecondaryStack(profile.profile);
  console.log(dryRun ? 'Dry run complete.' : 'ForgeAI agentic markdown kit initialized.');
}
