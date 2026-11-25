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

/**
 * Read a body stream into one buffer, refusing the moment the running total passes `limit`.
 * Nothing about the response (Content-Length included) is trusted: only counted bytes matter.
 * The stream is cancelled on every exit so a refused or aborted download stops pulling.
 */
export async function readBounded(
  body: ReadableStream<Uint8Array> | null,
  limit: number,
  signal: AbortSignal,
): Promise<Uint8Array> {
  if (body === null) return new Uint8Array(0);
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
      chunks.push(next.value);
    }
  } finally {
    aborted.dispose();
    reader.cancel().catch(noop);
  }
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.byteLength;
  }
  return bytes;
}
