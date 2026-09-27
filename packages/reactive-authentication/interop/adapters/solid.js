// The shared external-Solid adapter: the same library-authenticated scenarios against any Solid-OIDC
// deployment (local containers or hosted pods). Everything goes through the library's public API exactly as
// an application wires it: WebID → issuer discovery, dynamic registration (or a Client ID document),
// authorization code + PKCE in a real browser, DPoP-bound requests, reactive 401 upgrades.
//
// Data safety:
// - Writes happen only below an explicitly configured `scratchContainer` (inside the storage), always in a new
//   run-owned child container that must not exist beforehand; resources are created with `If-None-Match: *`.
//   Cleanup deletes exactly what this run created. Without a scratch container the target runs read-only
//   scenarios against a configured `privateResource`, and write scenarios are UNTESTED.
// - Probes outside the credential boundary (look-alike paths, other accounts' storages) are read-only GETs.
import { createMemoryStore } from "@key-value-kit/storage/memory"
import {
    AutomaticCredentialBoundary, CachingAuthorizationServerProvider, CachingClientProvider, ClientIdClientProvider,
    CredentialBoundary, DPoPTokenProvider, DynamicRegistrationClientProvider, isWithin, ReactiveFetchManager, SessionFence,
    WebIdIssuerProvider, XASProvider,
} from "../../dist/mod.js"
import { loopbackRedirectProblem } from "../lib/callbackServer.js"
import { CheckError } from "../lib/checkError.js"
import { recordingFetch } from "../lib/recorder.js"

/**
 * @typedef {object} SolidTargetConfig
 * @property {string} storage the test account's storage root (ends with `/`)
 * @property {string} webId the test account's WebID; its profile names the issuer
 * @property {string} [issuer] expected issuer (checked against the ID token)
 * @property {string} [scratchContainer] dedicated container for test writes (inside `storage`, ends with `/`)
 * @property {string} [privateResource] an existing private resource of the test account (read-only scenarios)
 * @property {string} [otherProtected] a protected resource outside the test account's storage (read-only probes)
 * @property {string} [clientId] Client Identifier Document URL (default: dynamic registration)
 * @property {string} redirectUri
 * @property {boolean} [insecure] local plain-HTTP deployment (explicit opt-in, never for hosted targets)
 */

/** Container prefix check without traversal tricks: same origin, path prefix, no dot segments or encoded dots. */
export function inside(url, container) {
    const u = new URL(url)
    const c = new URL(container)
    return u.origin === c.origin && u.pathname.startsWith(c.pathname) && !/(^|\/)\.\.?(\/|$)|%2e|%2f|%5c|\\/i.test(u.pathname) && u.search === "" && u.hash === ""
}

/** Validates a Solid target configuration before any network request; returns problems. */
export function validateSolidConfig(config) {
    const problems = []
    const url = (name, value) => {
        try {
            const parsed = new URL(value)
            if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && config.insecure === true)) problems.push(`${name} must be https`)
            return parsed
        } catch {
            problems.push(`${name} is not a URL`)
            return undefined
        }
    }
    if (url("storage", config.storage) !== undefined && !config.storage.endsWith("/")) problems.push("storage must end with /")
    url("webId", config.webId)
    const redirect = loopbackRedirectProblem(config.redirectUri)
    if (redirect !== undefined) problems.push(redirect)
    if (config.scratchContainer !== undefined && url("scratchContainer", config.scratchContainer) !== undefined) {
        if (!config.scratchContainer.endsWith("/")) problems.push("scratchContainer must end with /")
        if (!inside(config.scratchContainer, config.storage)) problems.push("scratchContainer must be inside storage (same origin, no dot segments, query or fragment)")
    }
    if (config.privateResource !== undefined && url("privateResource", config.privateResource) !== undefined && !inside(config.privateResource, config.storage)) {
        problems.push("privateResource must be inside storage")
    }
    if (config.otherProtected !== undefined && url("otherProtected", config.otherProtected) !== undefined && inside(config.otherProtected, config.storage)) {
        problems.push("otherProtected must be outside storage")
    }
    if (config.scratchContainer === undefined && config.privateResource === undefined) problems.push("configure scratchContainer (writes) or privateResource (read-only)")
    return problems
}

