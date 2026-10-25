// External LWS adapter: the library's LWS support (LwsTokenProvider + one CredentialSource per authentication
// suite) against a real, configured Linked Web Storage deployment. The storage answers 401 with a Bearer
// challenge naming `as_uri` and `realm`; the client exchanges a suite credential (RFC 8693) for a realm-bound
// Bearer token and replays the request.
//
// Suites (one target per suite and deployment):
// - "openid": ID token from a real browser login at the user's OpenID provider (URI `sub`, `azp`)
// - "saml": a signed assertion fetched from the deployment's SAML service provider after a browser login
// - "controlled-identifier": self-issued JWT signed with a key published in the agent's CID document
// - "did-key": self-issued JWT whose subject is the did:key of the signing key
//
// Data safety (as in the Solid adapter):
// - Writes happen only below an explicitly configured `scratchContainer`: one run-owned resource created with
//   `If-None-Match: *`, deleted by lws.cleanup (nothing else is ever deleted). Without a scratch container the
//   target is read-only against `privateResource` and write scenarios are UNTESTED.
// - Probes outside the credential boundary are read-only GETs.
//
// LWS 1.0 is an editor's draft (w3c/lws-protocol@268fd25); its Operations section defines no HTTP binding yet,
// so creation uses HTTP PUT with `If-None-Match: *` and updates use `If-Match` (RFC 9110 semantics).
import { readFile } from "node:fs/promises"
import {
    AutomaticCredentialBoundary, CredentialBoundary, DidKeySource, DynamicRegistrationClientProvider, LwsTokenProvider, OidcIdTokenSource,
    ReactiveFetchManager, SamlAssertionSource, SelfIssuedJwtSource, TOKEN_EXCHANGE_GRANT, XASProvider,
    trustAuthorizationServers,
} from "../../dist/mod.js"
import { loopbackRedirectProblem } from "../lib/callbackServer.js"
import { recordingFetch } from "../lib/recorder.js"
import { decoy } from "../lib/resourceServers.js"
import { codeProviders } from "./index.js"

export const suites = ["openid", "saml", "controlled-identifier", "did-key"]

/**
 * @typedef {object} LwsTargetConfig
 * @property {"openid"|"saml"|"controlled-identifier"|"did-key"} suite
 * @property {string} storage the storage (root or the part the test account may use); the credential boundary
 * @property {string} [scratchContainer] container for run-owned test writes (inside `storage`, ends with `/`)
 * @property {string} [privateResource] an existing private resource (read-only mode)
 * @property {string} [otherProtected] a protected resource outside `storage` (read-only probe)
 * @property {string[]} [authorizationServers] trusted `as_uri` values when the AS is not on the storage's origin
 * @property {string} [expectedSubject] the agent identifier the storage should see (ID token `sub`, CID URL or DID)
 * @property {{issuer: string, clientId?: string, clientSecret?: string, requireAudience?: boolean}} [openid]
 * @property {string} [redirectUri] loopback redirect URI (openid)
 * @property {{loginUrl: string, assertionEndpoint: string}} [saml]
 * @property {{subject?: string, keyId?: string, keyFile: string}} [selfIssued] controlled-identifier / did-key
 * @property {boolean} [insecure] plain-HTTP fixtures in the harness's own offline tests only (refused for live targets)
 */

/** Container prefix check without traversal tricks: same origin, path prefix, no dot segments or encoded dots. */
function inside(url, container) {
    const u = new URL(url)
    const c = new URL(container)
    return u.origin === c.origin && u.pathname.startsWith(c.pathname) && !/(^|\/)\.\.?(\/|$)|%2e|%2f|%5c|\\/i.test(u.pathname) && u.search === "" && u.hash === ""
}

/** Trusted `as_uri` values; unset manifest placeholders resolve to empty strings and are dropped. */
function authorizationServersOf(config) {
    const listed = (config.authorizationServers ?? []).filter(as => as !== "")
    return listed.length === 0 ? undefined : listed
}

