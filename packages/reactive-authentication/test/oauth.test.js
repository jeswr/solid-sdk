import assert from "node:assert/strict"
import { after, before, test } from "node:test"
import { createMemoryStore } from "@key-value-kit/storage/memory"
import { CredentialBoundary, OAuthBearerTokenProvider, OAuthCodeSource, ReactiveFetchManager } from "../dist/mod.js"
import { insecure, transport } from "./helpers/http.js"
import { startApi, startOAuthProvider } from "./helpers/oauth.js"
import { automaticCodeProvider } from "./helpers/openid.js"
import { sharedFences } from "./helpers/solid.js"

const redirectUri = "https://app.example/oauth/callback"
let provider, api, otherApi
before(async () => {
    provider = await startOAuthProvider()
    api = await startApi(provider)
    otherApi = await startApi(provider)
})
after(async () => {
    await otherApi.close()
    await api.close()
    await provider.close()
})

function oauthClient(sourceOptions = {}, {resources = [`${api.url}/`], boundary} = {}) {
    const code = automaticCodeProvider()
    const source = new OAuthCodeSource({issuer: provider.issuer, clientId: "spa-client", redirectUri, scopes: ["read"], resource: api.url, codeProvider: code, http: insecure, ...sourceOptions})
    const bearer = new OAuthBearerTokenProvider(source, {resources: new CredentialBoundary(resources, {allowInsecureHttp: true})})
    const manager = new ReactiveFetchManager({providers: [bearer], boundary: boundary ?? new CredentialBoundary([`${api.url}/`, `${otherApi.url}/`], {allowInsecureHttp: true}), fetch: transport})
    return {code, source, bearer, manager}
}

test("plain OAuth: S256 PKCE, resource indicator, no nonce/prompt/ID token, opaque Bearer token accepted", async () => {
    const {manager, source} = oauthClient()
    const response = await manager.fetch(`${api.url}/items`)
    assert.equal(response.status, 200)
    const authorize = provider.stats.authorize.at(-1)
    assert.equal(authorize.code_challenge_method, "S256")
    assert.equal(authorize.scope, "read", "no openid, webid or offline_access added")
    assert.equal(authorize.nonce, undefined)
    assert.equal(authorize.prompt, undefined)
    assert.equal(authorize.resource, api.url)
    const token = provider.stats.token.at(-1)
    assert.equal(token.resource, api.url)
    assert.equal(token.dpop, null, "no DPoP proof to a generic OAuth server")
    assert.equal(await source.identity(), undefined, "an access token is not an identity")
})

test("OpenID Connect: validated identity; bad nonce, issuer, audience, state or redirect are refused", async () => {
    const good = oauthClient({scopes: ["openid", "read"]})
    assert.equal((await good.manager.fetch(`${api.url}/me`)).status, 200)
    assert.ok(provider.stats.authorize.at(-1).nonce)
    const identity = await good.source.identity()
    assert.equal(identity.subject, "user-42")
    assert.equal(identity.issuer, provider.issuer)

    for (const [tamper, pattern] of [[{nonce: true}, /nonce/], [{issuer: true}, /iss/], [{audience: true}, /aud/], [{state: true}, /state/], [{redirect: "https://evil.example/oauth/callback"}, /redirect URI/]]) {
        provider.setTamper(tamper)
        try {
            await assert.rejects(oauthClient({scopes: ["openid", "read"]}).manager.fetch(`${api.url}/me`), pattern, JSON.stringify(tamper))
        } finally {
            provider.setTamper({nonce: false, issuer: false, audience: false, state: false, redirect: undefined})
        }
    }
})

test("explicit trusted metadata works for servers without discovery; a confidential client authenticates (server-side)", async () => {
    const hidden = await startOAuthProvider({discovery: "none", clientSecret: "s3cret"})
    const hiddenApi = await startApi(hidden)
    try {
        const source = new OAuthCodeSource({authorizationServer: hidden.metadata(), clientId: "server-client", clientSecret: "s3cret", redirectUri, scopes: ["read"], resource: hiddenApi.url, codeProvider: automaticCodeProvider(), http: insecure})
        const bearer = new OAuthBearerTokenProvider(source, {resources: new CredentialBoundary([`${hiddenApi.url}/`], {allowInsecureHttp: true})})
        const manager = new ReactiveFetchManager({providers: [bearer], boundary: new CredentialBoundary([`${hiddenApi.url}/`], {allowInsecureHttp: true}), fetch: transport})
        assert.equal((await manager.fetch(`${hiddenApi.url}/x`)).status, 200)
        assert.match(hidden.stats.token.at(-1).authorization, /^Basic /)
        assert.throws(() => new OAuthCodeSource({issuer: "https://a.example", authorizationServer: hidden.metadata(), clientId: "c", redirectUri, scopes: [], codeProvider: automaticCodeProvider()}), /exactly one/)
    } finally {
        await hiddenApi.close()
        await hidden.close()
    }
})

