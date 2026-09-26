import type { KeyValueStore } from "@key-value-kit/core"
import { createMemoryStore } from "@key-value-kit/storage/memory"
import * as oauth from "oauth4webapi"
import { authorizationCodeGrant } from "./authorizationCodeGrant.js"
import type { ClientProvider } from "./ClientProvider.js"
import type { CodeProvider } from "./CodeProvider.js"
import { generateDPoPKey, withDPoPNonceRetry } from "./dpopNonce.js"
import type { Identity } from "./Identity.js"
import { contextKey, withLock } from "./locks.js"
import { ReactiveAuthenticationError } from "./ReactiveAuthenticationError.js"
import { clientAuthFor } from "./serverQuirks.js"
import { SessionFence } from "./SessionFence.js"
import { supportsOfflineAccess } from "./supportsOfflineAccess.js"
import { oauthOptions, type HttpOptions } from "./transport.js"
import { parseWebId, webIdTrustsIssuer } from "./webId.js"

/** Sensitive, structured-cloneable credential record. Never JSON-serialize its keys. */
export type DPoPTokenCacheEntry = {
    created: number,
    tokenResult: oauth.TokenEndpointResponse,
    dpopKey: CryptoKeyPair,
    client: oauth.Client,
    authorizationServer: oauth.AuthorizationServer,
    /** Session generation (see {@link SessionFence}) the entry was committed under. */
    generation?: number,
    /** Access token expiry (ms since epoch); absent when the server did not say. 0 marks a rejected token. */
    expiresAt?: number,
    /** ID token expiry (ms since epoch), when an ID token was issued. */
    idTokenExpiresAt?: number,
    identity?: Identity,
}

/**
 * What {@link OidcSessionOptions.sessionStore} persists: enough to restore a session with a refresh grant
 * and no user interaction. No access or ID token is included.
 */
export type RefreshSessionRecord = {
    created: number,
    generation: number,
    refreshToken: string,
    dpopKey: CryptoKeyPair,
    client: oauth.Client,
    authorizationServer: oauth.AuthorizationServer,
    identity?: Identity,
}

export interface OidcSessionOptions {
    /**
     * Isolates cache keys and locks of this application and client configuration from others sharing the
     * storage partition. Required when a cache or session store is supplied, because sharing a store
     * under a default name could hand one configuration's credentials to another.
     */
    readonly namespace?: string

    /**
     * Application-chosen account label, for applications that keep sessions for several accounts at the
     * same issuer. Switching accounts otherwise requires logout. @defaultValue "default"
     */
    readonly account?: string

    /** Scopes to request. `offline_access` is added when the server supports it. @defaultValue `["openid", "webid"]` */
    readonly scopes?: readonly string[]

    /**
     * Complete credential records. Defaults to private memory; a supplied store (shared or persistent — the
     * latter also persists access tokens) requires `namespace` and a shared `fence`.
     */
    readonly cache?: KeyValueStore<DPoPTokenCacheEntry>

    /**
     * Opt-in refresh-only persistence (e.g. IndexedDB): a reload restores the session through a refresh grant
     * without a window. Access and ID tokens are never written here. When set, it is the authoritative source
     * of refresh tokens, and a {@link fence} with a persistent generation store is required so that logout
     * outlives the page.
     */
    readonly sessionStore?: KeyValueStore<RefreshSessionRecord>

    /**
     * Orders credential writes against logout. Defaults to a private in-memory fence, which fences this
     * instance only; share one fence (with a persistent store) between providers and tabs to fence them all.
     */
    readonly fence?: SessionFence
    readonly http?: HttpOptions

    /** Check that the WebID profile lists the issuer before reporting a WebID. @defaultValue false */
    readonly verifyWebId?: boolean

    /** Extra authorization request parameters (e.g. `login_hint`). */
    readonly authorizationParameters?: Readonly<Record<string, string>>

    /** @see AuthorizationCodeGrantOptions.consentForOfflineAccess */
    readonly consentForOfflineAccess?: boolean

    /** @see AuthorizationCodeGrantOptions.serverQuirks */
    readonly serverQuirks?: boolean

    /**
     * Bind tokens to a DPoP key (Solid-OIDC). Generic OAuth/OIDC sources turn this off: no DPoP proof is
     * sent to their authorization servers. (A non-extractable key is still generated for the record type.)
     * @defaultValue true
     */
    readonly dpop?: boolean

