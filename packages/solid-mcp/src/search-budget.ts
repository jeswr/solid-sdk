// AUTHORED-BY Codex GPT-6.1-Sol
import { limitedBody } from "./content.js";

/** One resource/deadline budget shared by discovery, hints, and the crawl. */
export class SearchBudget {
  private readonly claimed = new Set<string>();
  private readonly controller = new AbortController();
  private stopped = false;
  private readonly deadline: number;

  constructor(
    private readonly maxResources: number,
    maxTimeMs: number,
  ) {
    this.deadline = Date.now() + maxTimeMs;
  }

  get active(): boolean {
    return !this.stopped && Date.now() < this.deadline;
  }

  claim(url: string): boolean {
    if (!this.active) return false;
    // Fragment identifiers address the same fetched resource.
    const documentUrl = new URL(url);
    documentUrl.hash = "";
    const key = documentUrl.toString();
    if (this.claimed.has(key)) return true;
    if (this.claimed.size >= this.maxResources) return false;
    this.claimed.add(key);
    return true;
  }

  stop(): void {
    this.stopped = true;
    this.controller.abort();
  }

  /** Bound every fetch, including profile/index reads and redirect hops. */
  wrap(fetcher: typeof fetch): typeof fetch {
    return (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : input.toString();
      if (!this.claim(url)) throw new Error("Search resource/time budget exhausted.");
      const suppliedSignal = init?.signal ?? (input instanceof Request ? input.signal : null);
      const signal = suppliedSignal
        ? AbortSignal.any([suppliedSignal, this.controller.signal])
        : this.controller.signal;
      const response = await fetcher(input, { ...init, signal });
      if (!this.active) {
        void response.body?.cancel().catch(() => {});
        throw new Error("Search deadline reached.");
      }
      // The scope guard must validate/follow redirects before any body read.
      // RDF normalization belongs to the final-response parser, not this hop.
      if ([301, 302, 303, 307, 308].includes(response.status)) return response;
      const { bytes, truncated } = await limitedBody(response, signal);
      signal.throwIfAborted();
      if (!this.active || truncated) throw new Error("Search response limit reached.");
      const bounded = new Response(response.body === null ? null : new Uint8Array(bytes), {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
      // Response's constructor has no URL option; fetchRdf uses this effective
      // URL as the base for relative RDF references after redirects.
      Object.defineProperty(bounded, "url", { value: response.url });
      return bounded;
    }) as typeof fetch;
  }
}

export function searchLimit(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 2_147_483_647) {
    throw new Error(`${name} must be a finite non-negative integer at most 2147483647.`);
  }
  return value;
}
