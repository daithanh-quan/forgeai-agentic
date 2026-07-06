import fs from 'node:fs';
import path from 'node:path';
import type { AdapterConfig } from './types.js';
import { root, templateDir } from './context.js';
import { formatStatus, commandExists, countTodos, readJsonIfPresent, listFilesRecursive, getErrorMessage } from './utils.js';
import { parseSessionTable, isUnfinishedSession } from './sessions.js';
import { runCheckCodeGraph } from './codegraph.js';
import { runCheckLifecycle } from './lifecycle.js';
import { runCheckProfile } from './profiles.js';
import { runCheckReview } from './review.js';
import { runCheckSecurity } from './security.js';
import { runCheckMemory } from './memory.js';
import { runCheckApproval } from './approval.js';
import { runCheckEvaluation } from './evaluation.js';

const requiredHarnessFiles = listFilesRecursive(templateDir);
const bootstrapFiles = ['.ai/PROJECT.md', '.ai/MEMORY.md', '.ai/AGENT_REGISTRY.md'];

export function runCheck(): void {
  console.log('ForgeAI harness check');
  console.log('');

  let missingRequired = 0;
  for (const relativePath of requiredHarnessFiles) {
    const exists = fs.existsSync(path.join(root, relativePath));
    if (!exists) missingRequired += 1;
    console.log(formatStatus(exists ? 'ok' : 'missing', relativePath));
  }

  console.log('');
  console.log('Bootstrap status');
  let totalTodos = 0;
  for (const relativePath of bootstrapFiles) {
    const todos = countTodos(relativePath);
    totalTodos += todos;
    const status = todos > 0 ? 'needs bootstrap' : 'ok';
    console.log(formatStatus(status, `${relativePath}${todos > 0 ? ` (${todos} TODO)` : ''}`));
  }

  console.log('');
  console.log('Model adapters');
  const availableAdapters: string[] = [];
  let adapterReadFailed = false;

  try {
    const adapterConfig = readJsonIfPresent<AdapterConfig>('.ai/cli-adapters.json');
    const adapters = adapterConfig?.adapters || {};
    const adapterEntries = Object.entries(adapters);

    if (adapterEntries.length === 0) {
      console.log(formatStatus('skipped', '.ai/cli-adapters.json has no adapters'));
    }

    for (const [provider, adapter] of adapterEntries) {
      const available = commandExists(adapter.command);
      if (available) availableAdapters.push(provider);
      console.log(
        formatStatus(
          available ? 'optional ok' : 'optional missing',
          `${provider} (${adapter.command ?? 'missing command'})`
        )
      );
    }
  } catch (error) {
    adapterReadFailed = true;
    console.log(formatStatus('invalid', `.ai/cli-adapters.json (${getErrorMessage(error)})`));
  }

  console.log('');
  console.log('Orchestration');
  if (availableAdapters.length === 0) {
    console.log(formatStatus('single-agent', 'current model must orchestrate, implement, review, and validate locally'));
  } else {
    console.log(formatStatus('multi-agent', `orchestrator can be current model or: ${availableAdapters.join(', ')}`));
    console.log(formatStatus('policy', 'human chooses orchestrator; fallback is current_model_executes_locally'));
  }

  console.log('');
  console.log('Session coordination');
  const sessionsPath = path.join(root, '.ai', 'state', 'sessions.md');
  if (!fs.existsSync(sessionsPath)) {
    console.log(formatStatus('missing', '.ai/state/sessions.md'));
    missingRequired += 1;
  } else {
    const unfinishedSessions = parseSessionTable(fs.readFileSync(sessionsPath, 'utf8')).filter(isUnfinishedSession);
    console.log(formatStatus('ok', `.ai/state/sessions.md (${unfinishedSessions.length} active)`));
    console.log(formatStatus('check', 'run forgeai-init --check-sessions before parallel agent work'));
  }

  console.log('');
  if (missingRequired > 0 || adapterReadFailed) {
    console.log('Result: harness incomplete. Run forgeai-init or restore the missing/invalid files.');
    process.exitCode = 1;
    return;
  }

  if (totalTodos > 0) {
    console.log('Result: harness installed, but project context still needs bootstrap.');
    return;
  }

  console.log('Result: harness installed and ready.');
}


export function runCheckAll(): void {
  const separator = () => {
    console.log('');
    console.log('----------------------------------------');
    console.log('');
  };

  runCheck();
  separator();
  runCheckCodeGraph({ strict: true });
  separator();
  runCheckLifecycle();
  separator();
  runCheckProfile();
  separator();
  runCheckReview();
  separator();
  runCheckSecurity();
  separator();
  runCheckMemory();
  separator();
  runCheckApproval();
  separator();
  runCheckEvaluation();
}
