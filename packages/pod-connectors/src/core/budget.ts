// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY Codex GPT-6.1-Sol
/**
 * Resource bounds for source traffic. Every JSON response is read through a byte cap, and an
 * adapter that follows pagination owns one RunBudget per run, so a source that keeps returning
 * pages (or very large ones) fails the run, keeping the checkpoint, instead of exhausting memory.
 */
import { IntegrationSyncError } from "./errors.js";

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
}

export const DEFAULT_RUN_LIMITS: Readonly<Required<RunLimits>> = Object.freeze({
  maxRequests: 20_000,
  maxItems: 2_000_000,
  maxBytes: 512 * 1024 * 1024,
});

export type BudgetResource = "requests" | "items" | "bytes";

/** A failed, potentially partial import; the runner retains the previous successful state. */
export class RunBudgetExceededError extends IntegrationSyncError {
  constructor(
    adapterId: string,
    readonly resource: BudgetResource,
    readonly limit: number,
  ) {
    const label = { requests: "request", items: "item", bytes: "data" }[resource];
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
  constructor(
    private readonly adapterId: string,
    limits: Partial<RunLimits> = {},
  ) {
    this.limits = {
      maxRequests: limits.maxRequests ?? DEFAULT_RUN_LIMITS.maxRequests,
      maxItems: limits.maxItems ?? DEFAULT_RUN_LIMITS.maxItems,
      maxBytes: limits.maxBytes ?? DEFAULT_RUN_LIMITS.maxBytes,
    };
    for (const [key, value] of Object.entries(this.limits))
      if (!Number.isSafeInteger(value) || value < 0)
        throw new TypeError(`${key} must be a non-negative safe integer.`);
  }

  private check(n: number, total: number, resource: BudgetResource, limit: number): void {
    if (this.failure) throw this.failure;
    if (!Number.isSafeInteger(n) || n < 0)
      throw new TypeError("Budget charges must be non-negative safe integers.");
    if (n > limit - total) {
      this.failure = new RunBudgetExceededError(this.adapterId, resource, limit);
      throw this.failure;
    }
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
): Promise<unknown> {
  const tooLarge = () => new ResponseTooLargeError(adapterId, url);
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await res.body?.cancel().catch(() => undefined);
    throw tooLarge();
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (res.body) {
    const reader = res.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        budget?.bytes(value.byteLength);
        if (size > maxBytes) throw tooLarge();
        chunks.push(value);
      }
    } catch (error) {
      await reader.cancel().catch(() => undefined);
      throw error;
    } finally {
      reader.releaseLock();
    }
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch (cause) {
    throw new IntegrationSyncError(adapterId, `The platform answered ${url} with invalid JSON.`, {
      url,
      cause,
    });
  }
}
