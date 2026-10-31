import {
  ReactiveAuthenticationClient,
  type ReactiveAuthenticationOptions,
} from "./ReactiveAuthenticationClient.js";
import { SessionFence } from "./SessionFence.js";
import { type FetchFunction, nonReactiveFetch, registerReactiveFetch } from "./transport.js";

export interface ReactiveFetchManagerOptions extends Omit<ReactiveAuthenticationOptions, "fetch"> {
  /** Transport used for every attempt. Defaults to the global `fetch` at construction time (non-reactive). */
  readonly fetch?: FetchFunction;
}

/**
 * Page-level entry point: an authenticated `fetch`, optional global registration and logout.
 *
 * Dispatches `logout` events after {@link logout} completes.
 */
export class ReactiveFetchManager extends EventTarget {
  readonly #client: ReactiveAuthenticationClient;
  readonly #transport: FetchFunction;
  readonly #fence: SessionFence;
  readonly #fetch: FetchFunction;
  #replaced: FetchFunction | undefined;

  constructor(options: ReactiveFetchManagerOptions) {
    super();
    this.#transport = options.fetch ?? nonReactiveFetch();
    // Without a caller-supplied fence, a private one still fences this manager's own fetches.
    this.#fence =
      options.fence ?? new SessionFence(`local-${crypto.randomUUID()}`, { broadcast: false });
    this.#client = new ReactiveAuthenticationClient({
      ...options,
      fetch: this.#transport,
      fence: this.#fence,
    });
    this.#fetch = (input, init) => this.#client.fetch(input, init);
    registerReactiveFetch(this.#fetch, this.#transport);
  }

  /** The reactive `fetch`. Safe to pass around unbound. */
  get fetch(): FetchFunction {
    return this.#fetch;
  }

  /** The non-reactive transport; hand this to providers and anything else that must not be upgraded. */
  get transport(): FetchFunction {
    return this.#transport;
  }

  get client(): ReactiveAuthenticationClient {
    return this.#client;
  }

  /**
   * Replaces `globalThis.fetch` with the reactive fetch. Providers keep using the replaced function
   * (see {@link nonReactiveFetch}), so their own discovery and token requests cannot deadlock.
   */
  registerGlobally(): void {
    if (this.#replaced !== undefined) return;
    this.#replaced = globalThis.fetch;
    globalThis.fetch = this.#fetch as typeof globalThis.fetch;
  }

  /** Restores the `fetch` replaced by {@link registerGlobally}. */
  unregisterGlobally(): void {
    if (this.#replaced === undefined) return;
    if (globalThis.fetch === this.#fetch)
      globalThis.fetch = this.#replaced as typeof globalThis.fetch;
    this.#replaced = undefined;
  }

  /**
   * Logs out locally: supersedes the fence (aborting in-flight fetches and upgrades, and fencing pending
   * credential writes — in other tabs too when they share a persistent fence), then makes every provider
   * forget its credentials. Providers fence their own stores in {@link TokenProvider.forget}; that happens
   * after this manager's supersession has released the fence lock, so a shared fence cannot deadlock.
   *
   * This does not end the session at the identity provider; see the provider documentation for revocation.
   */
  async logout(): Promise<void> {
    await this.#fence.supersede();
    const results = await Promise.allSettled(this.#client.providers.map((p) => p.forget?.()));
    this.dispatchEvent(new Event("logout"));

    const failures = results
      .filter((r) => r.status === "rejected")
      .map((r) => (r as PromiseRejectedResult).reason);
    if (failures.length > 0)
      throw new AggregateError(failures, "Some providers failed to forget credentials");
  }
}