/**
 * Builds a client the way an application would; each client is a separate "application instance".
 *
 * Session grouping uses the provider's `context` option, as documented for applications: with an explicit
 * boundary the application knows its user's storage, so every URL inside it shares that storage's session;
 * with an automatic boundary the discovered roots group sessions (`AutomaticCredentialBoundary.contextKey`).
 * (The default `storageContextKey` groups only by evidence in the challenged response itself; Community Solid
 * Server's 401s carry none, so it would conservatively give each distinct URL its own session.)
 */
export function solidClient(config, codeProvider, {boundary = "explicit", sessionStore, fence, approve} = {}) {
    const recorder = recordingFetch()
    const http = recorder.http(config.insecure === true)
    const issuers = new WebIdIssuerProvider(async () => new URL(config.webId), http)
    const as = new CachingAuthorizationServerProvider(new XASProvider(issuers, http))
    const clients = config.clientId === undefined
        ? new CachingClientProvider(new DynamicRegistrationClientProvider(http))
        : new ClientIdClientProvider(new URL(config.clientId), http)
    const storageOrigin = new URL(config.storage).origin
    const automatic = boundary === "automatic"
        ? new AutomaticCredentialBoundary({
            http, allowInsecureHttp: config.insecure === true,
            // An application limits discovery to origins it works with, and approves only the user's storage.
            eligible: url => url.origin === storageOrigin || (config.otherProtected !== undefined && url.origin === new URL(config.otherProtected).origin),
            ...(approve === undefined ? {} : {approve}),
        })
        : undefined
    const context = automatic?.contextKey ?? (async request => isWithin(request.url, config.storage) ? config.storage : request.url.split("#")[0])
    const provider = new DPoPTokenProvider(config.redirectUri, codeProvider, as, clients, undefined, {
        http, verifyWebId: true, context,
        ...(sessionStore === undefined ? {} : {sessionStore, fence, namespace: "ra-interop"}),
    })
    const bound = automatic ?? new CredentialBoundary([config.storage], {allowInsecureHttp: config.insecure === true})
    return {manager: new ReactiveFetchManager({providers: [provider], boundary: bound, fetch: recorder.fetch, ...(fence === undefined ? {} : {fence})}), provider, recorder, boundary: bound}
}

/** Requests to `prefix` recorded after `mark` that carried any credential. */
const credentialedUnder = (recorder, mark, prefix) => recorder.since(mark).filter(e => `${e.origin}${e.path}`.startsWith(prefix) && (e.authorization !== undefined || e.dpop))

/** Successful authorization code exchanges (each is one completed authorization). */
const exchanges = recorder => recorder.log.filter(e => e.grantType === "authorization_code" && e.status === 200).length

const okWrite = status => status === 200 || status === 201 || status === 204 || status === 205

async function status(responsePromise) {
    const response = await responsePromise
    await response.body?.cancel()
    return response.status
}

/**
 * @param {SolidTargetConfig} config
 * @param {{codeProvider(): object, runId: string, capabilities: object}} env `codeProvider()` returns a fresh
 *   browser-backed provider sharing the target's browser session (as one person's browser would)
 */
