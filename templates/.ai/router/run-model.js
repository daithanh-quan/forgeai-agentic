#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const defaults = {
  routing: path.join(root, '.ai', 'model-routing.yaml'),
  adapters: path.join(root, '.ai', 'cli-adapters.json')
};

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith('--')) continue;
    const key = item.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
    } else {
      args[key] = next;
      index += 1;
    }
  }
  return args;
}

function usage() {
  return `Usage:
  node .ai/router/run-model.js --tier <fast|standard|strong|lead> --assignment <file>
  node .ai/router/run-model.js --provider <name> --model <name> --assignment <file>

Options:
  --routing <file>     Defaults to .ai/model-routing.yaml
  --adapters <file>    Defaults to .ai/cli-adapters.json
  --dry-run            Print the command that would run
`;
}

function stripYamlValue(value) {
  return value
    .trim()
    .replace(/^['"]|['"]$/g, '')
    .replace(/\s+#.*$/, '');
}

function readTier(routingPath, tierName) {
  const yaml = fs.readFileSync(routingPath, 'utf8');
  const lines = yaml.split(/\r?\n/);
  let inTiers = false;
  let currentTier = null;
  const tier = {};

  for (const line of lines) {
    if (/^tiers:\s*$/.test(line)) {
      inTiers = true;
      continue;
    }

    if (!inTiers) continue;
    if (/^[A-Za-z0-9_-]+:\s*/.test(line)) break;

    const tierMatch = line.match(/^  ([A-Za-z0-9_-]+):\s*$/);
    if (tierMatch) {
      currentTier = tierMatch[1];
      continue;
    }

    if (currentTier !== tierName) continue;
    const valueMatch = line.match(/^    ([A-Za-z0-9_-]+):\s*(.+)$/);
    if (valueMatch) tier[valueMatch[1]] = stripYamlValue(valueMatch[2]);
  }

  if (!tier.provider || !tier.model) {
    throw new Error(`Tier "${tierName}" is missing provider/model in ${routingPath}`);
  }

  return tier;
}

function replacePlaceholders(items, values) {
  return items.map((item) =>
    item
      .replaceAll('{model}', values.model)
      .replaceAll('{provider}', values.provider)
      .replaceAll('{assignment}', values.assignment)
      .replaceAll('{token_budget}', values.token_budget ?? '')
  );
}

function detectFailureReason(result, adapter) {
  if (result.error?.code === 'ENOENT') return 'missing_command';
  if (result.error) return 'failed_healthcheck';

  const combined = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.toLowerCase();
  const patterns = adapter.quota_patterns ?? [];
  if (patterns.some((pattern) => combined.includes(pattern.toLowerCase()))) {
    return 'quota_or_rate_limit';
  }

  return result.status === 0 ? null : 'command_failed';
}

function fallback(reason, detail, context) {
  const payload = {
    status: 'fallback',
    reason,
    detail,
    behavior: context.fallback?.behavior ?? 'lead_executes_locally',
    provider: context.provider,
    model: context.model,
    message:
      'Delegated CLI could not run. The lead/current model should execute this bounded assignment locally or escalate according to .ai/model-routing.yaml.'
  };
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  return 0;
}

const args = parseArgs(process.argv.slice(2));
if (args.help || (!args.tier && (!args.provider || !args.model))) {
  process.stderr.write(usage());
  process.exit(args.help ? 0 : 2);
}

const routingPath = path.resolve(args.routing ?? defaults.routing);
const adaptersPath = path.resolve(args.adapters ?? defaults.adapters);
const assignment = args.assignment
  ? fs.readFileSync(path.resolve(args.assignment), 'utf8')
  : fs.readFileSync(0, 'utf8');

const adaptersConfig = JSON.parse(fs.readFileSync(adaptersPath, 'utf8'));
const tier = args.tier ? readTier(routingPath, args.tier) : {};
const provider = args.provider ?? tier.provider;
const model = args.model ?? tier.model;
const tokenBudget = args.token_budget ?? tier.token_budget;
const adapter = adaptersConfig.adapters?.[provider];
const fallbackConfig = adaptersConfig.fallback ?? {};

if (!adapter) {
  process.exitCode = fallback('missing_adapter', `No adapter configured for provider "${provider}".`, {
    fallback: fallbackConfig,
    provider,
    model
  });
  process.exit();
}

const healthArgs = adapter.healthcheck?.args ?? ['--version'];
const health = spawnSync(adapter.command, healthArgs, {
  encoding: 'utf8',
  timeout: adapter.healthcheck?.timeout_ms ?? 5000
});
const healthFailure = detectFailureReason(health, adapter);
if (healthFailure) {
  process.exitCode = fallback(healthFailure, health.stderr || health.error?.message || 'Healthcheck failed.', {
    fallback: fallbackConfig,
    provider,
    model
  });
  process.exit();
}

const commandArgs = replacePlaceholders(adapter.args ?? [], {
  provider,
  model,
  assignment,
  token_budget: tokenBudget
});

if (args['dry-run']) {
  process.stdout.write(
    `${JSON.stringify({ command: adapter.command, args: commandArgs, input: adapter.input ?? 'stdin' }, null, 2)}\n`
  );
  process.exit(0);
}

const result = spawnSync(adapter.command, commandArgs, {
  input: adapter.input === 'argv' ? undefined : assignment,
  encoding: 'utf8',
  maxBuffer: 1024 * 1024 * 20
});
const runFailure = detectFailureReason(result, adapter);

if (runFailure && fallbackConfig.on?.includes(runFailure)) {
  process.exitCode = fallback(runFailure, result.stderr || result.stdout || 'Delegated CLI failed.', {
    fallback: fallbackConfig,
    provider,
    model
  });
  process.exit();
}

if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
process.exit(result.status ?? (result.error ? 1 : 0));