/** Validates an LWS target configuration before any network request; returns problems. */
export function validate(config) {
    const problems = []
    const https = (name, value) => {
        try {
            const parsed = new URL(value)
            if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && config.insecure === true)) problems.push(`${name} must be https`)
            return parsed
        } catch {
            problems.push(`${name} is not a URL`)
            return undefined
        }
    }
    if (!suites.includes(config.suite)) problems.push(`suite must be one of ${suites.join(", ")}`)
    if (https("storage", config.storage) !== undefined && !config.storage.endsWith("/")) problems.push("storage must end with /")
    if (config.scratchContainer !== undefined && https("scratchContainer", config.scratchContainer) !== undefined) {
        if (!config.scratchContainer.endsWith("/")) problems.push("scratchContainer must end with /")
        if (!inside(config.scratchContainer, config.storage)) problems.push("scratchContainer must be inside storage (same origin, no dot segments, query or fragment)")
    }
    if (config.privateResource !== undefined && https("privateResource", config.privateResource) !== undefined && !inside(config.privateResource, config.storage)) {
        problems.push("privateResource must be inside storage")
    }
    if (config.otherProtected !== undefined && https("otherProtected", config.otherProtected) !== undefined && inside(config.otherProtected, config.storage)) {
        problems.push("otherProtected must be outside storage")
    }
    if (config.scratchContainer === undefined && config.privateResource === undefined) problems.push("configure scratchContainer (writes) or privateResource (read-only)")
    for (const [index, as] of (authorizationServersOf(config) ?? []).entries()) https(`authorizationServers[${index}]`, as)

    if (config.suite === "openid") {
        https("openid.issuer", config.openid?.issuer)
        const redirect = loopbackRedirectProblem(config.redirectUri)
        if (redirect !== undefined) problems.push(redirect)
        if (config.openid?.clientSecret !== undefined && config.openid?.clientId === undefined) problems.push("openid.clientSecret needs openid.clientId")
    }
    if (config.suite === "saml") {
        https("saml.loginUrl", config.saml?.loginUrl)
        https("saml.assertionEndpoint", config.saml?.assertionEndpoint)
        // "session" is the runner's non-interactive mode for a manual target with a stored SP session.
        if (config.login?.recipe !== "manual" && config.login?.recipe !== "session") problems.push("the SAML suite needs login.recipe manual (a person signs in at the service provider, or a stored SP session is used)")
    }
    if (config.suite === "controlled-identifier" || config.suite === "did-key") {
        if (typeof config.selfIssued?.keyFile !== "string" || config.selfIssued.keyFile === "") problems.push("selfIssued.keyFile (a private JWK file) is required")
    }
    if (config.suite === "controlled-identifier") {
        https("selfIssued.subject", config.selfIssued?.subject)
        if (typeof config.selfIssued?.keyId !== "string" || !config.selfIssued.keyId.startsWith(`${config.selfIssued?.subject}#`)) {
            problems.push("selfIssued.keyId must be the verification method URL (the subject with a fragment)")
        }
    }
    return problems
}

/** Imports a private Ed25519 or P-256 JWK (non-extractable) and its public half. Key material is never echoed. */
async function keyPairFromJwkFile(path) {
    let jwk
    try {
        jwk = JSON.parse(await readFile(path, "utf8"))
    } catch {
        throw new Error("the self-issued key file could not be read as JSON")
    }
    const params = jwk?.kty === "OKP" && jwk.crv === "Ed25519" ? {name: "Ed25519"}
        : jwk?.kty === "EC" && jwk.crv === "P-256" ? {name: "ECDSA", namedCurve: "P-256"} : undefined
    if (params === undefined || typeof jwk.d !== "string") throw new Error("the self-issued key file must hold a private Ed25519 or P-256 JWK")
    const pub = Object.fromEntries(Object.entries({kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y}).filter(([, v]) => v !== undefined))
    const privateKey = await crypto.subtle.importKey("jwk", {...pub, d: jwk.d}, params, false, ["sign"])
    const publicKey = await crypto.subtle.importKey("jwk", pub, params, true, ["verify"])
    return {privateKey, publicKey, algorithm: params.name === "Ed25519" ? "EdDSA" : "ES256"}
}