test("expiry and rejection renew via the refresh token; concurrent requests never reuse a rotated refresh token", async () => {
    const short = await startOAuthProvider({expiresIn: 20}) // below the session's 30 s skew
    const shortApi = await startApi(short)
    try {
        const code = automaticCodeProvider()
        const source = new OAuthCodeSource({issuer: short.issuer, clientId: "c", redirectUri, scopes: ["read"], resource: shortApi.url, codeProvider: code, http: insecure})
        const bearer = new OAuthBearerTokenProvider(source, {resources: new CredentialBoundary([`${shortApi.url}/`], {allowInsecureHttp: true})})
        const manager = new ReactiveFetchManager({providers: [bearer], boundary: new CredentialBoundary([`${shortApi.url}/`], {allowInsecureHttp: true}), fetch: transport})
        assert.equal((await manager.fetch(`${shortApi.url}/1`)).status, 200)
        const responses = await Promise.all(Array.from({length: 4}, (_, i) => manager.fetch(`${shortApi.url}/${i}`)))
        assert.ok(responses.every(r => r.status === 200))
        assert.equal(short.stats.reuse, 0, "rotating refresh tokens consumed once")
        assert.equal(code.calls, 1)

        short.revoke(shortApi.server.requests.at(-1).headers.get("authorization").slice(7))
        const refreshes = short.stats.refresh
        assert.equal((await manager.fetch(`${shortApi.url}/after-revoke`)).status, 200)
        assert.ok(short.stats.refresh > refreshes)
        assert.equal(code.calls, 1, "renewed without a new authorization")
    } finally {
        await shortApi.close()
        await short.close()
    }
})

test("logout forgets the session; accounts sharing a cache and namespace stay isolated", async () => {
    const {manager, code} = oauthClient()
    assert.equal((await manager.fetch(`${api.url}/l`)).status, 200)
    await manager.logout()
    assert.equal((await manager.fetch(`${api.url}/l`)).status, 200)
    assert.equal(code.calls, 2)

    const [fence] = sharedFences()
    const shared = {namespace: "app", cache: createMemoryStore(), fence}
    const alice = oauthClient({...shared, account: "alice"})
    const bob = oauthClient({...shared, account: "bob"})
    assert.notEqual(alice.source.id, bob.source.id)
    assert.equal((await alice.manager.fetch(`${api.url}/a`)).status, 200)
    assert.equal((await bob.manager.fetch(`${api.url}/b`)).status, 200)
    assert.equal(bob.code.calls, 1, "bob authorized on his own")
    fence.close()
})

test("tokens never cross API boundaries, even under a broad manager boundary or a hostile challenge", async () => {
    const {manager, bearer} = oauthClient()
    assert.equal((await manager.fetch(`${api.url}/mine`)).status, 200)
    const before = otherApi.server.requests.length
    // The manager would allow otherApi, but the provider's resources do not include it.
    assert.equal((await manager.fetch(`${otherApi.url}/theirs`)).status, 401)
    assert.equal(otherApi.server.requests.slice(before).filter(r => r.headers.has("authorization")).length, 0)
    await assert.rejects(bearer.upgrade(new Request(`${otherApi.url}/theirs`)), /not a resource/)

    const request = new Request(`${api.url}/x`)
    const challenge = challenges => ({response: new Response(null, {status: 401}), challenges})
    assert.equal(await bearer.matches(request, challenge([{scheme: "dpop", params: {}}])), false)
    assert.equal(await bearer.matches(request, challenge([{scheme: "uma", params: {as_uri: "https://evil.example", ticket: "t"}}])), false)
    // A Bearer challenge naming another server changes nothing: configuration, not the challenge, decides.
    const authorizations = provider.stats.authorize.length
    assert.equal(await bearer.matches(request, challenge([{scheme: "bearer", params: {as_uri: "https://evil.example", realm: "https://evil.example/"}}])), true)
    const upgraded = await bearer.upgrade(new Request(`${api.url}/x`, {headers: {dpop: "stale-proof"}}))
    assert.equal(upgraded.headers.get("dpop"), null, "stale DPoP header removed")
    assert.match(upgraded.headers.get("authorization"), /^Bearer /)
    assert.equal(provider.stats.authorize.length, authorizations, "cached token; no new authorization at another server")
})

test("review: a provider and source sharing one fence log out without deadlock", async () => {
    const [fence] = sharedFences()
    const code = automaticCodeProvider()
    const source = new OAuthCodeSource({issuer: provider.issuer, clientId: "spa-client", redirectUri, scopes: ["read"], resource: api.url, codeProvider: code, http: insecure, fence})
    const bearer = new OAuthBearerTokenProvider(source, {resources: new CredentialBoundary([`${api.url}/`], {allowInsecureHttp: true}), fence})
    const manager = new ReactiveFetchManager({providers: [bearer], boundary: new CredentialBoundary([`${api.url}/`], {allowInsecureHttp: true}), fetch: transport, fence})
    assert.equal((await manager.fetch(`${api.url}/shared`)).status, 200)
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error("logout deadlocked")), 2000))
    await Promise.race([manager.logout(), timeout])
    assert.equal((await manager.fetch(`${api.url}/shared`)).status, 200)
    assert.equal(code.calls, 2)
    fence.close()
})

