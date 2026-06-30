import fs from 'node:fs';
import path from 'node:path';
import type { Adapter, AdapterConfig } from './types.js';
import { root, dryRun, force, getArgValue } from './context.js';
import { commandExists, formatStatus, getErrorMessage } from './utils.js';

// Default quota/rate-limit patterns, matching the shipped claude/codex adapters.
export const DEFAULT_QUOTA_PATTERNS = [
  'quota',
  'rate limit',
  'rate_limit',
  'too many requests',
  'insufficient_quota',
  'credit balance',
  'billing'
];

export const ADAPTERS_RELATIVE = '.ai/cli-adapters.json';
export const ROUTING_RELATIVE = '.ai/model-routing.yaml';
export const REPOINTABLE_TIERS = ['fast', 'standard', 'strong'];

// Parse a list-valued CLI flag. Accepts a JSON array (`'["a","b"]'`) or a
// comma-separated string (`'a, b'`). Returns the fallback when value is null.
export function parseListArg(raw: string | null, fallback: string[]): string[] {
  if (raw === null) return fallback;
  const trimmed = raw.trim();
  if (trimmed.startsWith('[')) {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== 'string')) {
      throw new Error(`Expected a JSON array of strings, got: ${raw}`);
    }
    return parsed as string[];
  }
  return trimmed
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

// Quote a YAML scalar only when it contains characters the hand-rolled
// readTier() parser would otherwise mishandle (spaces, parens, #, quotes, :).
export function formatYamlScalar(value: string): string {
  if (/^[A-Za-z0-9_.\-/]+$/.test(value)) return value;
  return `"${value.replace(/"/g, '\\"')}"`;
}

// Replace the provider/model of a single tier in model-routing.yaml in place,
// preserving every other line, comment, and indentation so the hand-rolled
// readTier() parser in .ai/router/run-model.ts keeps working. Only the 4-space
// `    provider:` / `    model:` value lines inside the target tier block are
// touched; missing lines are inserted right after the tier header.
export function repointTierInYaml(
  text: string,
  tierName: string,
  provider: string,
  model: string
): { text: string; changed: boolean } {
  const newline = text.includes('\r\n') ? '\r\n' : '\n';
  const hadTrailingNewline = /\r?\n$/.test(text);
  const lines = text.split(/\r?\n/);
  if (hadTrailingNewline) lines.pop();

  const tiersIndex = lines.findIndex((line) => /^tiers:\s*$/.test(line));
  if (tiersIndex === -1) {
    throw new Error(`${ROUTING_RELATIVE} has no "tiers:" block.`);
  }

  let headerIndex = -1;
  for (let index = tiersIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (new RegExp(`^  ${tierName}:\\s*$`).test(line)) {
      headerIndex = index;
      break;
    }
    // A new top-level (column 0) key means we have left the tiers: block.
    if (/^[A-Za-z0-9_-]+:/.test(line)) break;
  }
  if (headerIndex === -1) {
    throw new Error(`Tier "${tierName}" not found under "tiers:" in ${ROUTING_RELATIVE}.`);
  }

  // The block ends at the next top-level key or the next 2-space tier header.
  let blockEnd = lines.length;
  for (let index = headerIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^[A-Za-z0-9_-]+:/.test(line) || /^  [A-Za-z0-9_-]+:\s*$/.test(line)) {
      blockEnd = index;
      break;
    }
  }

  let foundProvider = false;
  let foundModel = false;
  for (let index = headerIndex + 1; index < blockEnd; index += 1) {
    if (/^    provider:\s*/.test(lines[index])) {
      lines[index] = `    provider: ${provider}`;
      foundProvider = true;
    } else if (/^    model:\s*/.test(lines[index])) {
      lines[index] = `    model: ${formatYamlScalar(model)}`;
      foundModel = true;
    }
  }

  const inserts: string[] = [];
  if (!foundModel) inserts.unshift(`    model: ${formatYamlScalar(model)}`);
  if (!foundProvider) inserts.unshift(`    provider: ${provider}`);
  if (inserts.length > 0) lines.splice(headerIndex + 1, 0, ...inserts);

  let output = lines.join(newline);
  if (hadTrailingNewline) output += newline;
  return { text: output, changed: true };
}

