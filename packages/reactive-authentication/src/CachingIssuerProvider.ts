import type { KeyValueStore } from "@key-value-kit/core";
import { createMemoryStore } from "@key-value-kit/storage/memory";
import { type ContextKey, requestUrlKey } from "./ContextKey.js";
import type { ChallengeContext } from "./challenge.js";
import type { IssuerProvider } from "./IssuerProvider.js";

/** Caches the issuer chosen for a request. Issuers are stored as `href` strings. */
export class CachingIssuerProvider implements IssuerProvider {
  readonly #cache: KeyValueStore<string>;
  readonly #original: IssuerProvider;
  readonly #key: ContextKey;

  constructor(
    original: IssuerProvider,
    cache: KeyValueStore<string> = createMemoryStore(),
    key: ContextKey = requestUrlKey,
  ) {
    this.#cache = cache;
    this.#original = original;
    this.#key = key;
  }

  async getIssuer(request: Request, challenge?: ChallengeContext): Promise<URL> {
    const key = await this.#key(request, challenge);
    const cached = await this.#cache.getItem(key);
    if (cached !== null) {
      return new URL(cached);
    }

    const fresh = await this.#original.getIssuer(request, challenge);
    await this.#cache.setItem(key, fresh.href);
    return fresh;
  }
}
