import fs from 'node:fs';
import path from 'node:path';
import type { TaskValidationResult } from './task.js';

export type TaskReportStatus = 'passed' | 'failed' | 'cancelled' | 'needs-human';

export type TaskReport = {
  schema_version: 1;
  task_id: string;
  objective: string;
  adapter: string | null;
  model: string | null;
  write_scope: string[];
  changed_files: string[];
  out_of_scope_files: string[];
  validations: TaskValidationResult[];
  status: TaskReportStatus;
  error: string | null;
  next_action: string;
};

export function createTaskReport(input: Omit<TaskReport, 'schema_version'>): TaskReport {
  return {
    schema_version: 1,
    ...input,
    write_scope: [...input.write_scope].sort(),
    changed_files: [...input.changed_files].sort(),
    out_of_scope_files: [...input.out_of_scope_files].sort(),
    validations: input.validations.map((value) => ({ ...value }))
  };
}

export function renderTaskReport(report: TaskReport): string {
  const lines = [
    '# ForgeAI Task Report', '',
    `- Status: ${report.status}`,
    `- Task: ${report.task_id}`,
    `- Objective: ${report.objective}`,
    `- Adapter: ${report.adapter ?? 'none'}`,
    `- Model: ${report.model ?? 'default'}`,
    '', '## Scope', '',
    ...(report.write_scope.length ? report.write_scope.map((file) => `- ${file}`) : ['- none']),
    '', '## Changed files', '',
    ...(report.changed_files.length ? report.changed_files.map((file) => `- ${file}`) : ['- none']),
    '', '## Validation', '',
    ...(report.validations.length ? report.validations.map((check) => `- ${check.passed ? 'PASS' : 'FAIL'} ${check.name} (${check.durationMs}ms)`) : ['- not run']),
    ...(report.out_of_scope_files.length ? ['', '## Out-of-scope files', '', ...report.out_of_scope_files.map((file) => `- ${file}`)] : []),
    '', `- Next action: ${report.next_action}`,
    ...(report.error ? [`- Error: ${report.error}`] : []), ''
  ];
  return lines.join('\n');
}

export function writeTaskReport(repositoryRoot: string, report: TaskReport): { jsonPath: string; markdownPath: string } {
  const directory = path.join(repositoryRoot, '.ai', 'state', 'tasks');
  fs.mkdirSync(directory, { recursive: true });
  const jsonPath = path.join(directory, `${report.task_id}.json`);
  const markdownPath = path.join(directory, `${report.task_id}.md`);
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(markdownPath, renderTaskReport(report));
  return { jsonPath, markdownPath };
}
