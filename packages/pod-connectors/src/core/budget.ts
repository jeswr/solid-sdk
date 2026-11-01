// AUTHORED-BY Claude Opus 5.5
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

export const DEFAULT_RUN_LIMITS: RunLimits = {
  maxRequests: 20_000,
  maxItems: 2_000_000,
  maxBytes: 512 * 1024 * 1024,
};

export class RunBudget {
  private requests = 0;
  private itemCount = 0;
  private byteCount = 0;
  constructor(
    private readonly adapterId: string,
    private readonly limits: RunLimits = DEFAULT_RUN_LIMITS,
  ) {}

  /** Count one source request; throws once the run exceeds its request budget. */
  request(): void {
    if (++this.requests > this.limits.maxRequests)
      throw new IntegrationSyncError(this.adapterId, "The import exceeded its request budget.");
  }

  /** Count `n` buffered source items; throws once the run exceeds its item budget. */
  items(n: number): void {
    this.itemCount += n;
    if (this.itemCount > this.limits.maxItems)
      throw new IntegrationSyncError(this.adapterId, "The import exceeded its item budget.");
  }

  /** Count `n` response bytes read; throws once the run exceeds its byte budget. */
  bytes(n: number): void {
    this.byteCount += n;
    const max = this.limits.maxBytes ?? DEFAULT_RUN_LIMITS.maxBytes ?? Number.POSITIVE_INFINITY;
    if (this.byteCount > max)
      throw new IntegrationSyncError(this.adapterId, "The import exceeded its data budget.");
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
    await res.body?.cancel();
    throw tooLarge();
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (res.body) {
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      try {
        budget?.bytes(value.byteLength);
      } catch (error) {
        await reader.cancel();
        throw error;
      }
      if (size > maxBytes) {
        await reader.cancel();
        throw tooLarge();
      }
      chunks.push(value);
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