export function solidScenarios(config, env) {
    const writable = config.scratchContainer !== undefined
    const container = writable ? new URL(`ra-interop-${env.runId}/`, config.scratchContainer).href : undefined
    const created = writable ? `${container}data.txt` : undefined
    const readable = created ?? config.privateResource
    const body = `reactive-authentication interop ${env.runId}`
    const plain = globalThis.fetch.bind(globalThis)
    const needsScratch = () => writable ? undefined : "no dedicated scratchContainer configured: read-only target"
    const needsOther = () => config.otherProtected === undefined ? "no otherProtected resource configured to probe outside the boundary" : undefined

    /**
     * This library starts authenticating only after a 401 challenge (the Solid Protocol's HTTP Server section requires
     * 401 for requests lacking valid credentials, or 404 for security reasons): name that precisely when a protected
     * resource refused an unauthenticated request without one. (A 403 is not itself a protocol violation: RFC 9110
     * §15.5.4 also allows refusals unrelated to credentials.)
     */
    function unchallenged(recorder, finalStatus) {
        const challenged = recorder.log.some(e => e.status === 401)
        if (challenged) return
        if (finalStatus === 403 || finalStatus === 404) {
            throw new CheckError(`the server answered an unauthenticated request to a protected resource with ${finalStatus} and no 401/WWW-Authenticate challenge, so reactive authentication cannot start`)
        }
        if (finalStatus >= 200 && finalStatus < 300) {
            throw new CheckError(`the server served a resource configured as protected to an unauthenticated request (${finalStatus}, no challenge), so reactive authentication cannot start`)
        }
    }

    /** The first challenged request and its credentialed replay, for the flow assertions. */
    function challengedExchange(recorder) {
        const log = recorder.log
        const first = log.findIndex(e => e.status === 401 && e.authorization === undefined && !e.dpop)
        const replay = first < 0 ? undefined : log.slice(first + 1).find(e => e.origin === log[first].origin && e.path === log[first].path && e.method === log[first].method)
        return {first: log[first], replay}
    }

    return [
        {
            id: "solid.login",
            async run(ctx, state) {
                const code = env.codeProvider()
                const client = solidClient(config, code)
                state.main = client
                state.created = []
                if (writable) {
                    // The run-owned container is created explicitly and only if absent (If-None-Match: *); it is
                    // recorded as owned right after that succeeds, so cleanup never deletes anything it did not
                    // create. This first protected request is also what triggers the login.
                    const made = await status(client.manager.fetch(container, {method: "PUT", headers: {"content-type": "text/turtle", "if-none-match": "*"}, body: "", signal: ctx.signal}))
                    unchallenged(client.recorder, made)
                    ctx.check(made === 201, `explicit creation of the run-owned container answered ${made} (expected 201; a server without container PUT needs a read-only privateResource configuration)`)
                    state.created.push(container)
                    const response = await client.manager.fetch(created, {method: "PUT", headers: {"content-type": "text/plain", "if-none-match": "*"}, body, signal: ctx.signal})
                    await response.body?.cancel()
                    ctx.equal(response.status, 201, "creation of the run-owned resource")
                    state.created.push(created)
                } else {
                    const read = await status(client.manager.fetch(config.privateResource, {signal: ctx.signal}))
                    unchallenged(client.recorder, read)
                    ctx.equal(read, 200, "authenticated read of the configured private resource")
                }

                const {first, replay} = challengedExchange(client.recorder)
                ctx.check(first !== undefined, "a request was first sent without credentials and challenged with 401")
                ctx.equal(replay?.authorization, "DPoP", "the replayed request used the DPoP scheme")
                ctx.check(replay.dpop, "the replayed request carried a DPoP proof")
                // Solid default: a silent prompt=none attempt, then an interactive one (prompt=consent for offline access).
                ctx.check(code.calls >= 1 && code.calls <= 2, `authorization requests: ${code.requests.map(r => r.prompt ?? "(none)").join(", ")}`)
                ctx.equal(exchanges(client.recorder), 1, "code exchanges")
                const authorization = code.requests.at(-1)
                ctx.check(code.requests.every(r => r.codeChallengeMethod === "S256" && r.hasState && r.hasNonce && r.responseType === "code"), "every authorization request used S256 PKCE, state and nonce")
                ctx.check(/\bopenid\b/.test(authorization.scope) && /\bwebid\b/.test(authorization.scope), "openid and webid scopes requested")
                const tokenRequest = client.recorder.log.find(e => e.grantType === "authorization_code")
                ctx.check(tokenRequest?.dpop === true && tokenRequest.status === 200, "the code was exchanged with a DPoP proof")

                const identity = await client.provider.identity(new Request(readable))
                ctx.check(identity !== undefined, "the session reports an identity")
                ctx.same(identity.webId, config.webId, "the ID token's webid claim is the configured WebID")
                ctx.equal(identity.webIdVerified, true, "the WebID profile lists the issuer")
                if (config.issuer !== undefined) ctx.same(identity.issuer, config.issuer, "the ID token issuer is the configured issuer")
                ctx.note({
                    mode: writable ? "scratch-writes" : "read-only",
                    offlineAccessRequested: /\boffline_access\b/.test(authorization.scope),
                    prompts: code.requests.map(r => r.prompt ?? "(none)").join(" then "),
                    refreshTokenIssued: typeof client.recorder.lastTokens?.refresh_token === "string",
                })
            },
        },
        {
            id: "solid.private-read",
            after: ["solid.login"],
            async run(ctx, {main}) {
                const anonymous = await status(plain(readable, {signal: ctx.signal}))
                ctx.check(anonymous === 401 || anonymous === 403, `the resource is private (unauthenticated GET answered ${anonymous})`)
                const response = await main.manager.fetch(readable, {signal: ctx.signal})
                ctx.equal(response.status, 200, "authenticated GET status")
                const text = await response.text()
                if (writable) ctx.equal(text, body, "the written content reads back")
                ctx.equal(exchanges(main.recorder), 1, "the session was reused (no new authorization)")
            },
        },
        {
            id: "solid.write",
            after: ["solid.login"],
            untested: needsScratch,
            async run(ctx, {main}) {
                const current = await main.manager.fetch(created, {signal: ctx.signal})
                const etag = current.headers.get("etag")
                await current.body?.cancel()
                ctx.check(etag !== null, "the created resource has an ETag")
                const updated = `${body} (updated)`
                ctx.check(okWrite(await status(main.manager.fetch(created, {method: "PUT", headers: {"content-type": "text/plain", "if-match": etag}, body: updated, signal: ctx.signal}))), "conditional update of the run-owned resource")
                const read = await main.manager.fetch(created, {signal: ctx.signal})
                ctx.equal(await read.text(), updated, "the update reads back")
            },
        },
        {
            id: "solid.concurrency",
            after: ["solid.login"],
            async run(ctx) {
                const code = env.codeProvider()
                const {manager, recorder} = solidClient(config, code)
                const statuses = await Promise.all(Array.from({length: 6}, () => status(manager.fetch(readable, {signal: ctx.signal}))))
                ctx.check(statuses.every(s => s === 200), `concurrent GETs answered ${statuses.join(",")}`)
                ctx.equal(exchanges(recorder), 1, "one code exchange for six concurrent challenged requests")
                ctx.check(code.calls <= 2, `one authorization flow (${code.calls} requests including a silent attempt)`)
            },
        },
        {
            id: "solid.boundary-explicit",
            after: ["solid.login"],
            untested: needsOther,
            async run(ctx, {main}) {
                // Read-only probes: a look-alike path next to the storage and another account's protected resource.
                const mark = main.recorder.mark()
                const lookalike = new URL(`ra-interop-absent-${env.runId}`, `${config.storage.replace(/\/$/, "")}-lookalike/`).href
                await status(main.manager.fetch(lookalike, {signal: ctx.signal}))
                ctx.equal(await status(main.manager.fetch(config.otherProtected, {signal: ctx.signal})), 401, "the other account's protected resource stays challenged (not upgraded)")
                for (const url of [lookalike, config.otherProtected]) {
                    ctx.equal(credentialedUnder(main.recorder, mark, url).length, 0, "credentialed requests outside the boundary")
                }
            },
        },
        {
            id: "solid.boundary-automatic",
            needs: ["storageDiscovery"],
            after: ["solid.login"],
            async run(ctx) {
                const code = env.codeProvider()
                const sources = []
                const client = solidClient(config, code, {boundary: "automatic", approve: root => {
                    sources.push(root.source)
                    return root.root === config.storage // application policy: only the user's own storage
                }})
                ctx.equal(await status(client.manager.fetch(readable, {signal: ctx.signal})), 200, "GET with a discovered boundary")
                ctx.check(client.boundary.roots.includes(config.storage), "the storage root was discovered from the server's own Link headers")
                ctx.note({discoveredVia: sources[0]})
                if (config.otherProtected !== undefined) {
                    const mark = client.recorder.mark()
                    ctx.equal(await status(client.manager.fetch(config.otherProtected, {signal: ctx.signal})), 401, "the unapproved storage stays challenged")
                    ctx.equal(credentialedUnder(client.recorder, mark, config.otherProtected).length, 0, "credentialed requests to the unapproved storage")
                    ctx.check(client.boundary.roots.every(root => root === config.storage), "no other root was added")
                }
            },
        },
        {
            id: "solid.refresh-restore",
            needs: ["refreshTokens"],
            after: ["solid.login"],
            async run(ctx) {
                // Refresh-only persistence as after a page reload: later instances restore the session from the
                // durable refresh token alone (no browser, no authorization request).
                const sessionStore = createMemoryStore()
                const generations = createMemoryStore()
                const fence = () => new SessionFence("ra-interop", {store: generations, broadcast: false})
                // A new browser: providers grant offline access on an explicit consent, which a remembered client
                // re-authorizing silently in the same browser session may not get (observed with CSS + a Client ID document).
                const first = env.codeProvider({fresh: true})
                const a = solidClient(config, first, {sessionStore, fence: fence()})
                ctx.equal(await status(a.manager.fetch(readable, {signal: ctx.signal})), 200, "first instance GET")
                ctx.equal(exchanges(a.recorder), 1, "the first instance authorized once")
                ctx.check(/\boffline_access\b/.test(first.requests.at(-1).scope), "offline_access was requested")
                let previous = a.recorder.lastTokens?.refresh_token
                ctx.check(typeof previous === "string", "the provider issued a refresh token")

                const rotation = ctx.expects(env, "refreshRotation")
                for (const round of [1, 2]) {
                    const again = env.codeProvider()
                    const b = solidClient(config, again, {sessionStore, fence: fence()})
                    ctx.equal(await status(b.manager.fetch(readable, {signal: ctx.signal})), 200, `restored instance ${round} GET`)
                    ctx.equal(again.calls, 0, `restored instance ${round} needed no authorization`)
                    const refreshes = b.recorder.log.filter(e => e.grantType === "refresh_token")
                    ctx.check(refreshes.length === 1 && refreshes[0].status === 200, `restored instance ${round} used exactly one successful refresh grant`)
                    ctx.check(refreshes[0].dpop, "the refresh grant carried a DPoP proof")
                    const next = b.recorder.lastTokens?.refresh_token ?? previous
                    if (rotation) ctx.differ(next, previous, `refresh ${round} rotated the refresh token`)
                    previous = next
                }
                ctx.note({restoredInstances: 2, rotationVerified: rotation})
            },
        },
        {
            id: "solid.logout",
            after: ["solid.login"],
            async run(ctx) {
                const code = env.codeProvider({fresh: true}) // a new browser: see solid.refresh-restore
                const client = solidClient(config, code)
                ctx.equal(await status(client.manager.fetch(readable, {signal: ctx.signal})), 200, "GET before logout")
                const refreshToken = client.recorder.lastTokens?.refresh_token
                const mark = client.recorder.mark()
                await client.manager.logout()
                const revocations = client.recorder.since(mark).filter(e => e.method === "POST" && /revo/i.test(e.path))
                if (ctx.expects(env, "revocation")) {
                    ctx.check(typeof refreshToken === "string", "revocation is expected, so a refresh token must have been issued to revoke")
                    ctx.check(revocations.length === 1 && revocations[0].status === 200, "the refresh token was revoked at the provider")
                }
                ctx.note({revocationRequests: revocations.length})
                ctx.equal(await status(client.manager.fetch(readable, {signal: ctx.signal})), 200, "GET after logout (re-authorized)")
                ctx.equal(exchanges(client.recorder), 2, "logout forgot the session: a new authorization was needed")
            },
        },
        {
            id: "solid.cleanup",
            after: ["solid.login"],
            always: true, // runs even when solid.login failed after creating something
            untested: needsScratch,
            async run(ctx, state) {
                if (state.main === undefined) throw new Error("blocked: solid.login did not run, so nothing can be cleaned up")
                if (state.created.length === 0) throw new Error("blocked: solid.login created nothing (it failed before the create)")
                for (const url of [...state.created].reverse()) { // children first
                    const deleted = await status(state.main.manager.fetch(url, {method: "DELETE", signal: ctx.signal}))
                    ctx.check(okWrite(deleted), `DELETE of a run-owned ${url.endsWith("/") ? "container" : "resource"} answered ${deleted}`)
                }
                ctx.equal(await status(state.main.manager.fetch(container, {signal: ctx.signal})), 404, "the run-owned container is gone")
            },
        },
    ]
}
