import { emitPayload } from './context.js';
import { emitToPipe, getPipePath } from '../ui/pipe.js';

export function runEmit(): void {
  if (!emitPayload) {
    console.error("Usage: forgeai-init --emit '{\"type\":\"...\",\"ts\":1234}'");
    process.exit(1);
  }
  try {
    JSON.parse(emitPayload);
  } catch {
    console.error('Error: --emit value must be valid JSON');
    process.exit(1);
  }
  try {
    emitToPipe(getPipePath(), emitPayload);
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}
