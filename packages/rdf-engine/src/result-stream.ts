import type { ResultStream } from "./types.js";

/** Keep even unstarted streams disposable; async-generator finally alone cannot do that. */
export function resultStream<T>(
  next: () => IteratorResult<T> | Promise<IteratorResult<T>>,
  release: () => void,
): ResultStream<T> {
  let closed = false;
  const stream: ResultStream<T> = {
    [Symbol.asyncIterator]() {
      return stream;
    },
    async next() {
      if (closed) return { done: true, value: undefined };
      try {
        const result = await next();
        if (closed) return { done: true, value: undefined };
        if (result.done) stream.dispose();
        return result;
      } catch (error) {
        stream.dispose();
        throw error;
      }
    },
    async return() {
      stream.dispose();
      return { done: true, value: undefined };
    },
    dispose() {
      if (closed) return;
      closed = true;
      release();
    },
  };
  return stream;
}