    /**
     * Add `offline_access` when the server advertises it (`"auto"`, the Solid default), or never (`false`).
     * @defaultValue "auto"
     */
    readonly offlineAccess?: "auto" | false

    /** @see AuthorizationCodeGrantOptions.prompt */
    readonly prompt?: string

    /** @see AuthorizationCodeGrantOptions.silentFirst */
    readonly silentFirst?: boolean

    /** @see AuthorizationCodeGrantOptions.requireS256 */
    readonly requireS256?: boolean

    /** Extra token endpoint parameters for code and refresh grants (e.g. RFC 8707 `resource`). */
    readonly tokenParameters?: Readonly<Record<string, string>>

    /** Revoke refresh tokens known to this instance on {@link OidcSession.forget} when supported. @defaultValue true */
    readonly revokeOnForget?: boolean
}

/** Treat tokens as expired this long before their stated expiry. */
const expirySkewMs = 30_000

/**
 * OpenID Connect session management shared by {@link DPoPTokenProvider} (Solid-OIDC) and
 * {@link OidcIdTokenSource} (LWS OpenID suite): sessions obtained by authorization code grant and renewed
 * by (rotating) refresh grants, one per credential context (namespace, account, issuer, redirect URI,
 * scopes and a caller-supplied context such as the storage).
 *
 * - Reads, refreshes and writes of a session happen under one Web Lock, so a rotating refresh token is
 *   consumed at most once across requests, tabs and workers sharing the storage partition.
 * - With a session store, the durable record is the only refresh token ever used; memory copies only
 *   serve unexpired access tokens.
 * - Records are removed before their refresh token is consumed and replacements are written durable-first,
 *   so a crash or failed write costs a new authorization instead of leaving a spent or unpersisted token.
 * - Every entry is stamped with the fence generation; entries from before a logout are never used.
 */
export class OidcSession {
    readonly #callbackUri: string
    readonly #codeProvider: CodeProvider
    readonly #clientProvider: ClientProvider
    readonly #options: OidcSessionOptions
    readonly #cache: KeyValueStore<DPoPTokenCacheEntry>
    readonly #fence: SessionFence
    readonly #keys = new Set<string>()

    constructor(callbackUri: string, codeProvider: CodeProvider, clientProvider: ClientProvider, options: OidcSessionOptions = {}) {
        if ((options.cache !== undefined || options.sessionStore !== undefined) && !options.namespace) {
            throw new TypeError("A namespace is required when supplying a credential cache or session store")
        }
        if ((options.sessionStore !== undefined || options.cache !== undefined) && options.fence === undefined) {
            // A supplied store may be shared or persistent: only a shared (durable) fence stops another instance
            // repopulating it after logout, or a reload accepting records from before a logout.
            throw new TypeError("A supplied credential cache or session store requires a SessionFence shared by every instance using it")
        }

        this.#callbackUri = callbackUri
        this.#codeProvider = codeProvider
        this.#clientProvider = clientProvider
        this.#options = options
        this.#cache = options.cache ?? createMemoryStore()
        this.#fence = options.fence ?? new SessionFence(`local-${crypto.randomUUID()}`, {broadcast: false})
    }

