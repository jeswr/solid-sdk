// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Samu Lang
// Copyright (c) 2026 Jesse Wright
// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate; see docs/MODEL-PROVENANCE.md

import * as oauth from "oauth4webapi";
import { dpopBoundRequest } from "./dpopBoundRequest.js";
import type { TokenExchange, TokenProvider } from "./TokenProvider.js";
import type { WebAuthnConfig } from "./WebAuthnTokenExchange.js";
import { WebAuthnTokenExchange } from "./WebAuthnTokenExchange.js";

/**
 * Redirect-free Solid-OIDC re-authentication with a WebAuthn (passkey) assertion,
 * as a self-contained {@link TokenProvider}.
 *
 * ## The reuse decision (why the provider is the only new binding code)
 *
 * The published `@solid/reactive-authentication@0.1.x` — the library the suite
 * apps consume — has **diverged** from the `reactive-authentication-js` fork the
 * WebAuthn client subclassed. Same author/lineage (Samu Lang), same
 * `TokenProvider` shape, but the published library's `DPoPTokenProvider`
 * constructor is `(callbackUri, getCodeCallback, getIssuerCallback)` and has
 * **no `TokenExchange` Strategy seam**. So the fork's
 * `WebAuthnTokenProvider extends DPoPTokenProvider(new WebAuthnTokenExchange(...))`
 * cannot subclass the published library: there is nothing to inject the exchange
 * into.
 *
 * What the published library DOES share is the consumer-facing
 * {@link TokenProvider} interface (`matches`/`upgrade`/optional `invalidate`) —
 * the contract `ReactiveFetchManager` iterates. So the design is: reuse the
 * {@link WebAuthnTokenExchange} acquisition logic verbatim, and re-express the
 * *generic DPoP-binding provider* directly against the shared `TokenProvider`
 * interface. This provider is the only genuinely new code the divergence forces.
 *
 * On a 401 the orchestrator calls {@link upgrade}, which:
 * 1. generates one DPoP keypair/handle (shared between the token-endpoint proof
 *    and the resource proof, so the binding is consistent — RFC 9449);
 * 2. delegates to `exchange.acquire(...)` to obtain a DPoP-bound token; and
 * 3. returns the request upgraded with `Authorization: DPoP <token>` + a
 *    resource-bound `DPoP` proof.
 */
export class WebAuthnTokenProvider implements TokenProvider {
  readonly #exchange: TokenExchange;

  /**
   * @param config Per-issuer WebAuthn configuration, or a pre-built
   * {@link TokenExchange} (e.g. for tests or alternate acquisition strategies).
   */
  constructor(config: WebAuthnConfig | TokenExchange) {
    this.#exchange = isTokenExchange(config) ? config : new WebAuthnTokenExchange(config);
  }

  /** Delegate host selection to the injected exchange. */
  async matches(request: Request): Promise<boolean> {
    return this.#exchange.matches(request);
  }

  async upgrade(request: Request): Promise<Request> {
    // One keypair/handle for the whole upgrade: the token-endpoint proof and the
    // resource proof are signed by the same key (RFC 9449), and the handle
    // caches any server-issued `DPoP-Nonce`.
    const dpopKey = await oauth.generateKeyPair("ES256", {
      extractable: false,
    });
    const dpop = oauth.DPoP({}, dpopKey);

    const tokenResult = await this.#exchange.acquire({ request, dpop });

    return dpopBoundRequest(request, tokenResult.access_token, dpop);
  }

  /**
   * No-op: a WebAuthn upgrade is stateless — it mints a fresh DPoP keypair and
   * runs a fresh assertion ceremony on every {@link upgrade}, so there is no
   * cached credential to invalidate. Present to satisfy the optional
   * {@link TokenProvider.invalidate} the published reactive-auth library added.
   */
  async invalidate(_request: Request): Promise<void> {
    // intentionally empty
  }
}

/** Duck-type the {@link TokenExchange} strategy apart from a {@link WebAuthnConfig}. */
function isTokenExchange(value: WebAuthnConfig | TokenExchange): value is TokenExchange {
  return typeof (value as TokenExchange).acquire === "function";
}
