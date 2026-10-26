// AUTHORED-BY Claude Opus 5.5
/**
 * Resource bounds for source traffic. Every JSON response is read through a byte cap, and an
 * adapter that follows pagination owns one RunBudget per run, so a source that keeps returning
 * pages (or very large ones) fails the run, keeping the checkpoint, instead of exhausting memory.
 */
import { IntegrationSyncError } from "./errors.js";

/** Largest JSON response any adapter parses. */
export const MAX_JSON_BYTES = 32 * 1024 * 1024;

export interface RunLimits {
  /** Source requests one run may make. */
  readonly maxRequests: number;
  /** Source items (records, entries, pages' elements) one run may buffer. */
  readonly maxItems: number;
}

export const DEFAULT_RUN_LIMITS: RunLimits = { maxRequests: 20_000, maxItems: 2_000_000 };

export class RunBudget {
  private requests = 0;
  private itemCount = 0;
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
}

/** Read and parse a JSON body without buffering more than `maxBytes`. */
export async function readJson(
  res: Response,
  adapterId: string,
  url: string,
  maxBytes = MAX_JSON_BYTES,
): Promise<unknown> {
  const tooLarge = () =>
    new IntegrationSyncError(adapterId, `The platform's answer for ${url} is too large.`, { url });
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
