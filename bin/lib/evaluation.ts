import fs from 'node:fs';
import path from 'node:path';
import { root } from './context.js';
import { formatStatus } from './utils.js';

const EVALUATION_DIR = '.ai/evaluation';
const REQUIRED_FIELDS = ['Run ID', 'Date', 'Task', 'Mode', 'Outcome'];
const VALID_MODES = new Set(['single-agent', 'multi-agent']);
const VALID_OUTCOMES = new Set(['pass', 'fail', 'partial']);
const INTEGER_METRICS = ['Token cost', 'Input tokens', 'Output tokens', 'Model calls', 'Files read', 'Context files'];

function isNonNegativeInteger(value: string): boolean {
  return /^\d+$/.test(value);
}

function isDuration(value: string): boolean {
  return /^\d{1,2}:\d{2}:\d{2}$/.test(value);
}

export function parseEvaluationRun(content: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^-\s+([^:]+):\s*(.+)$/);
    if (match) fields[match[1].trim()] = match[2].trim();
  }
  return fields;
}

export function runCheckEvaluation(): void {
  console.log('ForgeAI evaluation check');
  console.log('');

  const evalDir = path.join(root, EVALUATION_DIR);

  if (!fs.existsSync(evalDir)) {
    console.log(formatStatus('ok', `${EVALUATION_DIR} not present — no evaluation runs recorded`));
    console.log('');
    console.log('Result: evaluation check passed (no runs to validate).');
    return;
  }

  const runFiles = fs
    .readdirSync(evalDir)
    .filter((f) => f.endsWith('.md') && f !== 'README.md' && f !== '_template.md')
    .sort();

  if (runFiles.length === 0) {
    console.log(formatStatus('ok', `${EVALUATION_DIR} exists with no run files`));
    console.log('');
    console.log('Result: evaluation check passed (no runs to validate).');
    return;
  }

  let failures = 0;
  let totalTokenCost = 0;
  let totalModelCalls = 0;
  let totalFilesRead = 0;
  let runsWithEfficiencyMetrics = 0;

  for (const fileName of runFiles) {
    const filePath = path.join(evalDir, fileName);
    const content = fs.readFileSync(filePath, 'utf8');
    const fields = parseEvaluationRun(content);
    const relative = `${EVALUATION_DIR}/${fileName}`;
    let fileFailures = 0;

    for (const field of REQUIRED_FIELDS) {
      if (!fields[field]) {
        fileFailures += 1;
        console.log(formatStatus('invalid', `${relative} missing required field: ${field}`));
      }
    }

    const mode = fields['Mode']?.toLowerCase();
    if (mode && !VALID_MODES.has(mode)) {
      fileFailures += 1;
      console.log(formatStatus('invalid', `${relative} Mode must be single-agent or multi-agent (got: ${fields['Mode']})`));
    }

    const outcome = fields['Outcome']?.toLowerCase();
    if (outcome && !VALID_OUTCOMES.has(outcome)) {
      fileFailures += 1;
      console.log(formatStatus('invalid', `${relative} Outcome must be pass, fail, or partial (got: ${fields['Outcome']})`));
    }

    if (fields['Latency'] && !isDuration(fields['Latency'])) {
      fileFailures += 1;
      console.log(formatStatus('invalid', `${relative} Latency must use HH:MM:SS (got: ${fields['Latency']})`));
    }

    for (const metric of INTEGER_METRICS) {
      if (fields[metric] && !isNonNegativeInteger(fields[metric])) {
        fileFailures += 1;
        console.log(formatStatus('invalid', `${relative} ${metric} must be a non-negative integer (got: ${fields[metric]})`));
      }
    }

    if (fileFailures === 0) {
      console.log(formatStatus('ok', `${relative} (${fields['Mode'] ?? 'unknown'} / ${fields['Outcome'] ?? 'unknown'})`));
      if (fields['Token cost'] || fields['Model calls'] || fields['Files read']) {
        runsWithEfficiencyMetrics += 1;
        totalTokenCost += Number(fields['Token cost'] ?? 0);
        totalModelCalls += Number(fields['Model calls'] ?? 0);
        totalFilesRead += Number(fields['Files read'] ?? 0);
      }
    }

    failures += fileFailures;
  }

  console.log('');
  if (failures > 0) {
    console.log('Result: evaluation check failed. Fix the invalid run files listed above.');
    process.exitCode = 1;
    return;
  }

  if (runsWithEfficiencyMetrics > 0) {
    console.log(formatStatus('metric', `${runsWithEfficiencyMetrics} run${runsWithEfficiencyMetrics === 1 ? '' : 's'} include efficiency metrics`));
    console.log(formatStatus('metric', `token cost total: ${totalTokenCost}`));
    console.log(formatStatus('metric', `model calls total: ${totalModelCalls}`));
    console.log(formatStatus('metric', `files read total: ${totalFilesRead}`));
  }

  console.log(`Result: evaluation check passed (${runFiles.length} run${runFiles.length === 1 ? '' : 's'} validated).`);
}
