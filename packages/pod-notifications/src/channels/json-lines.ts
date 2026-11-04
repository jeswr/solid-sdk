// AUTHORED-BY Codex GPT-6.1-Sol
const MAX_LINE = 1_048_576;

/** Decode bounded newline-delimited JSON-LD, retaining partial UTF-8 and records across reads. */
export async function readJsonLines(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  current: () => boolean,
  emit: (frame: unknown) => void,
): Promise<void> {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let buffer = "";
  const line = (text: string) => {
    if (text.length > MAX_LINE) throw new Error("Notification line too large");
    if (!current() || !text.trim()) return;
    let frame: unknown;
    try {
      frame = JSON.parse(text);
    } catch {
      return;
    }
    emit(frame);
  };
  try {
    while (current()) {
      const { value, done } = await reader.read();
      if (!current()) return;
      buffer += decoder.decode(value, { stream: !done });
      let end = buffer.indexOf("\n");
      while (end !== -1) {
        line(buffer.slice(0, end));
        buffer = buffer.slice(end + 1);
        end = buffer.indexOf("\n");
      }
      if (buffer.length > MAX_LINE) throw new Error("Notification line too large");
      if (done) {
        line(buffer);
        return;
      }
    }
  } finally {
    reader.releaseLock();
  }
}
