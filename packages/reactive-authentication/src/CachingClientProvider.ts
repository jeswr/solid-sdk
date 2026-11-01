import type { KeyValueStore } from "@key-value-kit/core";
import { createMemoryStore } from "@key-value-kit/storage/memory";
import type * as oauth from "oauth4webapi";
import type { ClientProvider } from "./ClientProvider.js";

/**
 * Caches client registrations per issuer and redirect URI.
 *
 * Registrations may contain client secrets: keep the default memory store unless persistence is intended.
 */
export class CachingClientProvider implements ClientProvider {
  readonly #cache: KeyValueStore<oauth.Client>;
  readonly #original: ClientProvider;

  constructor(original: ClientProvider, cache: KeyValueStore<oauth.Client> = createMemoryStore()) {
    this.#cache = cache;
    this.#original = original;
  }

  async getClient(
    as: oauth.AuthorizationServer,
    redirectUri: string,
    signal: AbortSignal,
  ): Promise<oauth.Client> {
    const key = JSON.stringify([as.issuer, redirectUri]);
    const cached = await this.#cache.getItem(key);
    if (cached !== null) {
      return cached;
    }

    const fresh = await this.#original.getClient(as, redirectUri, signal);
    await this.#cache.setItem(key, fresh);
    return fresh;
  }
}
