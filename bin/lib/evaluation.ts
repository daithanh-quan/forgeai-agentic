import fs from 'node:fs';
import path from 'node:path';
import { root } from './context.js';
import { formatStatus } from './utils.js';

const EVALUATION_DIR = '.ai/evaluation';
const REQUIRED_FIELDS = ['Run ID', 'Date', 'Task', 'Mode', 'Outcome'];
const VALID_MODES = new Set(['single-agent', 'multi-agent']);
const VALID_OUTCOMES = new Set(['pass', 'fail', 'partial']);

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

    if (fileFailures === 0) {
      console.log(formatStatus('ok', `${relative} (${fields['Mode'] ?? 'unknown'} / ${fields['Outcome'] ?? 'unknown'})`));
    }

    failures += fileFailures;
  }

  console.log('');
  if (failures > 0) {
    console.log('Result: evaluation check failed. Fix the invalid run files listed above.');
    process.exitCode = 1;
    return;
  }

  console.log(`Result: evaluation check passed (${runFiles.length} run${runFiles.length === 1 ? '' : 's'} validated).`);
}
