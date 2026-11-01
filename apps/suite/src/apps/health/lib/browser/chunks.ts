// AUTHORED-BY Codex GPT-6
/** Inject Web Crypto at the browser boundary; only the digest is stored in the pod. */
export async function fingerprintAppleRecord(sourceRecord: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(sourceRecord));
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Decode bounded chunks without retaining an entire Apple Health export. */
export async function* fileChunks(file: File): AsyncGenerator<string> {
  const reader = file.stream().pipeThrough(new TextDecoderStream()).getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return;
      // The XML model yields only after a chunk parses. Bound even a large stream chunk.
      for (let index = 0; index < value.length; index += 16384)
        yield value.slice(index, index + 16384);
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
}
