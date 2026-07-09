import { execFileSync } from 'node:child_process';
import fs, { constants } from 'node:fs';
import net from 'node:net';
import readline from 'node:readline';

const DEFAULT_PIPE = '.forgeai.pipe';

export function getPipePath(): string {
  return process.env['FORGEAI_PIPE'] ?? DEFAULT_PIPE;
}

export function createPipeReader(
  pipePath: string,
  onLine: (line: string) => void,
  onError?: (err: Error) => void,
): () => void {
  try {
    execFileSync('mkfifo', [pipePath]);
  } catch {
    // FIFO already exists — ok
  }

  // O_RDWR: TUI holds both read and write ends open.
  // This prevents EOF when individual --emit writers disconnect.
  // O_NONBLOCK: required so net.Socket (kqueue-based) can be used instead of
  // fs.createReadStream (thread-pool-based). Using the thread pool causes
  // fs.closeSync to block at cleanup when a read() is pending.
  const fd = fs.openSync(pipePath, constants.O_RDWR | constants.O_NONBLOCK);

  // net.Socket uses kqueue/epoll — it handles SIGPIPE and cleanup correctly.
  const socket = new net.Socket({ fd, readable: true, writable: false, allowHalfOpen: true });
  socket.on('error', (err) => { onError?.(err); });
  const rl = readline.createInterface({ input: socket, crlfDelay: Infinity });

  rl.on('line', (line) => {
    if (line.trim()) onLine(line.trim());
  });

  return () => {
    rl.close();
    socket.destroy(); // closes fd automatically
    try {
      fs.unlinkSync(pipePath);
    } catch {
      // already gone — ok
    }
  };
}

export function emitToPipe(pipePath: string, json: string): void {
  if (!fs.existsSync(pipePath)) {
    throw new Error(
      `ForgeAI TUI is not running. Start with: forgeai-init --watch`,
    );
  }
  const fd = fs.openSync(pipePath, constants.O_WRONLY | constants.O_NONBLOCK);
  try {
    const buf = Buffer.from(json + '\n');
    fs.writeSync(fd, buf);
  } catch (err) {
    // Re-throw EAGAIN with a descriptive message so callers can surface it.
    // The auto-emit path in run-model.ts silently ignores write errors;
    // the runEmit CLI path will print the message and exit 1.
    if ((err as NodeJS.ErrnoException).code === 'EAGAIN') {
      throw new Error('ForgeAI TUI pipe buffer is full — event dropped');
    }
    throw err;
  } finally {
    fs.closeSync(fd);
  }
}
