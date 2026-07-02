import type { TokenExchange, TokenProvider } from "./TokenProvider.js";
import type { WebAuthnConfig } from "./WebAuthnTokenExchange.js";
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
export declare class WebAuthnTokenProvider implements TokenProvider {
    #private;
    /**
     * @param config Per-issuer WebAuthn configuration, or a pre-built
     * {@link TokenExchange} (e.g. for tests or alternate acquisition strategies).
     */
    constructor(config: WebAuthnConfig | TokenExchange);
    /** Delegate host selection to the injected exchange. */
    matches(request: Request): Promise<boolean>;
    upgrade(request: Request): Promise<Request>;
    /**
     * No-op: a WebAuthn upgrade is stateless — it mints a fresh DPoP keypair and
     * runs a fresh assertion ceremony on every {@link upgrade}, so there is no
     * cached credential to invalidate. Present to satisfy the optional
     * {@link TokenProvider.invalidate} the published reactive-auth library added.
     */
    invalidate(_request: Request): Promise<void>;
}
//# sourceMappingURL=WebAuthnTokenProvider.d.ts.map