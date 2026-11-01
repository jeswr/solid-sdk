// AUTHORED-BY Codex GPT-6
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
