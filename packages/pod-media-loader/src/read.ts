// AUTHORED-BY Claude Sonnet 5.5
import { MediaFailure } from "./errors.js";

const noop = (): void => undefined;

/** Cross-realm safe (webviews, iframes): a Uint8Array from another realm fails `instanceof`. */
const isBytes = (value: unknown): value is Uint8Array =>
  Object.prototype.toString.call(value) === "[object Uint8Array]";

/** A promise that rejects with `MediaFailure("aborted")` the moment `signal` aborts. */
export function abortion(signal: AbortSignal): { promise: Promise<never>; dispose(): void } {
  let onAbort = noop;
  const promise = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(new MediaFailure("aborted"));
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
  });
  promise.catch(noop);
  return { promise, dispose: () => signal.removeEventListener("abort", onAbort) };
}

/**
 * Await `work`, but give up the moment `signal` aborts, even when `work` ignores the signal.
 * A value that arrives after the abort goes to `discard` so a late stream is never left open.
 */
export function raceAbort<T>(
  work: Promise<T>,
  signal: AbortSignal,
  discard: (late: T) => void,
): Promise<T> {
  const aborted = abortion(signal);
  return Promise.race([work, aborted.promise]).then(
    (value) => {
      aborted.dispose();
      return value;
    },
    (error: unknown) => {
      aborted.dispose();
      work.then(discard, noop);
      throw error;
    },
  );
}

export interface ReadBody {
  readonly chunks: Uint8Array[];
  readonly size: number;
}

/**
 * Read a body stream into its chunks, refusing the moment the running total passes `limit`.
 * Nothing about the response (Content-Length included) is trusted: only counted bytes matter.
 * `onBytes` is told the running total before each chunk is kept and may throw to refuse it.
 * The chunks are not joined, so the only full-size copy later is the Blob's own.
 * The stream is cancelled on every exit so a refused or aborted download stops pulling, and an
 * abort that lands together with the last chunk still counts as an abort.
 */
export async function readBounded(
  body: ReadableStream<Uint8Array> | null,
  limit: number,
  signal: AbortSignal,
  onBytes: (total: number) => void = noop,
): Promise<ReadBody> {
  if (body === null) return { chunks: [], size: 0 };
  const reader = body.getReader();
  const aborted = abortion(signal);
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const next = await Promise.race([reader.read(), aborted.promise]);
      if (next.done) break;
      if (!isBytes(next.value)) throw new MediaFailure("failed");
      total += next.value.byteLength;
      if (total > limit) throw new MediaFailure("too-large");
      // The caller accounts for the bytes (and may refuse them) before the chunk is kept.
      onBytes(total);
      chunks.push(next.value);
    }
    if (signal.aborted) throw new MediaFailure("aborted");
  } finally {
    aborted.dispose();
    reader.cancel().catch(noop);
  }
  return { chunks, size: total };
}
