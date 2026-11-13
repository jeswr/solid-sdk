// AUTHORED-BY Codex GPT-6.1-Sol
import { IntegrationSyncError } from "./errors.js";

/** Header and inter-chunk idle allowance; a body's total allowance also scales with size. */
export const SOURCE_RESPONSE_TIMEOUT_MS = 60_000;
const MIN_BODY_BYTES_PER_SECOND = 256 * 1024;

export class SourceTimeoutError extends IntegrationSyncError {
  constructor(adapterId: string, url: string) {
    super(adapterId, "The source response timed out.", { url });
  }
}

/** A finite trickle bound at 256 KiB/s, plus one idle allowance, bounded by the read cap. */
export function sourceBodyTimeoutMs(cap: number, declared: string | null = null): number {
  const length = declared !== null && /^\d+$/.test(declared) ? Number(declared) : undefined;
  const bytes =
    length !== undefined && Number.isSafeInteger(length) && length >= 0
      ? Math.min(cap, length)
      : cap;
  return SOURCE_RESPONSE_TIMEOUT_MS + Math.ceil(bytes / MIN_BODY_BYTES_PER_SECOND) * 1000;
}

// The capped reader supplies the actual per-response cap without changing the Fetch contract.
const bodyLimits = new WeakMap<Response, (cap: number) => void>();
export function registerSourceBodyLimit(
  response: Response,
  configure: (cap: number) => void,
): void {
  bodyLimits.set(response, configure);
}
export function limitSourceBody(response: Response, cap: number): void {
  bodyLimits.get(response)?.(cap);
}

/** Reject even when an injected transport or reader ignores cancellation. */
export function during<T>(signal: AbortSignal, step: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const stop = () => reject(signal.reason);
    signal.addEventListener("abort", stop, { once: true });
    if (signal.aborted) {
      signal.removeEventListener("abort", stop);
      reject(signal.reason);
      return;
    }
    Promise.resolve()
      .then(() => {
        signal.throwIfAborted();
        return step();
      })
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", stop));
  });
}
