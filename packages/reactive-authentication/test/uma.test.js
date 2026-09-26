import assert from "node:assert/strict"
import { after, before, test } from "node:test"
import { createMemoryStore } from "@key-value-kit/storage/memory"
import {
    CachingClientProvider, CredentialBoundary, DPoPTokenProvider, DidKeySource, DynamicRegistrationClientProvider,
    LwsTokenProvider, ReactiveFetchManager, SolidUmaTokenProvider, UmaAuthorizationError, XASProvider,
} from "../dist/mod.js"
import { insecure, serve, transport } from "./helpers/http.js"
import { automaticCodeProvider, startOpenIdProvider } from "./helpers/openid.js"
import { callback } from "./helpers/solid.js"
import { PROFILE, startUma } from "./helpers/uma.js"

let op, uma
before(async () => {
    op = await startOpenIdProvider({webId: "https://id.example/alice#me"})
    uma = await startUma(op)
})
after(async () => {
    await uma.close()
    await op.close()
})

function umaClient(server, options = {}) {
    const code = automaticCodeProvider()
    const provider = new SolidUmaTokenProvider(callback, code,
        new XASProvider({getIssuer: async () => new URL(op.issuer)}, insecure),
        new CachingClientProvider(new DynamicRegistrationClientProvider(insecure)),
        {http: insecure, ...options})
    const manager = new ReactiveFetchManager({providers: options.providers?.(provider) ?? [provider], boundary: new CredentialBoundary([`${server.url}/uma/`], {allowInsecureHttp: true}), fetch: transport})
    return {code, provider, manager}
}

test("Solid-OIDC §9 UMA: ticket + DPoP-bound ID token exchanged for an RPT presented with fresh proofs", async () => {
    const {manager, code} = umaClient(uma)
    const response = await manager.fetch(`${uma.url}/uma/a`)
    assert.equal(response.status, 200)
    assert.equal(await response.text(), "hello https://id.example/alice#me")
    const exchange = uma.stats.exchanges.at(-1)
    assert.equal(exchange.grant_type, "urn:ietf:params:oauth:grant-type:uma-ticket")
    assert.equal(exchange.claim_token_format, PROFILE)
    assert.ok(exchange.ticket)
    assert.equal(code.calls, 1)

    // Same URL: cached RPT, new proof. Another URL (unverified storage → its own context): new ticket
    // exchange, but the same ID token (no new login).
    const exchanges = uma.stats.exchanges.length
    assert.equal((await manager.fetch(`${uma.url}/uma/a`, {method: "PUT", body: "x"})).status, 200)
    assert.equal(uma.stats.exchanges.length, exchanges)
    assert.equal((await manager.fetch(`${uma.url}/uma/b`)).status, 200)
    assert.equal(uma.stats.exchanges.length, exchanges + 1)
    assert.equal(code.calls, 1)
})

test("a rejected RPT is exchanged again once with the new ticket; a DPoP nonce is retried once", async () => {
    const {manager} = umaClient(uma)
    assert.equal((await manager.fetch(`${uma.url}/uma/r`)).status, 200)
    uma.revoke(uma.stats.accepted.at(-1).token)
    const exchanges = uma.stats.exchanges.length
    assert.equal((await manager.fetch(`${uma.url}/uma/r`)).status, 200)
    assert.equal(uma.stats.exchanges.length, exchanges + 1)

    const nonced = await startUma(op, {nonce: true})
    try {
        assert.equal((await umaClient(nonced).manager.fetch(`${nonced.url}/uma/n`)).status, 200)
        assert.equal(nonced.stats.nonceChallenges, 1)
    } finally {
        await nonced.close()
    }
})

test("need_info fails explicitly with the claims interaction hint, without looping", async () => {
    const gated = await startUma(op, {needInfo: true})
    try {
        await assert.rejects(umaClient(gated).manager.fetch(`${gated.url}/uma/x`), e =>
            e instanceof UmaAuthorizationError && e.error === "need_info" && e.redirectUser?.startsWith(`${gated.url}/claims`) && typeof e.ticket === "string")
        assert.equal(gated.stats.exchanges.length, 1)
    } finally {
        await gated.close()
    }
})