/** A fixed, registered OAuth client (public, or confidential for server-side code). */
function registeredClient({clientId, clientSecret}) {
    const client = clientSecret === undefined
        ? {client_id: clientId, token_endpoint_auth_method: "none"}
        : {client_id: clientId, client_secret: clientSecret, token_endpoint_auth_method: "client_secret_basic"}
    return {getClient: async () => client}
}

/** Waits `ms`, or rejects as soon as `signal` aborts (the timer is cleared either way). */
function sleep(ms, signal) {
    return new Promise((resolve, reject) => {
        if (signal.aborted) return reject(signal.reason ?? new Error("aborted"))
        const onAbort = () => {
            clearTimeout(timer)
            reject(signal.reason ?? new Error("aborted"))
        }
        const timer = setTimeout(() => {
            signal.removeEventListener("abort", onAbort)
            resolve()
        }, ms)
        signal.addEventListener("abort", onAbort, {once: true})
    })
}

/**
 * Obtains a SAML assertion the way a browser application does: a person signs in at the deployment's SAML
 * service provider in the (headed) browser, then the SP's assertion endpoint — called with that browser
 * session's cookies — returns `{xml, recipient, notOnOrAfter}` for the requested audience.
 */
export function samlObtainer(config, env, {requestTimeoutMs = 15_000, pollMs = 2_000, signInMs = 300_000} = {}) {
    let signedIn
    return async ({authorizationServer, signal}) => {
        const context = await env.context()
        const endpoint = new URL(config.saml.assertionEndpoint)
        endpoint.searchParams.set("audience", authorizationServer.href)
        /** Rejects as soon as `signal` aborts (Playwright's APIRequestContext takes no AbortSignal). */
        const abortable = (promise, onAbort) => {
            if (signal.aborted) {
                onAbort?.()
                return Promise.reject(signal.reason ?? new Error("aborted"))
            }
            let listener
            const aborted = new Promise((_, reject) => {
                listener = () => {
                    onAbort?.()
                    reject(signal.reason ?? new Error("aborted"))
                }
                signal.addEventListener("abort", listener, {once: true})
            })
            return Promise.race([promise, aborted]).finally(() => signal.removeEventListener("abort", listener))
        }
        /**
         * One bounded assertion request with the signed-in browser session's cookies. The response body is
         * released in every case (also when the scenario is aborted while the request is still in flight);
         * the assertion itself is never logged.
         */
        const fetchAssertion = async () => {
            const pending = context.request.get(endpoint.href, {failOnStatusCode: false, maxRedirects: 0, timeout: requestTimeoutMs})
            const release = () => { pending.then(r => r.dispose(), () => {}) }
            const response = await abortable(pending, release)
            try {
                if (response.status() !== 200 || !response.headers()["content-type"]?.includes("json")) return undefined
                const body = await abortable(response.json().catch(() => undefined))
                return typeof body?.xml === "string" && typeof body?.recipient === "string" ? body : undefined
            } finally {
                await response.dispose().catch(() => {})
            }
        }
        let body = await fetchAssertion()
        if (body === undefined && env.headed !== true) {
            // Non-interactive (stored session) runs fail closed: nobody is there to sign in.
            throw new Error("the SAML service provider returned no assertion for the stored browser session (expired or not signed in); non-interactive runs never sign in")
        }
        if (body === undefined) {
            signedIn ??= (async () => {
                const page = await context.newPage()
                await page.goto(config.saml.loginUrl)
                console.log(`[interop] Complete the SAML sign-in for ${config.label ?? "the LWS target"} in the opened browser window.`)
            })()
            // A failed sign-in page (e.g. navigation error) may be retried by a later request.
            await abortable(signedIn).catch(error => {
                signedIn = undefined
                throw error
            })
            const deadline = AbortSignal.any([signal, AbortSignal.timeout(signInMs)])
            while (body === undefined) {
                if (signal.aborted) throw signal.reason ?? new Error("aborted")
                if (deadline.aborted) throw new Error(`no SAML assertion became available within ${Math.round(signInMs / 1000)} s`)
                await sleep(pollMs, signal)
                body = await fetchAssertion()
            }
        }
        const expiresAt = Date.parse(body.notOnOrAfter)
        return {xml: body.xml, clientId: body.recipient, ...(Number.isNaN(expiresAt) ? {} : {expiresAt})}
    }
}

