import type { KeyValueStore } from "@key-value-kit/core"
import { createMemoryStore } from "@key-value-kit/storage/memory"
import * as DPoP from "dpop"
import type { AuthorizationServerProvider } from "./AuthorizationServerProvider.js"
import type { ChallengeContext } from "./challenge.js"
import type { ClientProvider } from "./ClientProvider.js"
import type { CodeProvider } from "./CodeProvider.js"
import type { ContextKey } from "./ContextKey.js"
import type { Identity } from "./Identity.js"
import { accessTokenUsable, OidcSession, type DPoPTokenCacheEntry, type OidcSessionOptions } from "./OidcSession.js"
import { storageContextKey } from "./StorageContext.js"
import type { TokenProvider } from "./TokenProvider.js"

export type { DPoPTokenCacheEntry } from "./OidcSession.js"

export interface DPoPTokenProviderOptions extends Omit<OidcSessionOptions, "cache"> {
    /**
     * Groups requests that may share a session. Defaults to {@link storageContextKey} with an in-memory
     * mapping cache: resources of one verified Solid/LWS storage share a session; anything unverified gets
     * its own (exact URL). Verified mappings are remembered, because later challenges (e.g. after a
     * rejected token) need not repeat the discovery Link headers.
     */
    readonly context?: ContextKey
}

/**
 * Solid-OIDC: authenticates requests with a DPoP-bound access token from the user's OpenID provider.
 *
 * Sessions are per credential context — namespace, account, issuer, redirect URI, scopes and storage
 * (see {@link OidcSession}) — and a fresh DPoP proof bound to the method and URL is generated per request.
 *
 * Note that Solid-OIDC access tokens are not audience-restricted to a storage (the ID token audience is
 * `solid`); per-storage sessions limit which storages receive a given token, they do not make the token
 * itself storage-bound. The credential boundary decides which URLs may receive any token at all.
 */
export class DPoPTokenProvider implements TokenProvider {
    readonly #asProvider: AuthorizationServerProvider
    readonly #session: OidcSession
    readonly #context: ContextKey
    readonly #issued = new Map<string, {issuer: string, context: string}>()

    constructor(callbackUri: string, codeProvider: CodeProvider, asProvider: AuthorizationServerProvider, clientProvider: ClientProvider, cache?: KeyValueStore<DPoPTokenCacheEntry>, options: DPoPTokenProviderOptions = {}) {
        this.#asProvider = asProvider
        this.#context = options.context ?? storageContextKey({mappings: createMemoryStore(), ...(options.http === undefined ? {} : {http: options.http})})
        this.#session = new OidcSession(callbackUri, codeProvider, clientProvider, cache === undefined ? options : {...options, cache})
    }

    /**
     * Answers challenges without a scheme preference or with DPoP or Bearer schemes. UMA challenges need an
     * RPT from the named authorization server ({@link SolidUmaTokenProvider}), not the OP's access token.
     */
    async matches(_: Request, challenge?: ChallengeContext): Promise<boolean> {
        const challenges = challenge?.challenges ?? []
        return challenges.length === 0 || challenges.some(c => c.scheme === "dpop" || c.scheme === "bearer")
    }

    async upgrade(request: Request, challenge?: ChallengeContext): Promise<Request> {
        const as = await this.#asProvider.getAuthorizationServer(request, challenge)
        const context = await this.#context(request, challenge)
        const entry = (await this.#session.get(as, context, request.signal, accessTokenUsable))!
        const accessToken = entry.tokenResult.access_token
        this.#remember(accessToken, {issuer: as.issuer, context})

        const proof = await DPoP.generateProof(entry.dpopKey, htu(request.url), request.method, nonceFor(request, challenge), accessToken)
        await this.#session.assertCurrent(entry, request.signal)
        const headers = new Headers(request.headers)
        headers.set("DPoP", proof)
        headers.set("Authorization", `DPoP ${accessToken}`)
        return new Request(request, {headers})
    }

    async invalidate(upgraded: Request): Promise<void> {
        const token = upgraded.headers.get("Authorization")?.replace(/^DPoP /, "")
        const issued = token === undefined ? undefined : this.#issued.get(token)
        if (token !== undefined && issued !== undefined) await this.#session.invalidate(issued.issuer, issued.context, token)
    }

    async forget(): Promise<void> {
        this.#issued.clear()
        await this.#session.forget()
    }

    /**
     * Restores a session for the request's issuer without user interaction (cached, or via a persisted
     * refresh token), reporting its identity; `undefined` when there is none.
     */
    async restore(request: Request): Promise<Identity | undefined> {
        const as = await this.#asProvider.getAuthorizationServer(request)
        const context = await this.#context(request)
        return (await this.#session.get(as, context, request.signal, accessTokenUsable, false))?.identity
    }

    /** The validated identity of the session a request would use, if established. Never starts a flow. */
    async identity(request: Request): Promise<Identity | undefined> {
        const as = await this.#asProvider.getAuthorizationServer(request)
        return await this.#session.identity(as.issuer, await this.#context(request))
    }

    #remember(accessToken: string, issued: {issuer: string, context: string}) {
        this.#issued.set(accessToken, issued)
        if (this.#issued.size > 100) this.#issued.delete(this.#issued.keys().next().value!)
    }
}

/** RFC 9449 §4.2: `htu` excludes query and fragment. */
function htu(url: string): string {
    const u = new URL(url)
    u.search = ""
    u.hash = ""
    return u.href
}

/** A resource server nonce (RFC 9449 §9) from the challenge, if it came from the request's origin. */
function nonceFor(request: Request, challenge: ChallengeContext | undefined): string | undefined {
    const response = challenge?.response
    if (response === undefined) return undefined
    if (response.url !== "" && new URL(response.url).origin !== new URL(request.url).origin) return undefined
    return response.headers.get("DPoP-Nonce") ?? undefined
}
