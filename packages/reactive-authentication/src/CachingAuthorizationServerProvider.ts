import type { KeyValueStore } from "@key-value-kit/core";
import { createMemoryStore } from "@key-value-kit/storage/memory";
import type * as oauth from "oauth4webapi";
import type { AuthorizationServerProvider } from "./AuthorizationServerProvider.js";
import { type ContextKey, requestUrlKey } from "./ContextKey.js";
import type { ChallengeContext } from "./challenge.js";

/** Caches authorization server metadata for a request. */
export class CachingAuthorizationServerProvider implements AuthorizationServerProvider {
  readonly #cache: KeyValueStore<oauth.AuthorizationServer>;
  readonly #original: AuthorizationServerProvider;
  readonly #key: ContextKey;

  constructor(
    original: AuthorizationServerProvider,
    cache: KeyValueStore<oauth.AuthorizationServer> = createMemoryStore(),
    key: ContextKey = requestUrlKey,
  ) {
    this.#cache = cache;
    this.#original = original;
    this.#key = key;
  }

  async getAuthorizationServer(
    request: Request,
    challenge?: ChallengeContext,
  ): Promise<oauth.AuthorizationServer> {
    const key = await this.#key(request, challenge);
    const cached = await this.#cache.getItem(key);
    if (cached !== null) {
      return cached;
    }

    const fresh = await this.#original.getAuthorizationServer(request, challenge);
    await this.#cache.setItem(key, fresh);
    return fresh;
  }
}