/**
 * @param {LwsTargetConfig} config
 * @param {{runId: string, context(): Promise<object>, capabilities: object}} env
 */
export async function scenarios(config, env) {
    const writable = config.scratchContainer !== undefined
    const created = writable ? new URL(`ra-interop-${env.runId}.txt`, config.scratchContainer).href : undefined
    const readable = created ?? config.privateResource
    const body = `reactive-authentication LWS interop ${env.runId}`
    const plain = globalThis.fetch.bind(globalThis)
    const needsScratch = () => writable ? undefined : "no dedicated scratchContainer configured: read-only target"
    const newCode = config.suite === "openid" ? codeProviders(config, env) : undefined
    const authorizationServers = authorizationServersOf(config)
    const insecure = config.insecure === true
    let keys
    let openIdProvider

    /** A fresh application instance: its own credential source, token cache and recorder. */
    async function client({managerBoundary = [], automatic} = {}) {
        const recorder = recordingFetch()
        const http = recorder.http(insecure)
        let source
        let code
        if (config.suite === "openid") {
            openIdProvider ??= await new XASProvider({getIssuer: async () => new URL(config.openid.issuer)}, http)
                .getAuthorizationServer(new Request(config.openid.issuer))
            code = newCode()
            const clients = config.openid.clientId === undefined ? new DynamicRegistrationClientProvider(http) : registeredClient(config.openid)
            source = new OidcIdTokenSource(openIdProvider, config.redirectUri, code, clients, {http, requireAudience: config.openid.requireAudience === true})
        } else if (config.suite === "saml") {
            source = new SamlAssertionSource({id: `${new URL(config.saml.assertionEndpoint).origin}|interop`, obtainAssertion: samlObtainer(config, env)})
        } else {
            keys ??= await keyPairFromJwkFile(config.selfIssued.keyFile)
            source = config.suite === "did-key"
                ? await DidKeySource.fromKeyPair({privateKey: keys.privateKey, publicKey: keys.publicKey})
                : new SelfIssuedJwtSource({subject: config.selfIssued.subject, keyId: config.selfIssued.keyId, privateKey: keys.privateKey, algorithm: keys.algorithm})
        }
        const provider = new LwsTokenProvider(source, {
            http,
            ...(authorizationServers === undefined ? {} : {trustAuthorizationServer: trustAuthorizationServers(authorizationServers)}),
        })
        const boundary = automatic?.(http) ?? new CredentialBoundary([config.storage, ...managerBoundary], {allowInsecureHttp: insecure || managerBoundary.length > 0})
        const manager = new ReactiveFetchManager({providers: [provider], boundary, fetch: recorder.fetch})
        return {manager, recorder, source, code, boundary}
    }

    const exchanges = (recorder, grant = TOKEN_EXCHANGE_GRANT) => recorder.log.filter(e => e.grantType === grant && e.status === 200)
    const credentialed = (recorder, mark, prefix) => recorder.since(mark).filter(e => `${e.origin}${e.path}`.startsWith(prefix) && (e.authorization !== undefined || e.dpop))
    const status = async responsePromise => {
        const response = await responsePromise
        await response.body?.cancel()
        return response.status
    }
    const ok = s => s === 200 || s === 201 || s === 204 || s === 205

    /** The subject the storage sees for this suite (never reported, only compared). */
    async function subjectOf(c) {
        if (config.suite === "openid") return (await c.source.identity())?.subject
        if (config.suite === "did-key") return c.source.did
        if (config.suite === "controlled-identifier") return config.selfIssued.subject
        return undefined // SAML: the NameID stays inside the assertion, which the client does not parse
    }

    return [
        {
            id: "lws.login-read",
            async run(ctx, state) {
                const c = await client()
                state.main = c
                state.created = []
                if (writable) {
                    // Also the first protected request, so it triggers the authentication.
                    // Ownership is recorded only on 201 Created: with If-None-Match: * a 2xx other than 201 (e.g. 204)
                    // does not confirm that this run created the resource (RFC 9110 §9.3.4 uses 200/204 for
                    // replacing an existing representation), so cleanup never deletes anything unconfirmed.
                    const made = await status(c.manager.fetch(created, {method: "PUT", headers: {"content-type": "text/plain", "if-none-match": "*"}, body, signal: ctx.signal}))
                    ctx.check(made === 201, made === 200 || made === 204
                        ? `creation with If-None-Match: * answered ${made}, not 201 Created, so this run cannot confirm it created the resource; it is not recorded as run-owned and will not be deleted (configure a read-only privateResource for this deployment, and check the scratch container manually)`
                        : `creation of the run-owned resource answered ${made} (expected 201 Created)`)
                    state.created.push(created)
                } else {
                    ctx.equal(await status(c.manager.fetch(config.privateResource, {signal: ctx.signal})), 200, "authenticated read of the configured private resource")
                }
                const log = c.recorder.log
                const first = log.find(e => e.origin === new URL(readable).origin && e.status === 401)
                ctx.check(first !== undefined && first.authorization === undefined && !first.dpop, "the first request carried no credentials and was challenged with 401")
                ctx.equal(first.challenge?.toLowerCase(), "bearer", "the storage's challenge scheme")
                const replay = log.slice(log.indexOf(first) + 1).find(e => e.origin === first.origin && e.path === first.path && e.method === first.method)
                ctx.equal(replay?.authorization, "Bearer", "the replayed request used the Bearer scheme")
                ctx.check(!replay.dpop, "no DPoP proof accompanies an LWS Bearer token")
                const exchanged = exchanges(c.recorder)
                ctx.equal(exchanged.length, 1, "successful RFC 8693 token exchanges")
                const trusted = authorizationServers?.map(u => new URL(u).origin) ?? [new URL(config.storage).origin]
                ctx.check(exchanged.every(e => trusted.includes(e.origin)), "the credential went only to a trusted authorization server")

                if (config.suite === "openid") {
                    ctx.equal(exchanges(c.recorder, "authorization_code").length, 1, "authorization code exchanges at the OpenID provider")
                    ctx.check(c.code.requests.every(r => r.codeChallengeMethod === "S256" && r.hasState && r.hasNonce), "every authorization request used S256 PKCE, state and nonce")
                    ctx.check(/\bopenid\b/.test(c.code.requests.at(-1).scope), "openid scope requested")
                }
                const subject = await subjectOf(c)
                if (subject !== undefined) ctx.check(/^[a-zA-Z][a-zA-Z0-9+.-]*:\S+$/.test(subject), "the agent identifier is a URI")
                if (config.expectedSubject !== undefined) {
                    ctx.check(subject !== undefined, "this suite exposes the agent identifier to compare")
                    ctx.same(subject, config.expectedSubject, "the agent identifier is the configured test identity")
                }
                if (writable) {
                    const read = await c.manager.fetch(created, {signal: ctx.signal})
                    ctx.equal(read.status, 200, "the created resource reads back")
                    ctx.equal(await read.text(), body, "the written content reads back")
                }
                ctx.note({
                    suite: config.suite, mode: writable ? "scratch-writes" : "read-only",
                    authorizationServerSameOrigin: exchanged[0]?.origin === new URL(config.storage).origin,
                })
            },
        },
        {
            id: "lws.write",
            needs: ["writes"],
            after: ["lws.login-read"],
            untested: needsScratch,
            async run(ctx, {main}) {
                const anonymous = await status(plain(created, {signal: ctx.signal}))
                ctx.check(anonymous === 401 || anonymous === 403, `the run-owned resource is private (unauthenticated GET answered ${anonymous})`)
                const current = await main.manager.fetch(created, {signal: ctx.signal})
                const etag = current.headers.get("etag")
                await current.body?.cancel()
                ctx.check(etag !== null, "the created resource has an ETag")
                const updated = `${body} (updated)`
                ctx.check(ok(await status(main.manager.fetch(created, {method: "PUT", headers: {"content-type": "text/plain", "if-match": etag}, body: updated, signal: ctx.signal}))), "conditional update of the run-owned resource")
                const read = await main.manager.fetch(created, {signal: ctx.signal})
                ctx.equal(await read.text(), updated, "the update reads back")
                ctx.equal(exchanges(main.recorder).length, 1, "the realm-bound token was reused (no new exchange)")
            },
        },
        {
            id: "lws.boundary",
            after: ["lws.login-read"],
            async run(ctx, {main}) {
                // A local decoy is inside the manager's boundary here but its challenge names no trusted binding;
                // the look-alike path and another storage are outside. All probes are read-only GETs.
                const other = await decoy()
                try {
                    const c = await client({managerBoundary: [`${other.url}/`]})
                    ctx.equal(await status(c.manager.fetch(readable, {signal: ctx.signal})), 200, "GET inside the storage")
                    const mark = c.recorder.mark()
                    const decoyStatus = await c.manager.fetch(`${other.url}/steal`, {signal: ctx.signal}).then(r => r.status, () => "refused")
                    ctx.check(decoyStatus === 401 || decoyStatus === "refused", `the decoy's challenge was not answered with credentials (${decoyStatus})`)
                    ctx.check(other.seen.length >= 1 && other.seen.every(s => !s.credentials), "the decoy never received credentials")
                    const lookalike = new URL(`ra-interop-absent-${env.runId}`, `${config.storage.replace(/\/$/, "")}-lookalike/`).href
                    await status(main.manager.fetch(lookalike, {signal: ctx.signal}))
                    const probes = [lookalike]
                    if (config.otherProtected !== undefined) {
                        const s = await status(main.manager.fetch(config.otherProtected, {signal: ctx.signal}))
                        ctx.check(s === 401 || s === 403, `the protected resource outside the storage stays unauthorized (${s})`)
                        probes.push(config.otherProtected)
                    }
                    for (const url of probes) ctx.equal(credentialed(main.recorder, 0, url).length, 0, "credentialed requests outside the storage")
                    ctx.check(exchanges(c.recorder).every(e => e.origin !== new URL(other.url).origin), "no token exchange with the decoy")
                    ctx.equal(credentialed(c.recorder, mark, other.url).length, 0, "credentialed requests to the decoy")
                    ctx.note({otherProtectedProbed: config.otherProtected !== undefined})
                } finally {
                    await other.close()
                }
            },
        },
        {
            id: "lws.boundary-automatic",
            needs: ["storageDiscovery"],
            after: ["lws.login-read"],
            async run(ctx) {
                // AutomaticCredentialBoundary with traversal "headers-only": the only evidence is the first
                // challenged response's LWS storage Link (lws#storage → same-origin storage description →
                // StorageRoot, confirmed by the root's own Link). No ancestor probing. The application's policy
                // makes only the storage's origin eligible and approves only the configured storage root.
                const storageOrigin = new URL(config.storage).origin
                const discovered = []
                const c = await client({automatic: http => new AutomaticCredentialBoundary({
                    http, allowInsecureHttp: insecure, traversal: "headers-only",
                    eligible: url => url.origin === storageOrigin,
                    approve: root => {
                        discovered.push(root)
                        return root.root === config.storage
                    },
                })})
                const read = await status(c.manager.fetch(readable, {signal: ctx.signal}))
                ctx.check(discovered.length > 0 || read !== 401, "the challenged response advertised no verifiable LWS storage (no lws#storage Link, or its description/root did not confirm it), so the automatic boundary admitted nothing and no credentials were sent")
                ctx.equal(read, 200, "GET with the discovered boundary")
                const first = c.recorder.log.find(e => e.status === 401)
                ctx.check(first !== undefined && first.authorization === undefined && !first.dpop, "discovery started from an unauthenticated 401")
                ctx.check(discovered.length >= 1 && discovered.every(d => d.source === "lws"), `the root was established from LWS evidence (sources: ${discovered.map(d => d.source).join(", ") || "none"})`)
                ctx.check(discovered.some(d => d.root === config.storage), "the discovered root is the configured storage (StorageRoot)")
                ctx.check(c.boundary.roots.length === 1 && c.boundary.roots[0] === config.storage, "the boundary holds exactly the configured storage root")
                const heads = c.recorder.log.filter(e => e.method === "HEAD")
                ctx.check(heads.every(e => `${e.origin}${e.path}` === config.storage && e.authorization === undefined && !e.dpop), "headers-only: the only HEAD was the unauthenticated root confirmation (no ancestor traversal)")

                // Nothing outside the discovered root receives credentials: a look-alike sibling path (eligible
                // origin, not under the root) and, when configured, a protected resource outside the storage.
                const mark = c.recorder.mark()
                const lookalike = new URL(`ra-interop-absent-${env.runId}`, `${config.storage.replace(/\/$/, "")}-lookalike/`).href
                await status(c.manager.fetch(lookalike, {signal: ctx.signal}))
                const probes = [lookalike]
                if (config.otherProtected !== undefined) {
                    const s = await status(c.manager.fetch(config.otherProtected, {signal: ctx.signal}))
                    ctx.check(s === 401 || s === 403, `the protected resource outside the storage stays unauthorized (${s})`)
                    probes.push(config.otherProtected)
                }
                for (const url of probes) ctx.equal(credentialed(c.recorder, mark, url).length, 0, "credentialed requests outside the discovered root")
                ctx.check(c.boundary.roots.every(root => root === config.storage), "no other root was added")
                ctx.equal(exchanges(c.recorder).length, 1, "one token exchange (inside the storage only)")
                ctx.note({discoveredVia: "lws", otherProtectedProbed: config.otherProtected !== undefined})
            },
        },
        {
            id: "lws.logout",
            after: ["lws.login-read"],
            async run(ctx) {
                const c = await client()
                ctx.equal(await status(c.manager.fetch(readable, {signal: ctx.signal})), 200, "GET before logout")
                ctx.equal(await status(c.manager.fetch(readable, {signal: ctx.signal})), 200, "second GET before logout")
                ctx.equal(exchanges(c.recorder).length, 1, "the cached realm-bound token was reused before logout")
                await c.manager.logout()
                ctx.equal(await status(c.manager.fetch(readable, {signal: ctx.signal})), 200, "GET after logout (authenticated again)")
                ctx.equal(exchanges(c.recorder).length, 2, "logout dropped the access token: a new exchange was needed")
                if (config.suite === "openid") ctx.equal(exchanges(c.recorder, "authorization_code").length, 2, "logout forgot the OpenID session: a new authorization was needed")
            },
        },
        {
            id: "lws.cleanup",
            after: ["lws.login-read"],
            always: true, // runs even when lws.login-read failed after creating something
            untested: needsScratch,
            async run(ctx, state) {
                if (state.main === undefined) throw new Error("blocked: lws.login-read did not run, so nothing can be cleaned up")
                if (state.created.length === 0) throw new Error("blocked: lws.login-read created nothing (it failed before the create)")
                for (const url of [...state.created].reverse()) {
                    const deleted = await status(state.main.manager.fetch(url, {method: "DELETE", signal: ctx.signal}))
                    ctx.check(ok(deleted), `DELETE of the run-owned resource answered ${deleted}`)
                }
                const gone = await status(state.main.manager.fetch(created, {signal: ctx.signal}))
                ctx.check(gone === 404 || gone === 410, `the run-owned resource is gone (${gone})`)
            },
        },
    ]
}