    /**
     * Returns a usable session for the authorization server and credential context: cached, refreshed,
     * or (when `interactive`) newly authorized. Returns `undefined` only when not interactive and no
     * session could be restored.
     */
    async get(as: oauth.AuthorizationServer, context: string, signal: AbortSignal, usable: (entry: DPoPTokenCacheEntry, justIssued: boolean) => boolean, interactive = true): Promise<DPoPTokenCacheEntry | undefined> {
        const fence = this.#fence
        const combined = AbortSignal.any([signal, fence.signal])
        const generation = await fence.generation()
        const key = await this.#key(as.issuer, context)
        const store = this.#options.sessionStore

        return await withLock(this.#lockName(key), async () => {
            combined.throwIfAborted()
            await fence.assertCurrent(generation)

            const cached = await this.#cache.getItem(key)
            if (cached !== null && cached.generation === generation && usable(cached, false)) return cached

            // Refresh only from the authoritative copy: the durable record when there is one.
            const durable = store === undefined ? null : await store.getItem(key)
            const candidate = store === undefined ? refreshRecordOf(cached, undefined) : durable
            const record = candidate?.generation === generation ? candidate : null

            await this.#cache.removeItem(key)
            if (durable !== null && (record !== null || durable.generation !== generation)) {
                // About to consume it, or left over from before a logout.
                await store!.removeItem(key)
            }

            if (record !== null) {
                const refreshed = await this.#refresh(record, combined)
                if (refreshed !== undefined) {
                    const committed = await this.#commit(key, refreshed, generation, combined)
                    // A refresh response need not include what the caller needs (e.g. a new ID token).
                    if (usable(committed, true)) return committed
                }
            }

            if (!interactive) return undefined
            return await this.#commit(key, await this.#authorize(as, combined), generation, combined)
        }, {signal: combined})
    }

    /**
     * Throws unless `entry` belongs to the current session generation and `signal` is not aborted; call
     * right before attaching credentials, after any awaits that followed {@link get}.
     */
    async assertCurrent(entry: DPoPTokenCacheEntry, signal: AbortSignal): Promise<void> {
        signal.throwIfAborted()
        this.#fence.signal.throwIfAborted()
        await this.#fence.assertCurrent(entry.generation ?? -1)
    }

    /** Marks the access token as rejected if it is still the cached one; the next {@link get} renews it. */
    async invalidate(issuer: string, context: string, accessToken: string): Promise<void> {
        const key = await this.#key(issuer, context)
        await withLock(this.#lockName(key), async () => {
            const cached = await this.#cache.getItem(key)
            if (cached?.tokenResult.access_token === accessToken) {
                await this.#cache.setItem(key, {...cached, expiresAt: 0})
            }
        })
    }

    /** The identity of the current session, without starting any flow. */
    async identity(issuer: string, context: string): Promise<Identity | undefined> {
        const key = await this.#key(issuer, context)
        const generation = await this.#fence.generation()
        const cached = await this.#cache.getItem(key)
        if (cached?.generation === generation) return cached.identity
        const durable = await this.#options.sessionStore?.getItem(key)
        return durable?.generation === generation ? durable.identity : undefined
    }

    /**
     * Logout: supersedes the fence (aborting in-flight work, so pending flows cannot commit afterwards),
     * revokes refresh tokens known to this instance when the server supports RFC 7009, and clears the stores.
     *
     * Stores with `clear()` are emptied completely; stores without it only lose the keys this instance
     * wrote. Records that remain are unusable anyway because they carry an older fence generation, but
     * their refresh tokens are not revoked. Revocation failures are reported after local state is cleared.
     */
    async forget(): Promise<void> {
        const failures: unknown[] = []
        await this.#fence.supersede(async () => {
            if (this.#options.revokeOnForget !== false) {
                for (const record of await this.#records()) {
                    await this.#revoke(record).catch(e => failures.push(e))
                }
            }

            await clearStore(this.#cache, this.#keys)
            if (this.#options.sessionStore !== undefined) await clearStore(this.#options.sessionStore, this.#keys)
            this.#keys.clear()
        })

        if (failures.length > 0) throw new AggregateError(failures, "Local session cleared, but token revocation failed")
    }

    async #authorize(as: oauth.AuthorizationServer, signal: AbortSignal): Promise<Fresh> {
        const client = await this.#clientProvider.getClient(as, this.#callbackUri, signal)
        // Without DPoP the key is never used; it is still generated (locally, ES256, independent of server DPoP
        // metadata) because the stored record type requires one — keeping DPoPTokenCacheEntry unchanged.
        const dpopKey = this.#options.dpop === false ? await oauth.generateKeyPair("ES256", {extractable: false}) : await generateDPoPKey(as)
        const processed = await authorizationCodeGrant({
            authorizationServer: as,
            client,
            redirectUri: this.#callbackUri,
            codeProvider: this.#codeProvider,
            scopes: this.#scopes(as),
            signal,
            ...(this.#options.dpop === false ? {} : {dpop: oauth.DPoP(client, dpopKey)}),
            ...optional("http", this.#options.http),
            ...optional("silentFirst", this.#options.silentFirst),
            ...optional("prompt", this.#options.prompt),
            ...optional("requireS256", this.#options.requireS256),
            ...optional("tokenParameters", this.#options.tokenParameters),
            ...optional("parameters", this.#options.authorizationParameters),
            ...optional("consentForOfflineAccess", this.#options.consentForOfflineAccess),
            ...optional("serverQuirks", this.#options.serverQuirks),
        })

        return await this.#fresh(processed, processed.refresh_token, dpopKey, client, as, undefined, signal)
    }

    /** Refresh grant; `undefined` when the grant is no longer valid. */
    async #refresh(record: RefreshSessionRecord, signal: AbortSignal): Promise<Fresh | undefined> {
        const {authorizationServer: as, client, dpopKey} = record
        const bound = this.#options.dpop === false ? {} : {DPoP: oauth.DPoP(client, dpopKey)}
        const additional = this.#options.tokenParameters === undefined ? {} : {additionalParameters: this.#options.tokenParameters}
        let processed: oauth.TokenEndpointResponse
        try {
            processed = await withDPoPNonceRetry(async () => {
                const response = await oauth.refreshTokenGrantRequest(as, client, clientAuthFor(as.issuer, client, this.#options.serverQuirks ?? true), record.refreshToken, {...oauthOptions(this.#options.http, signal), ...bound, ...additional})
                return await oauth.processRefreshTokenResponse(as, client, response)
            })
        } catch (e) {
            if (e instanceof oauth.ResponseBodyError && e.error === "invalid_grant") return undefined
            throw e
        }

        // Keep the refresh token when the server did not rotate it.
        return await this.#fresh(processed, processed.refresh_token ?? record.refreshToken, dpopKey, client, as, record.identity, signal)
    }

    /**
     * Builds a storable entry from a processed token response. Claims are read from `processed` itself:
     * oauth4webapi associates validated ID token claims with that exact object (a WeakMap), so any copy
     * would lose them.
     */
    async #fresh(processed: oauth.TokenEndpointResponse, refreshToken: string | undefined, dpopKey: CryptoKeyPair, client: oauth.Client, as: oauth.AuthorizationServer, previous: Identity | undefined, signal: AbortSignal): Promise<Fresh> {
        const claims = oauth.getValidatedIdTokenClaims(processed)
        const identity = claims === undefined ? previous : await this.#identityFrom(claims, previous, signal)
        const created = Date.now()
        // A plain copy for storage; an ID token without validated claims (none in a refresh response that
        // omits it) must not linger from the processed object.
        const {id_token, ...rest} = processed
        const tokenResult: oauth.TokenEndpointResponse = {
            ...rest,
            ...optional("refresh_token", refreshToken),
            ...optional("id_token", claims === undefined ? undefined : id_token),
        }

        return {
            created,
            tokenResult,
            dpopKey,
            client,
            authorizationServer: as,
            ...optional("expiresAt", processed.expires_in === undefined ? undefined : created + processed.expires_in * 1000),
            ...optional("idTokenExpiresAt", claims === undefined ? undefined : claims.exp * 1000),
            ...optional("identity", identity),
        }
    }

    /** Identity from validated ID token claims; a renewal must identify the same subject at the same issuer. */
    async #identityFrom(claims: oauth.IDToken, previous: Identity | undefined, signal: AbortSignal): Promise<Identity> {
        if (previous !== undefined && (previous.subject !== claims.sub || previous.issuer !== claims.iss)) {
            throw new ReactiveAuthenticationError("Renewed ID token identifies a different subject")
        }

        const webId = parseWebId(claims["webid"], this.#options.http?.allowInsecureRequests)
        let webIdVerified = false
        if (webId !== undefined && this.#options.verifyWebId === true) {
            if (!await webIdTrustsIssuer(webId, claims.iss, signal, this.#options.http)) {
                throw new ReactiveAuthenticationError(`WebID profile ${webId.href} does not list issuer ${claims.iss}`)
            }
            webIdVerified = true
        }

        const azp = typeof claims["azp"] === "string" ? claims["azp"] : undefined
        return {
            issuer: claims.iss,
            subject: claims.sub,
            webIdVerified,
            audience: Array.isArray(claims.aud) ? claims.aud : [claims.aud],
            ...optional("webId", webId?.href),
            ...optional("clientId", azp),
        }
    }

    /** Durable record first, then memory; nothing becomes usable if persistence fails or logout intervened. */
    async #commit(key: string, fresh: Fresh, generation: number, signal: AbortSignal): Promise<DPoPTokenCacheEntry> {
        const entry: DPoPTokenCacheEntry = {...fresh, generation}
        return await this.#fence.commit(generation, async () => {
            signal.throwIfAborted()
            this.#keys.add(key)
            const record = refreshRecordOf(entry, generation)
            if (this.#options.sessionStore !== undefined && record !== null) {
                await this.#options.sessionStore.setItem(key, record)
            }
            await this.#cache.setItem(key, entry)
            return entry
        })
    }

    async #records(): Promise<RefreshSessionRecord[]> {
        const records: RefreshSessionRecord[] = []
        for (const key of this.#keys) {
            const durable = await this.#options.sessionStore?.getItem(key) ?? null
            const record = durable ?? refreshRecordOf(await this.#cache.getItem(key), undefined)
            if (record !== null) records.push(record)
        }
        return records
    }

    async #revoke(record: RefreshSessionRecord): Promise<void> {
        const as = record.authorizationServer
        if (as.revocation_endpoint === undefined) return
        const response = await oauth.revocationRequest(as, record.client, clientAuthFor(as.issuer, record.client, this.#options.serverQuirks ?? true), record.refreshToken, {
            ...oauthOptions(this.#options.http),
            additionalParameters: {token_type_hint: "refresh_token"},
        })
        await oauth.processRevocationResponse(response)
    }

    #scopes(as: oauth.AuthorizationServer): string[] {
        const scopes = [...(this.#options.scopes ?? ["openid", "webid"])]
        if (this.#options.offlineAccess !== false && !scopes.includes("offline_access") && supportsOfflineAccess(as)) scopes.push("offline_access")
        return scopes
    }

    async #key(issuer: string, context: string): Promise<string> {
        // The dynamically registered client_id is not part of the key: it changes after reload while a
        // persisted refresh token must still be found. Records store the client they were issued to.
        const o = this.#options
        return await contextKey("oidc", [o.namespace ?? "default", o.account ?? "default", issuer, this.#callbackUri, (o.scopes ?? ["openid", "webid"]).join(" "), context])
    }

    #lockName(key: string) {
        return `reactive-authentication:${key}`
    }
}

type Fresh = Omit<DPoPTokenCacheEntry, "generation">

function refreshRecordOf(entry: DPoPTokenCacheEntry | null, generation: number | undefined): RefreshSessionRecord | null {
    const refreshToken = entry?.tokenResult.refresh_token
    if (entry === null || refreshToken === undefined) return null
    return {
        created: entry.created,
        generation: generation ?? entry.generation ?? 0,
        refreshToken,
        dpopKey: entry.dpopKey,
        client: entry.client,
        authorizationServer: entry.authorizationServer,
        ...optional("identity", entry.identity),
    }
}

/**
 * Whether an access token can be used: a just-issued one always (even if its lifetime is shorter than the
 * expiry skew), a cached one until shortly before expiry (unknown expiry: until the server rejects it).
 */
export function accessTokenUsable(entry: DPoPTokenCacheEntry, justIssued = false): boolean {
    return justIssued || entry.expiresAt === undefined || Date.now() < entry.expiresAt - expirySkewMs
}

/** Whether the session holds an ID token that can be presented as a credential. */
export function idTokenUsable(entry: DPoPTokenCacheEntry, justIssued = false): boolean {
    if (entry.tokenResult.id_token === undefined || entry.idTokenExpiresAt === undefined) return false
    return justIssued || Date.now() < entry.idTokenExpiresAt - expirySkewMs
}

async function clearStore<T extends {}>(store: KeyValueStore<T>, keys: Iterable<string>): Promise<void> {
    const clearable = store as KeyValueStore<T> & {clear?: () => Promise<void>}
    if (typeof clearable.clear === "function") {
        await clearable.clear()
        return
    }
    for (const key of keys) await store.removeItem(key)
}

/** `{[name]: value}` when defined, `{}` otherwise; keeps `exactOptionalPropertyTypes` honest. */
export function optional<K extends string, V>(name: K, value: V | undefined): {[P in K]?: V} {
    return (value === undefined ? {} : {[name]: value}) as {[P in K]?: V}
}