// Load .ai/cli-adapters.json for a write operation, surfacing a clear error if
// the harness is not initialized or the file is invalid JSON.
export function loadAdaptersForWrite(): { abs: string; config: AdapterConfig } | null {
  const abs = path.join(root, ADAPTERS_RELATIVE);
  if (!fs.existsSync(abs)) {
    console.error(`${ADAPTERS_RELATIVE} not found. Run forgeai-init first to initialize the harness.`);
    process.exitCode = 1;
    return null;
  }
  try {
    const config = JSON.parse(fs.readFileSync(abs, 'utf8')) as AdapterConfig;
    return { abs, config };
  } catch (error) {
    console.error(`Invalid ${ADAPTERS_RELATIVE}: ${getErrorMessage(error)}`);
    process.exitCode = 1;
    return null;
  }
}

export function runAddModel(): void {
  const provider = getArgValue('--add-model');
  if (!provider || provider.startsWith('--')) {
    console.error('Usage: forgeai-init --add-model <provider> [--model <id>] [options]');
    process.exitCode = 1;
    return;
  }
  if (!/^[A-Za-z0-9_-]+$/.test(provider)) {
    console.error(`Invalid provider name "${provider}". Use letters, digits, "-" or "_" only.`);
    process.exitCode = 1;
    return;
  }
  if (provider === 'current') {
    console.error('"current" is a reserved routing sentinel and cannot be an adapter name.');
    process.exitCode = 1;
    return;
  }

  const model = getArgValue('--model');
  const command = getArgValue('--command') ?? provider;
  const input = getArgValue('--input') ?? 'stdin';
  if (input !== 'stdin' && input !== 'argv') {
    console.error(`Invalid --input "${input}". Use "stdin" or "argv".`);
    process.exitCode = 1;
    return;
  }

  const tier = getArgValue('--tier');
  if (tier !== null && !REPOINTABLE_TIERS.includes(tier)) {
    console.error(`Invalid --tier "${tier}". Choose one of: ${REPOINTABLE_TIERS.join(', ')}.`);
    process.exitCode = 1;
    return;
  }
  if (tier !== null && !model) {
    console.error('--tier requires --model so the tier can be repointed to a concrete model.');
    process.exitCode = 1;
    return;
  }

  let adapterArgs: string[];
  let healthcheckArgs: string[];
  let quotaPatterns: string[];
  const timeoutRaw = getArgValue('--healthcheck-timeout');
  let timeoutMs = 5000;
  try {
    adapterArgs = parseListArg(getArgValue('--args'), ['--model', '{model}']);
    healthcheckArgs = parseListArg(getArgValue('--healthcheck-args'), ['--version']);
    quotaPatterns = parseListArg(getArgValue('--quota-patterns'), [...DEFAULT_QUOTA_PATTERNS]);
  } catch (error) {
    console.error(getErrorMessage(error));
    process.exitCode = 1;
    return;
  }
  if (timeoutRaw !== null) {
    const parsed = Number(timeoutRaw);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      console.error(`Invalid --healthcheck-timeout "${timeoutRaw}". Use a positive integer (ms).`);
      process.exitCode = 1;
      return;
    }
    timeoutMs = parsed;
  }

  if (input === 'argv' && !adapterArgs.some((item) => item.includes('{assignment}'))) {
    console.log(
      formatStatus('warn', 'input=argv but {assignment} is missing from --args; the delegated CLI will not receive the task')
    );
  }

  const loaded = loadAdaptersForWrite();
  if (!loaded) return;
  const { abs, config } = loaded;
  config.adapters ??= {};

  if (config.adapters[provider] && !force) {
    console.error(`Adapter "${provider}" already exists. Pass --force to overwrite it.`);
    process.exitCode = 1;
    return;
  }

  const adapter: Adapter = {
    command,
    args: adapterArgs,
    healthcheck: { args: healthcheckArgs, timeout_ms: timeoutMs },
    input,
    quota_patterns: quotaPatterns
  };
  config.adapters[provider] = adapter;

  // Stage the YAML edit before writing anything so validation can still abort.
  let yamlUpdate: { abs: string; text: string } | null = null;
  if (tier !== null && model) {
    const yamlAbs = path.join(root, ROUTING_RELATIVE);
    if (!fs.existsSync(yamlAbs)) {
      console.error(`${ROUTING_RELATIVE} not found. Run forgeai-init first to initialize the harness.`);
      process.exitCode = 1;
      return;
    }
    try {
      const result = repointTierInYaml(fs.readFileSync(yamlAbs, 'utf8'), tier, provider, model);
      yamlUpdate = { abs: yamlAbs, text: result.text };
    } catch (error) {
      console.error(getErrorMessage(error));
      process.exitCode = 1;
      return;
    }
  }

  const adaptersContent = `${JSON.stringify(config, null, 2)}\n`;
  if (dryRun) {
    console.log(`would update ${ADAPTERS_RELATIVE} (adapter: ${provider})`);
    console.log(JSON.stringify({ [provider]: adapter }, null, 2));
    if (yamlUpdate) console.log(`would update ${ROUTING_RELATIVE} (tier ${tier} -> ${provider}/${model})`);
  } else {
    fs.writeFileSync(abs, adaptersContent);
    console.log(`updated ${ADAPTERS_RELATIVE} (adapter: ${provider})`);
    if (yamlUpdate) {
      fs.writeFileSync(yamlUpdate.abs, yamlUpdate.text);
      console.log(`updated ${ROUTING_RELATIVE} (tier ${tier} -> ${provider}/${model})`);
    }
  }

  const onPath = commandExists(command);
  console.log(
    formatStatus(
      onPath ? 'ok' : 'warn',
      `${command} ${onPath ? 'found on PATH' : 'not on PATH yet (install it to enable delegation)'}`
    )
  );

  console.log('');
  console.log('Next steps:');
  if (tier !== null) {
    console.log(`  Route via tier:  npx tsx .ai/router/run-model.ts --tier ${tier} --assignment <file>`);
  }
  const modelHint = model ?? '<model>';
  console.log(`  Or directly:     npx tsx .ai/router/run-model.ts --provider ${provider} --model ${modelHint} --assignment <file>`);
  console.log('  Verify:          forgeai-init --list-models');
}