test("review: token-affecting configuration isolates a shared store; reserved parameters have their own options", async () => {
    const [fence] = sharedFences()
    const shared = {namespace: "app", cache: createMemoryStore(), fence}
    const base = oauthClient(shared)
    assert.equal((await base.manager.fetch(`${api.url}/iso`)).status, 200)
    for (const variant of [{clientId: "other-client"}, {scopes: ["read", "write"]}, {resource: `${api.url}/v2`}, {parameters: {login_hint: "bob"}}, {prompt: "login"}]) {
        const other = oauthClient({...shared, ...variant})
        assert.notEqual(other.source.id, base.source.id, JSON.stringify(variant))
        await other.source.authorize()
        assert.equal(other.code.calls, 1, `${JSON.stringify(variant)} did not reuse another configuration's token`)
    }
    assert.equal(provider.stats.authorize.at(-1).prompt, "login", "explicit prompt option is sent")
    for (const name of ["audience", "resource", "prompt"]) {
        assert.throws(() => oauthClient({parameters: {[name]: "x"}}), new RegExp(`${name} option`))
    }
    fence.close()
})

test("review: plain OAuth with offline_access gets no automatic prompt=consent; non-Bearer tokens are refused", async () => {
    const {manager} = oauthClient({scopes: ["read", "offline_access"]})
    assert.equal((await manager.fetch(`${api.url}/offline`)).status, 200)
    assert.equal(provider.stats.authorize.at(-1).prompt, undefined)

    const dpopIssuer = await startOAuthProvider({tokenType: "DPoP"})
    try {
        const source = new OAuthCodeSource({issuer: dpopIssuer.issuer, clientId: "c", redirectUri, scopes: ["read"], codeProvider: automaticCodeProvider(), http: insecure})
        await assert.rejects(source.authorize(), /Bearer/)
    } finally {
        await dpopIssuer.close()
    }
})

test("review: the callback must keep fixed redirect query parameters and carry no fragment", async () => {
    const fixed = "https://app.example/oauth/callback?tenant=a"
    const {source} = oauthClient({redirectUri: fixed})
    await source.authorize()
    for (const redirect of ["https://app.example/oauth/callback?tenant=b", "https://app.example/oauth/callback", "https://user:pw@app.example/oauth/callback?tenant=a", "https://app.example/oauth/callback?tenant=a#frag"]) {
        provider.setTamper({redirect})
        try {
            await assert.rejects(oauthClient({redirectUri: fixed}).source.authorize(), /redirect URI/, redirect)
        } finally {
            provider.setTamper({redirect: undefined})
        }
    }
})

test("review: logout during delayed discovery aborts the operation; one caller's abort does not fail another", async () => {
    const delayed = await startOAuthProvider()
    try {
        const make = () => new OAuthCodeSource({issuer: delayed.issuer, clientId: "c", redirectUri, scopes: ["read"], codeProvider: automaticCodeProvider(), http: insecure})
        let source = make()
        let release = delayed.delayDiscovery()
        const pending = source.authorize()
        await new Promise(r => setTimeout(r, 20))
        await source.forget()
        release()
        await assert.rejects(pending, e => e.name === "SessionSupersededError" || e.name === "AbortError")
        assert.equal(delayed.stats.authorize.length, 0, "no session started after logout")

        source = make()
        release = delayed.delayDiscovery()
        const controller = new AbortController()
        const abandoned = source.authorize(controller.signal)
        const other = source.authorize()
        controller.abort(new Error("caller gave up"))
        await assert.rejects(abandoned, /caller gave up/)
        release()
        assert.ok((await other).token)
    } finally {
        await delayed.close()
    }
})

test("review: HTTP authorization endpoints and browser/worker secrets are refused; token protocol parameters are protected", async () => {
    const {authorizationCodeGrant} = await import("../dist/mod.js")
    const code = automaticCodeProvider()
    const source = new OAuthCodeSource({authorizationServer: provider.metadata(), clientId: "c", redirectUri, scopes: ["read"], codeProvider: code})
    await assert.rejects(source.authorize(), /HTTPS/)
    assert.equal(code.calls, 0, "the user is never sent to an insecure authorization endpoint")

    globalThis.WorkerGlobalScope = function WorkerGlobalScope() {}
    try {
        assert.throws(() => new OAuthCodeSource({issuer: provider.issuer, clientId: "c", clientSecret: "s", redirectUri, scopes: [], codeProvider: code}), /workers/)
    } finally {
        delete globalThis.WorkerGlobalScope
    }

    await assert.rejects(authorizationCodeGrant({authorizationServer: provider.metadata(), client: {client_id: "c"}, redirectUri, codeProvider: code, scopes: [], signal: AbortSignal.timeout(1000), tokenParameters: {code_verifier: "x"}}), /cannot be overridden/)
})
