// AUTHORED-BY Claude Sonnet 5.5

/** Random access to bytes that may live in several chunks, without joining them. */
export interface ByteView {
  readonly length: number;
  /** The byte at `index`, or 0 outside `[0, length)`; callers check `length` first. */
  at(index: number): number;
}

export function bytesView(bytes: Uint8Array): ByteView {
  return { length: bytes.length, at: (index) => bytes[index] ?? 0 };
}

export function chunksView(chunks: readonly Uint8Array[]): ByteView {
  const starts: number[] = [];
  let length = 0;
  for (const chunk of chunks) {
    starts.push(length);
    length += chunk.length;
  }
  let cursor = 0;
  return {
    length,
    at(index) {
      if (index < 0 || index >= length) return 0;
      while (index < (starts[cursor] as number)) cursor--;
      while (index >= (starts[cursor] as number) + (chunks[cursor] as Uint8Array).length) cursor++;
      return (chunks[cursor] as Uint8Array)[index - (starts[cursor] as number)] as number;
    },
  };
}

/** The first `count` bytes (or fewer) as one contiguous array. */
export function prefixOf(chunks: readonly Uint8Array[], count: number): Uint8Array {
  const out = new Uint8Array(
    Math.min(
      count,
      chunks.reduce((n, c) => n + c.length, 0),
    ),
  );
  let at = 0;
  for (const chunk of chunks) {
    if (at >= out.length) break;
    const part = chunk.subarray(0, out.length - at);
    out.set(part, at);
    at += part.length;
  }
  return out;
}