export function runListModels(): void {
  const loaded = loadAdaptersForWrite();
  if (!loaded) return;
  const adapters = loaded.config.adapters ?? {};
  const entries = Object.entries(adapters);

  console.log('Configured model adapters');
  console.log('');
  if (entries.length === 0) {
    console.log(formatStatus('skipped', `${ADAPTERS_RELATIVE} has no adapters`));
    return;
  }
  for (const [provider, adapter] of entries) {
    const onPath = commandExists(adapter.command);
    console.log(
      formatStatus(
        onPath ? 'available' : 'missing',
        `${provider} -> ${adapter.command ?? 'missing command'} (input: ${adapter.input ?? 'stdin'})`
      )
    );
  }
}

export function runRemoveModel(): void {
  const provider = getArgValue('--remove-model');
  if (!provider || provider.startsWith('--')) {
    console.error('Usage: forgeai-init --remove-model <provider>');
    process.exitCode = 1;
    return;
  }

  const loaded = loadAdaptersForWrite();
  if (!loaded) return;
  const { abs, config } = loaded;
  if (!config.adapters || !config.adapters[provider]) {
    console.error(`Adapter "${provider}" not found in ${ADAPTERS_RELATIVE}.`);
    process.exitCode = 1;
    return;
  }

  delete config.adapters[provider];
  const content = `${JSON.stringify(config, null, 2)}\n`;
  if (dryRun) {
    console.log(`would update ${ADAPTERS_RELATIVE} (removed adapter: ${provider})`);
  } else {
    fs.writeFileSync(abs, content);
    console.log(`updated ${ADAPTERS_RELATIVE} (removed adapter: ${provider})`);
  }

  // Warn (do not fail) if a routing tier still references the removed provider.
  const yamlAbs = path.join(root, ROUTING_RELATIVE);
  if (fs.existsSync(yamlAbs)) {
    const yaml = fs.readFileSync(yamlAbs, 'utf8');
    if (new RegExp(`^    provider:\\s*${provider}\\s*$`, 'm').test(yaml)) {
      console.log(
        formatStatus('warn', `a tier in ${ROUTING_RELATIVE} still references "${provider}"; repoint it with --add-model ... --tier <tier>`)
      );
    }
  }
}
