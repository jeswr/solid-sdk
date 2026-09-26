import type { KeyValueStore } from "@key-value-kit/core"
import * as DPoP from "dpop"
import * as oauth from "oauth4webapi"
import type { AuthorizationServerProvider } from "./AuthorizationServerProvider.js"
import type { ChallengeContext } from "./challenge.js"
import { generateDPoPKey, withDPoPNonceRetry } from "./dpopNonce.js"
import { FencedCache, type FenceTicket, type Stamped } from "./FencedCache.js"
import { clientAuthFor } from "./serverQuirks.js"
import type { SessionFence } from "./SessionFence.js"
import { oauthOptions, type HttpOptions } from "./transport.js"
import type { TokenProvider } from "./TokenProvider.js"

/** A DPoP-bound client credentials access token (structured-cloneable; the key is non-extractable). */
export type ClientCredentialsToken = {accessToken: string, dpopKey: CryptoKeyPair, expiresAt?: number}

export interface ClientCredentialsOptions {
    /** @defaultValue "webid" */
    readonly scope?: string
    readonly http?: HttpOptions
    /** Apply the compatibility exceptions in `serverQuirks.ts` for the listed issuers. @defaultValue true */
    readonly serverQuirks?: boolean
    readonly fence?: SessionFence
    /** Required with a supplied store. */
    readonly namespace?: string
    /** Token cache (memory by default). Requires `namespace` and a `fence` shared by every instance using it. */
    readonly tokenStore?: KeyValueStore<Stamped<ClientCredentialsToken>>
}

/**
 * OAuth 2.0 client credentials grant with DPoP-bound tokens, for scripts and services acting as themselves
 * (e.g. Community Solid Server client credentials). Tokens are cached per issuer and client in a
 * {@link FencedCache}, so {@link forget} also cancels grants in progress.
 */
export class ClientCredentialsTokenProvider implements TokenProvider {
    readonly #asProvider: AuthorizationServerProvider
    readonly #client: oauth.Client
    readonly #options: ClientCredentialsOptions
    readonly #tokens: FencedCache<ClientCredentialsToken>
    readonly #issued = new Map<string, string>()

    constructor(asProvider: AuthorizationServerProvider, clientId: string, clientSecret: string, options: ClientCredentialsOptions = {}) {
        this.#asProvider = asProvider
        this.#client = {client_id: clientId, client_secret: clientSecret, token_endpoint_auth_method: "client_secret_basic"}
        this.#options = options
        this.#tokens = new FencedCache("client-credentials", {
            ...(options.namespace === undefined ? {} : {namespace: options.namespace}),
            ...(options.tokenStore === undefined ? {} : {store: options.tokenStore}),
            ...(options.fence === undefined ? {} : {fence: options.fence}),
        })
    }

    async matches(_: Request, challenge?: ChallengeContext): Promise<boolean> {
        const challenges = challenge?.challenges ?? []
        return challenges.length === 0 || challenges.some(c => c.scheme === "dpop" || c.scheme === "bearer")
    }

    async upgrade(request: Request, challenge?: ChallengeContext): Promise<Request> {
        const ticket = await this.#tokens.ticket(request.signal)
        const as = await this.#asProvider.getAuthorizationServer(request, challenge)
        const key = await this.#tokens.key([as.issuer, this.#client.client_id, this.#options.scope ?? "webid"])
        const token = await this.#tokens.locked(key, ticket, async () => {
            const cached = await this.#tokens.read(key, ticket)
            if (cached !== undefined && (cached.expiresAt === undefined || Date.now() < cached.expiresAt - 30_000)) return cached
            await this.#tokens.remove(key)
            return await this.#tokens.write(key, await this.#grant(as, ticket), ticket)
        })

        const url = new URL(request.url)
        url.search = url.hash = ""
        const proof = await DPoP.generateProof(token.dpopKey, url.href, request.method, challenge?.response.headers.get("DPoP-Nonce") ?? undefined, token.accessToken)
        await this.#tokens.assertCurrent(ticket)
        this.#issued.set(token.accessToken, key)
        const headers = new Headers(request.headers)
        headers.set("DPoP", proof)
        headers.set("Authorization", `DPoP ${token.accessToken}`)
        return new Request(request, {headers})
    }

    async invalidate(upgraded: Request): Promise<void> {
        const rejected = upgraded.headers.get("Authorization")?.replace(/^DPoP /, "")
        const key = rejected === undefined ? undefined : this.#issued.get(rejected)
        if (key !== undefined) await this.#tokens.removeIf(key, token => token.accessToken === rejected)
    }

    async forget(): Promise<void> {
        this.#issued.clear()
        await this.#tokens.forget()
    }

    async #grant(as: oauth.AuthorizationServer, ticket: FenceTicket): Promise<ClientCredentialsToken> {
        const dpopKey = await generateDPoPKey(as)
        const dpop = oauth.DPoP(this.#client, dpopKey)
        const result = await withDPoPNonceRetry(async () => {
            const response = await oauth.clientCredentialsGrantRequest(as, this.#client, clientAuthFor(as.issuer, this.#client, this.#options.serverQuirks ?? true), {scope: this.#options.scope ?? "webid"}, {...oauthOptions(this.#options.http, ticket.signal), DPoP: dpop})
            return await oauth.processClientCredentialsResponse(as, this.#client, response)
        })
        const token: ClientCredentialsToken = {accessToken: result.access_token, dpopKey}
        if (result.expires_in !== undefined) token.expiresAt = Date.now() + result.expires_in * 1000
        return token
    }
}