test("an untrusted UMA authorization server is refused before any login or credential use", async () => {
    const evil = await serve(() => new Response(null, {status: 500}))
    const lured = await startUma(op, {asUri: () => evil.url})
    try {
        const {manager, code} = umaClient(lured)
        const authorizations = op.stats.authorize.length
        await assert.rejects(manager.fetch(`${lured.url}/uma/x`), /not trusted/)
        assert.equal(code.calls, 0)
        assert.equal(op.stats.authorize.length, authorizations)
        assert.equal(evil.requests.length, 0)
    } finally {
        await lured.close()
        await evil.close()
    }
})

test("logout forgets RPTs and the ID token session", async () => {
    const {manager, code} = umaClient(uma)
    assert.equal((await manager.fetch(`${uma.url}/uma/l`)).status, 200)
    await manager.logout()
    const exchanges = uma.stats.exchanges.length
    assert.equal((await manager.fetch(`${uma.url}/uma/l`)).status, 200)
    assert.equal(uma.stats.exchanges.length, exchanges + 1)
    assert.equal(code.calls, 2, "logged in again")
})

test("provider selection: UMA challenges go to the UMA provider, never to DPoP or LWS providers", async () => {
    const lwsProvider = new LwsTokenProvider(await DidKeySource.generate(), {http: insecure})
    const {manager} = umaClient(uma, {providers: umaProvider => [lwsProvider, new DPoPTokenProvider(callback, automaticCodeProvider(), new XASProvider({getIssuer: async () => new URL(op.issuer)}, insecure), new DynamicRegistrationClientProvider(insecure), undefined, {http: insecure}), umaProvider]})
    const challenge = {response: new Response(), challenges: [{scheme: "uma", params: {realm: "storage", as_uri: uma.url, ticket: "t"}}]}
    assert.equal(await lwsProvider.matches(new Request(uma.url), challenge), false)
    assert.equal((await manager.fetch(`${uma.url}/uma/mixed`)).status, 200)
})

test("supplied credential stores require a shared fence", () => {
    const make = options => new SolidUmaTokenProvider(callback, automaticCodeProvider(), {getAuthorizationServer: async () => ({})}, {getClient: async () => ({})}, options)
    assert.throws(() => make({namespace: "n", rptStore: createMemoryStore()}), /SessionFence/)
    assert.throws(() => make({namespace: "n", cache: createMemoryStore()}), /SessionFence/)
})

test("uma-review #1: accounts sharing an RPT store, fence and namespace never share RPTs", async () => {
    const {sharedFences} = await import("./helpers/solid.js")
    const [fence] = sharedFences()
    const shared = {namespace: "app", rptStore: createMemoryStore(), fence}
    const alice = umaClient(uma, {...shared, account: "alice"})
    const bob = umaClient(uma, {...shared, account: "bob"})
    try {
        op.setWebId("https://id.example/alice#me")
        assert.equal(await (await alice.manager.fetch(`${uma.url}/uma/acct`)).text(), "hello https://id.example/alice#me")
        op.setWebId("https://id.example/bob#me")
        const exchanges = uma.stats.exchanges.length
        assert.equal(await (await bob.manager.fetch(`${uma.url}/uma/acct`)).text(), "hello https://id.example/bob#me")
        assert.equal(uma.stats.exchanges.length, exchanges + 1, "bob exchanged his own ticket")
        assert.equal(await (await alice.manager.fetch(`${uma.url}/uma/acct`)).text(), "hello https://id.example/alice#me", "alice keeps her RPT")
        assert.equal(uma.stats.exchanges.length, exchanges + 1)
    } finally {
        op.setWebId("https://id.example/alice#me")
        fence.close()
    }
})

test("uma-review #2: forget() while the trust policy is pending aborts that upgrade before login or exchange", async () => {
    const gate = Promise.withResolvers()
    const started = Promise.withResolvers()
    const {manager, provider, code} = umaClient(uma, {trustAuthorizationServer: async () => { started.resolve(); await gate.promise; return true }})
    const exchanges = uma.stats.exchanges.length
    const pending = manager.fetch(`${uma.url}/uma/policy`)
    await started.promise
    await provider.forget()
    gate.resolve()
    await assert.rejects(pending, e => e.name === "SessionSupersededError" || e.name === "AbortError")
    assert.equal(code.calls, 0, "no login")
    assert.equal(uma.stats.exchanges.length, exchanges, "no exchange")
})
