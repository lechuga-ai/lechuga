// Yields the JSON payload of each `data:` line in a text/event-stream body.
// Shared by the worker (gateway + storage) and the web client.
export async function* parseSSE<T = unknown>(stream: ReadableStream<Uint8Array>): AsyncGenerator<T> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const parseLine = (line: string): T | undefined => {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) return undefined;
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === "[DONE]") return undefined;
    try {
      return JSON.parse(payload) as T;
    } catch {
      return undefined;
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const parsed = parseLine(line);
        if (parsed !== undefined) yield parsed;
      }
    }
    buffer += decoder.decode();
    const tail = parseLine(buffer);
    if (tail !== undefined) yield tail;
  } finally {
    reader.releaseLock();
  }
}
