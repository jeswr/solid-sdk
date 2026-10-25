import type { KeyValueStore } from "@key-value-kit/core"
import * as oauth from "oauth4webapi"
import type { CodeProvider } from "../CodeProvider.js"
import type { Identity } from "../Identity.js"
import { accessTokenUsable, OidcSession, type DPoPTokenCacheEntry, type RefreshSessionRecord } from "../OidcSession.js"
import { ReactiveAuthenticationError } from "../ReactiveAuthenticationError.js"
import { SessionFence } from "../SessionFence.js"
import { oauthOptions, type HttpOptions } from "../transport.js"
import { abortable } from "./abortable.js"
import type { AccessToken, AccessTokenRequest, AccessTokenSource } from "./AccessTokenSource.js"

export interface OAuthCodeSourceOptions {
    /**
     * The trusted authorization server: an issuer to discover (OpenID Connect discovery when `openid` is
     * requested, RFC 8414 otherwise; override with `discovery`), or explicit metadata for servers without
     * discovery (its endpoints must be HTTPS unless `http.allowInsecureRequests`). Never taken from challenges.
     */
    readonly issuer?: string | URL
    readonly discovery?: "oidc" | "oauth2"
    readonly authorizationServer?: oauth.AuthorizationServer

    /** The client registered with the provider (not a Solid Client Identifier Document). */
    readonly clientId: string

    /**
     * Confidential clients only — **server-side code**. Refused in browsers and workers (anything shipped there
     * is public); browser apps register a public client and rely on PKCE.
     */
    readonly clientSecret?: string

    /** `client_secret_basic` (default with a secret) or `client_secret_post`. */
    readonly tokenEndpointAuthMethod?: "client_secret_basic" | "client_secret_post"

    /**
     * The registered redirect URI; authorization responses must arrive exactly there (origin, path and any
     * fixed query parameters).
     */
    readonly redirectUri: string

    /**
     * Exactly the scopes to request. Add `openid` for OpenID Connect identity; `offline_access` (where the
     * provider uses it) for refresh tokens — it does not add `prompt=consent` unless `prompt` says so.
     */
    readonly scopes: readonly string[]

    /** RFC 8707 resource indicator for the one API these tokens are for (sent in authorization and token requests). */
    readonly resource?: string

    /** Provider-specific audience parameter (e.g. Auth0), sent like `resource`. */
    readonly audience?: string

    /** `prompt` for the authorization request, e.g. `login`, `consent` or `select_account`. */
    readonly prompt?: string

    /**
     * Further authorization request parameters (e.g. `login_hint`, Google's `access_type`). Protocol parameters,
     * `prompt`, `resource` and `audience` have their own options and are refused here.
     */
    readonly parameters?: Readonly<Record<string, string>>

    /** Runs the authorization UI: `<authorization-code-flow>`, a service-worker bridge, or your own. */
    readonly codeProvider: CodeProvider

    /** Try `prompt=none` first (OpenID Connect only). @defaultValue false */
    readonly silentFirst?: boolean

    readonly http?: HttpOptions
    readonly namespace?: string
    readonly account?: string
    /** Orders sessions against logout; required (shared) with a supplied `cache` or `sessionStore`. */
    readonly fence?: SessionFence
    /** Credential cache (memory by default); a supplied store needs `namespace` and a shared `fence`. */
    readonly cache?: KeyValueStore<DPoPTokenCacheEntry>
    /** Refresh-only persistence; needs `namespace` and a shared persistent `fence`. */
    readonly sessionStore?: KeyValueStore<RefreshSessionRecord>
}

const reservedParameters = new Set(["prompt", "resource", "audience"])

/**
 * Authorization code grant with S256 PKCE for a registered OAuth 2.0 / OpenID Connect client (Auth0, Keycloak,
 * Okta, Entra ID without MSAL, Google server apps…), built on the same {@link OidcSession} as Solid-OIDC but
 * with generic defaults: no DPoP, no `webid`/`offline_access` added, no `prompt=none` unless asked, no Solid
 * server quirks, S256 required, Bearer tokens only. Without `openid` it is plain OAuth (no nonce, no ID token
 * expected); with `openid` the ID token's issuer, audience and nonce are validated and {@link identity}
 * reports its claims. Refresh tokens (rotating or not) are used when the provider issues them.
 *
 * Every operation is bound to the fence generation current when it starts (discovery included), so a logout
 * meanwhile aborts it rather than letting it start a new session.
 */
export class OAuthCodeSource implements AccessTokenSource {
    readonly #options: OAuthCodeSourceOptions
    readonly #session: OidcSession
    readonly #fence: SessionFence
    readonly #context: string
    readonly id: string
    #metadata: Promise<oauth.AuthorizationServer> | undefined

