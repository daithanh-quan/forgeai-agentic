export async function* parseSSE(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let dataLines: string[] = [];

  // Returns a payload to yield when a blank line closes an event, else null.
  const takeLine = (raw: string): string | null => {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    if (line === '') {
      if (dataLines.length > 0) {
        const payload = dataLines.join('\n');
        dataLines = [];
        return payload;
      }
      return null;
    }
    if (line.startsWith(':')) return null;               // comment / heartbeat
    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).replace(/^ /, ''));   // strip one optional leading space
    }
    return null;                                          // event:, id:, retry: ignored
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        const payload = takeLine(line);
        if (payload !== null) yield payload;
      }
    }
    buffer += decoder.decode();            // flush any trailing multi-byte char
    if (buffer.length > 0) {
      const payload = takeLine(buffer);    // final line without a newline
      if (payload !== null) yield payload;
    }
    if (dataLines.length > 0) {            // EOF: data with no terminating blank line
      yield dataLines.join('\n');
    }
  } finally {
    reader.releaseLock();
  }
}
