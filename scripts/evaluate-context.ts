import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import type { CompiledContextArtifact } from '../bin/lib/types.js';
import { assessRetrieval, retrievalCases } from './context-retrieval.js';

const args = process.argv.slice(2);
if (args.some(arg => arg !== '--check') || args.length > 1) {
  process.stderr.write('Usage: npm run --silent evaluate:context -- [--check]\n');
  process.exit(2);
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
try {
  const cases = retrievalCases.map(scenario => {
    const artifact = JSON.parse(execFileSync(process.execPath,
      [path.join(root, 'dist/forgeai-init.js'), 'context', scenario.objective, '--json', '--budget', '6000'],
      { cwd: root, encoding: 'utf8', timeout: 60_000, maxBuffer: 2 * 1024 * 1024 }
    )) as CompiledContextArtifact;
    return assessRetrieval(scenario, artifact, file => fs.readFileSync(path.join(root, file), 'utf8'));
  });
  const full = cases.reduce((sum, result) => sum + result.full_implementations, 0);
  const required = cases.reduce((sum, result) => sum + result.required_implementations, 0);
  const report = {
    schema_version: 1,
    kind: 'forgeai_local_retrieval_evaluation',
    corpus_version: 1,
    scope: 'Five manually specified ForgeAI repository investigations; no model execution or task-success measurement.',
    summary: {
      cases: cases.length, passed: cases.filter(result => result.passed).length,
      full_implementations: full, required_implementations: required,
      implementation_recall: full / required,
      consistent_repository: cases.every(result => result.repository.fingerprint === cases[0].repository.fingerprint)
    },
    cases
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.summary.consistent_repository || cases.some(result => !result.budget_valid)
    || (args.includes('--check') && cases.some(result => !result.passed))) process.exitCode = 1;
} catch (error) {
  process.stderr.write(`Context evaluation failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
