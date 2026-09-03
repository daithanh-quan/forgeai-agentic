import { emitToPipe, getPipePath } from '../ui/pipe.js';

export type RunEvent =
  | { type: 'run_start'; ts: number; adapter: string; provider: string; model: string; objective: string; budget_tokens: number }
  | { type: 'retry_attempt'; ts: number; adapter: string; attempt: number; error_kind: string; delay_ms: number }
  | { type: 'run_complete'; ts: number; adapter: string; outcome: string; input_tokens: number | null; output_tokens: number | null; latency_ms: number; retry_count: number };

export type CheckEvent =
  | { type: 'check.run'; ts: number; name: string; status: 'running' }
  | { type: 'check.result'; ts: number; name: string; status: 'pass' | 'fail' };

export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export function emitRunEvent(event: RunEvent): void {
  emitMonitorEvent(event);
}

export function emitMonitorEvent(event: RunEvent | CheckEvent): void {
  try {
    emitToPipe(getPipePath(), JSON.stringify(event));
  } catch {
    // best-effort: no pipe running, or buffer full (EAGAIN) — drop the event
  }
}

export function runObservedCheck(
  name: string,
  check: () => void,
  emit: (event: CheckEvent) => void = emitMonitorEvent,
): void {
  emit({ type: 'check.run', ts: nowSeconds(), name, status: 'running' });
  try {
    check();
  } catch (error) {
    emit({ type: 'check.result', ts: nowSeconds(), name, status: 'fail' });
    throw error;
  }
  emit({
    type: 'check.result',
    ts: nowSeconds(),
    name,
    status: process.exitCode && process.exitCode !== 0 ? 'fail' : 'pass',
  });
}
