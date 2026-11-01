// AUTHORED-BY Codex GPT-6.1-Sol

/** The caller's abort reason, as native fetch rejects with it; else a generic AbortError. */
export function abortError(signal?: AbortSignal): unknown {
  if (signal?.aborted && signal.reason !== undefined) return signal.reason;
  return new DOMException("The operation was aborted.", "AbortError");
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

export function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError(signal);
}

/** Observe late settlement too, even when a transport ignores its signal. */
export function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError(signal));
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
    void promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}
