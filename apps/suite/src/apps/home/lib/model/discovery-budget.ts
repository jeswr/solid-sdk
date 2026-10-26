// AUTHORED-BY Codex GPT-6
import { readResource } from "./rdf";

export interface DiscoveryLimits {
  maxRequests?: number;
  /** Wall-clock limit for the whole discovery, including Type Index reads. Defaults to 30s. */
  timeoutMs?: number;
  signal?: AbortSignal;
}

/** Pass the same budget to readTypeIndexes and discoverDomainItems to bound both phases. */
export class DiscoveryBudget {
  readonly signal: AbortSignal;
  private readonly maxRequests: number;
  private readonly callerSignal: AbortSignal | undefined;
  private requests = 0;
  private exhausted = false;

  constructor(options: DiscoveryLimits = {}) {
    this.maxRequests = options.maxRequests ?? 256;
    if (!Number.isSafeInteger(this.maxRequests) || this.maxRequests < 1)
      throw new TypeError("Expected a positive request budget");
    const timeoutMs = options.timeoutMs ?? 30_000;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2_147_483_647)
      throw new TypeError("Expected a positive timeout in milliseconds (at most 2147483647)");
    this.callerSignal = options.signal;
    const deadline = AbortSignal.timeout(timeoutMs);
    this.signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline;
  }

  /** Caller cancellation rejects; budget/deadline exhaustion reports incomplete results. */
  get truncated(): boolean {
    this.throwIfCancelled();
    return this.exhausted || this.signal.aborted;
  }

  throwIfCancelled(): void {
    this.callerSignal?.throwIfAborted();
  }

  async read(fetch: typeof globalThis.fetch, url: string) {
    if (this.truncated) return;
    if (this.requests >= this.maxRequests) {
      this.exhausted = true;
      return;
    }
    this.requests++;
    try {
      const resource = await readResource(fetch, url, this.signal);
      if (!this.truncated) return resource;
    } catch (error) {
      if (!this.truncated) throw error;
    }
    return undefined;
  }
}

export interface DiscoveryBudgetOptions extends DiscoveryLimits {
  /** Shared budget; when supplied, its limits and signal govern both discovery phases. */
  budget?: DiscoveryBudget;
}
