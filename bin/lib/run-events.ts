import { emitToPipe, getPipePath } from '../ui/pipe.js';

export type RunEvent =
  | { type: 'run_start'; ts: number; adapter: string; provider: string; model: string; objective: string; budget_tokens: number }
  | { type: 'retry_attempt'; ts: number; adapter: string; attempt: number; error_kind: string; delay_ms: number }
  | { type: 'run_complete'; ts: number; adapter: string; outcome: string; input_tokens: number | null; output_tokens: number | null; latency_ms: number; retry_count: number };

export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export function emitRunEvent(event: RunEvent): void {
  try {
    emitToPipe(getPipePath(), JSON.stringify(event));
  } catch {
    // best-effort: no pipe running, or buffer full (EAGAIN) — drop the event
  }
}
