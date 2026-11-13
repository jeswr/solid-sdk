// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
/**
 * Resource bounds for source traffic. Every JSON response is read through a byte cap, and the
 * runner owns one RunBudget per run, so a source that keeps returning
 * pages (or very large ones) fails the run, keeping the checkpoint, instead of exhausting memory.
 */
import { IntegrationSyncError } from "./errors.js";
import { limitSourceBody } from "./source-timeout.js";

/** Largest JSON response any adapter parses. */
/** A response body exceeded its byte cap; adapters may skip the item instead of failing. */
export class ResponseTooLargeError extends IntegrationSyncError {
  constructor(adapterId: string, url: string) {
    super(adapterId, `The platform's answer for ${url} is too large.`, { url });
    this.name = "ResponseTooLargeError";
  }
}

export const MAX_JSON_BYTES = 32 * 1024 * 1024;

export interface RunLimits {
  /** Source requests one run may make. */
  readonly maxRequests: number;
  /** Source items (records, entries, pages' elements) one run may buffer. */
  readonly maxItems: number;
  /**
   * Response bytes one run may read in total: a bound on what an adapter that stages a whole
   * run in memory can retain. Optional so hosts can pass the request and item limits alone.
   */
  readonly maxBytes?: number;
  /** Total wall-clock allowance, including source waits and retries (30 minutes by default). */
  readonly maxDurationMs?: number;
}

export const DEFAULT_RUN_LIMITS: Readonly<Required<RunLimits>> = Object.freeze({
  maxRequests: 20_000,
  maxItems: 2_000_000,
  maxBytes: 512 * 1024 * 1024,
  maxDurationMs: 30 * 60 * 1000,
});

export type BudgetResource = "requests" | "items" | "bytes" | "duration";

/** A failed, potentially partial import; the runner retains the previous successful state. */
export class RunBudgetExceededError extends IntegrationSyncError {
  constructor(
    adapterId: string,
    readonly resource: BudgetResource,
    readonly limit: number,
  ) {
    const label = { requests: "request", items: "item", bytes: "data", duration: "duration" }[
      resource
    ];
    super(
      adapterId,
      `The import exceeded its ${label} budget. Partial data may have been saved; the checkpoint is unchanged.`,
    );
    this.name = "RunBudgetExceededError";
  }
}

export class RunBudget {
  private requests = 0;
  private itemCount = 0;
  private byteCount = 0;
  private readonly limits: Required<RunLimits>;
  private failure?: RunBudgetExceededError;
  private readonly startedAt = performance.now();
  constructor(
    private readonly adapterId: string,
    limits: Partial<RunLimits> = {},
  ) {
    this.limits = {
      maxRequests: limits.maxRequests ?? DEFAULT_RUN_LIMITS.maxRequests,
      maxItems: limits.maxItems ?? DEFAULT_RUN_LIMITS.maxItems,
      maxBytes: limits.maxBytes ?? DEFAULT_RUN_LIMITS.maxBytes,
      maxDurationMs: limits.maxDurationMs ?? DEFAULT_RUN_LIMITS.maxDurationMs,
    };
    for (const [key, value] of Object.entries(this.limits))
      if (!Number.isSafeInteger(value) || value < 0)
        throw new TypeError(`${key} must be a non-negative safe integer.`);
  }

  private check(n: number, total: number, resource: BudgetResource, limit: number): void {
    this.checkTime();
    if (!Number.isSafeInteger(n) || n < 0)
      throw new TypeError("Budget charges must be non-negative safe integers.");
    if (n > limit - total) {
      this.failure = new RunBudgetExceededError(this.adapterId, resource, limit);
      throw this.failure;
    }
  }

  /** Time still available for source backoff; never wait beyond the run deadline. */
  get remainingMs(): number {
    return Math.max(0, this.limits.maxDurationMs - (performance.now() - this.startedAt));
  }

  /** Check even between requests; exhaustion is sticky across all charge types. */
  checkTime(): void {
    if (this.failure) throw this.failure;
    if (this.remainingMs === 0) throw this.expire();
  }

  expire(): RunBudgetExceededError {
    this.failure ??= new RunBudgetExceededError(
      this.adapterId,
      "duration",
      this.limits.maxDurationMs,
    );
    return this.failure;
  }

  /** Count one source request; throws once the run exceeds its request budget. */
  request(): void {
    this.check(1, this.requests, "requests", this.limits.maxRequests);
    this.requests++;
  }

  /** Count `n` buffered source items; throws once the run exceeds its item budget. */
  items(n: number): void {
    this.check(n, this.itemCount, "items", this.limits.maxItems);
    this.itemCount += n;
  }

  /** Count `n` response bytes read; throws once the run exceeds its byte budget. */
  bytes(n: number): void {
    this.check(n, this.byteCount, "bytes", this.limits.maxBytes);
    this.byteCount += n;
  }
}

/**
 * Read and parse a JSON body without buffering more than `maxBytes`; with a `budget`, the
 * bytes also count towards the run's data budget as they arrive.
 */
export async function readJson(
  res: Response,
  adapterId: string,
  url: string,
  maxBytes = MAX_JSON_BYTES,
  budget?: RunBudget,
  signal?: AbortSignal,
): Promise<unknown> {
  const bytes = await readBytes(res, adapterId, url, maxBytes, budget, signal);
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch (cause) {
    throw new IntegrationSyncError(adapterId, `The platform answered ${url} with invalid JSON.`, {
      url,
      cause,
    });
  }
}

/** Read a bounded binary body; shared with JSON and per-file Drive content. */
export async function readBytes(
  res: Response,
  adapterId: string,
  url: string,
  maxBytes: number,
  budget?: RunBudget,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  if (signal?.aborted)
    throw new IntegrationSyncError(adapterId, "Source response cancelled or timed out.");
  limitSourceBody(res, maxBytes);
  const tooLarge = () => new ResponseTooLargeError(adapterId, url);
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    void res.body?.cancel().catch(() => undefined);
    throw tooLarge();
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (res.body) {
    const reader = res.body.getReader();
    let abort: (() => void) | undefined;
    const aborted = new Promise<never>((_, reject) => {
      abort = () => {
        void reader.cancel().catch(() => undefined);
        reject(new IntegrationSyncError(adapterId, "Source response cancelled or timed out."));
      };
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
    });
    try {
      for (;;) {
        const { done, value } = await Promise.race([reader.read(), aborted]);
        if (signal?.aborted)
          throw new IntegrationSyncError(adapterId, "Source response cancelled or timed out.");
        if (done) break;
        size += value.byteLength;
        budget?.bytes(value.byteLength);
        if (size > maxBytes) throw tooLarge();
        chunks.push(value);
      }
    } catch (error) {
      // Cancellation must not delay or replace the original cap, deadline or abort error.
      void reader.cancel().catch(() => undefined);
      throw error;
    } finally {
      if (abort) signal?.removeEventListener("abort", abort);
      reader.releaseLock();
    }
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/** Factory and host limits can only tighten each other; undefined never erases a value. */
export function stricterLimits(...sources: (Partial<RunLimits> | undefined)[]): Partial<RunLimits> {
  const result: Partial<Record<keyof RunLimits, number>> = {};
  for (const source of sources) {
    for (const key of Object.keys(DEFAULT_RUN_LIMITS) as (keyof RunLimits)[]) {
      const value = source?.[key];
      if (value === undefined) continue;
      if (!Number.isSafeInteger(value) || value < 0)
        throw new TypeError(`${key} must be a non-negative safe integer.`);
      result[key] = Math.min(result[key] ?? value, value);
    }
  }
  return result;
}