    constructor(options: OAuthCodeSourceOptions) {
        if ((options.issuer === undefined) === (options.authorizationServer === undefined)) {
            throw new TypeError("Configure exactly one of issuer or authorizationServer")
        }
        if (options.clientSecret !== undefined && isBrowserOrWorker()) {
            throw new TypeError("Client secrets must not be used in browsers or workers; register a public client")
        }
        for (const name of Object.keys(options.parameters ?? {})) {
            if (reservedParameters.has(name)) throw new TypeError(`Use the ${name} option instead of parameters.${name}`)
        }
        if ((options.cache !== undefined || options.sessionStore !== undefined) && options.fence === undefined) {
            throw new TypeError("A supplied credential store requires a SessionFence shared by every instance using it")
        }
        this.#options = options
        this.#fence = options.fence ?? new SessionFence(`local-${crypto.randomUUID()}`, {broadcast: false})

        const client: oauth.Client = options.clientSecret === undefined
            ? {client_id: options.clientId, token_endpoint_auth_method: "none"}
            : {client_id: options.clientId, client_secret: options.clientSecret, token_endpoint_auth_method: options.tokenEndpointAuthMethod ?? "client_secret_basic"}
        const indicators = {
            ...(options.resource === undefined ? {} : {resource: options.resource}),
            ...(options.audience === undefined ? {} : {audience: options.audience}),
        }

        this.#session = new OidcSession(options.redirectUri, options.codeProvider, {getClient: async () => client}, {
            scopes: options.scopes,
            dpop: false,
            offlineAccess: false,
            consentForOfflineAccess: false,
            serverQuirks: false,
            requireS256: true,
            silentFirst: options.silentFirst ?? false,
            authorizationParameters: {...options.parameters, ...indicators},
            tokenParameters: indicators,
            revokeOnForget: true,
            fence: this.#fence,
            ...(options.prompt === undefined ? {} : {prompt: options.prompt}),
            ...(options.http === undefined ? {} : {http: options.http}),
            ...(options.namespace === undefined ? {} : {namespace: options.namespace}),
            ...(options.account === undefined ? {} : {account: options.account}),
            ...(options.cache === undefined ? {} : {cache: options.cache}),
            ...(options.sessionStore === undefined ? {} : {sessionStore: options.sessionStore}),
        })

        // Everything that changes which token is issued keys the cache and identifies the source.
        const configuration = [options.clientId, options.resource ?? "", options.audience ?? "", options.prompt ?? "",
            Object.entries(options.parameters ?? {}).sort(([a], [b]) => a.localeCompare(b))]
        this.#context = JSON.stringify(["oauth", ...configuration])
        this.id = JSON.stringify(["oauth", String(options.issuer ?? options.authorizationServer?.issuer), options.redirectUri,
            [...options.scopes].sort(), ...configuration, options.namespace ?? "default", options.account ?? "default"])
    }

    async getAccessToken({signal, rejectedToken}: AccessTokenRequest): Promise<AccessToken> {
        // Bound to the session generation from the very start: discovery included.
        const bound = AbortSignal.any([signal, this.#fence.signal])
        const generation = await this.#fence.generation()
        const as = await abortable(this.#authorizationServer(), bound)
        bound.throwIfAborted()
        await this.#fence.assertCurrent(generation)

        if (rejectedToken !== undefined) await this.#session.invalidate(as.issuer, this.#context, rejectedToken)
        const entry = (await this.#session.get(as, this.#context, bound, accessTokenUsable))!
        await this.#session.assertCurrent(entry, bound)
        if (entry.tokenResult.token_type !== "bearer") {
            throw new ReactiveAuthenticationError(`Expected a Bearer access token, got ${entry.tokenResult.token_type}`)
        }
        const token = entry.tokenResult.access_token
        return entry.expiresAt === undefined ? {token} : {token, expiresAt: entry.expiresAt}
    }

    /** Starts (or reuses) a session, e.g. from a sign-in button. */
    async authorize(signal: AbortSignal = new AbortController().signal): Promise<AccessToken> {
        return await this.getAccessToken({signal})
    }

    /** Validated ID token claims when `openid` was requested; `undefined` for plain OAuth. */
    async identity(): Promise<Identity | undefined> {
        const as = await this.#authorizationServer()
        return await this.#session.identity(as.issuer, this.#context)
    }

    /** Local logout (revokes refresh tokens where supported). Provider sign-out is separate. */
    async forget(): Promise<void> {
        await this.#session.forget()
    }

    /**
     * Shared metadata: one discovery request serves all callers and is not tied to any caller's signal (callers
     * stop waiting on abort instead). Failures are not cached.
     */
    async #authorizationServer(): Promise<oauth.AuthorizationServer> {
        const explicit = this.#options.authorizationServer
        if (explicit !== undefined) return explicit
        if (this.#metadata === undefined) {
            const issuer = new URL(this.#options.issuer!)
            const algorithm = this.#options.discovery ?? (this.#options.scopes.includes("openid") ? "oidc" : "oauth2")
            this.#metadata = oauth.discoveryRequest(issuer, {...oauthOptions(this.#options.http), algorithm})
                .then(response => oauth.processDiscoveryResponse(issuer, response))
            this.#metadata.catch(() => { this.#metadata = undefined })
        }
        return await this.#metadata
    }
}

/** Browsers and all worker kinds are public clients; only server runtimes may hold a client secret. */
function isBrowserOrWorker(): boolean {
    const scope = globalThis as {document?: unknown, WorkerGlobalScope?: unknown, importScripts?: unknown}
    return scope.document !== undefined || scope.WorkerGlobalScope !== undefined || typeof scope.importScripts === "function"
}
