import assert from "node:assert/strict"
import { after, before, test } from "node:test"
import { createMemoryStore } from "@key-value-kit/storage/memory"
import { SessionSupersededError } from "../dist/mod.js"
import { startOpenIdProvider, startSolidStorage, automaticCodeProvider } from "./helpers/openid.js"
import { callback, deferred, sharedFences, solidClient } from "./helpers/solid.js"

let op, rs
before(async () => {
    op = await startOpenIdProvider()
    rs = await startSolidStorage(op)
})
after(async () => {
    await rs.close()
    await op.close()
})

test("authenticates reactively with PKCE, state, nonce and per-request DPoP proofs; storages are separate contexts", async () => {
    const {manager, code} = solidClient(op, rs)
    const before = op.stats.authorize.length

    const first = await manager.fetch(`${rs.url}/alice/a`)
    assert.equal(first.status, 200)
    assert.equal(await first.text(), "hello alice")
    const request = op.stats.authorize.at(-1)
    assert.equal(request.code_challenge_method, "S256")
    assert.ok(request.state && request.nonce && request.code_challenge)
    assert.equal(request.prompt, "none")
    assert.equal(request.redirect_uri, callback)
    assert.match(request.scope, /openid webid offline_access/)

    // Same verified storage: the session is reused; a new DPoP proof is still made (the RS rejects replays).
    assert.equal((await manager.fetch(`${rs.url}/alice/b`, {method: "PUT", body: "x"})).status, 200)
    assert.equal(op.stats.authorize.length, before + 1)

    // A different storage on the same origin gets its own session (#46).
    assert.equal((await manager.fetch(`${rs.url}/bob/c`)).status, 200)
    assert.equal(op.stats.authorize.length, before + 2)
    assert.equal(code.calls, 2)
})

test("never sends credentials outside the boundary: path look-alikes, other origins, encoded traversal", async () => {
    const {manager} = solidClient(op, rs)
    const seen = rs.accepted.length
    for (const url of [`${rs.url}/alice-evil/x`, `${rs.url}/alice/%2e%2e%2fbob/x`, `http://localhost:${new URL(rs.url).port}/alice/x`]) {
        const response = await manager.fetch(url)
        assert.equal(response.status, 401, url)
    }
    assert.equal(rs.accepted.length, seen)
    const leaked = rs.server.requests.filter(r => /alice-evil|%2e/i.test(r.url) && r.headers.has("authorization"))
    assert.deepEqual(leaked, [])
})

test("silent authorization falls back to interactive prompt=consent for offline access", async () => {
    const op2 = await startOpenIdProvider({requireInteraction: true})
    const rs2 = await startSolidStorage(op2)
    try {
        const {manager} = solidClient(op2, rs2)
        assert.equal((await manager.fetch(`${rs2.url}/alice/a`)).status, 200)
        assert.deepEqual(op2.stats.authorize.map(a => a.prompt), ["none", "consent"])
        assert.notEqual(op2.stats.authorize[0].state, op2.stats.authorize[1].state, "fresh state per attempt")
    } finally {
        await rs2.close()
        await op2.close()
    }
})

test("retries once for DPoP nonces at the token endpoint and at the resource server", async () => {
    const op2 = await startOpenIdProvider({tokenNonce: true})
    const rs2 = await startSolidStorage(op2, {nonce: true})
    try {
        const {manager} = solidClient(op2, rs2)
        assert.equal((await manager.fetch(`${rs2.url}/alice/a`)).status, 200)
        assert.equal(op2.stats.nonceChallenges, 1)
        assert.equal(rs2.accepted.length, 1)
    } finally {
        await rs2.close()
        await op2.close()
    }
})

test("a rejected token is renewed once by refresh grant, and a persistent rejection surfaces the 401", async () => {
    const {manager, code} = solidClient(op, rs)
    assert.equal((await manager.fetch(`${rs.url}/alice/r`)).status, 200)
    const refreshes = op.stats.refresh
    rs.revoke(rs.accepted.at(-1).token)

    assert.equal((await manager.fetch(`${rs.url}/alice/r`)).status, 200)
    assert.equal(op.stats.refresh, refreshes + 1)
    assert.equal(code.calls, 1, "no new authorization window")

    // A server that rejects every credential: exactly one renewal, then its 401 is returned.
    const blocked = await startSolidStorage(op, {handle: async request => request.headers.has("authorization")
        ? new Response(null, {status: 401, headers: {"www-authenticate": 'DPoP error="invalid_token"'}})
        : undefined})
    try {
        const {manager: m2} = solidClient(op, blocked)
        const refreshBefore = op.stats.refresh
        const response = await m2.fetch(`${blocked.url}/alice/x`)
        assert.equal(response.status, 401)
        assert.equal(op.stats.refresh, refreshBefore + 1, "one bounded renewal")
    } finally {
        await blocked.close()
    }
})

test("concurrent requests with rotating refresh tokens consume each refresh token once", async () => {
    const op2 = await startOpenIdProvider({expiresIn: 20}) // below the 30 s skew: every use refreshes
    const rs2 = await startSolidStorage(op2)
    try {
        const {manager} = solidClient(op2, rs2)
        assert.equal((await manager.fetch(`${rs2.url}/alice/0`)).status, 200)
        const responses = await Promise.all(Array.from({length: 6}, (_, i) => manager.fetch(`${rs2.url}/alice/${i}`)))
        assert.ok(responses.every(r => r.status === 200))
        assert.equal(op2.stats.reuse, 0)
        assert.equal(op2.stats.refresh, 6)
    } finally {
        await rs2.close()
        await op2.close()
    }
})

test("review #1: with a shared session store, stale in-memory refresh tokens are never replayed across tabs", async () => {
    const op2 = await startOpenIdProvider({expiresIn: 20})
    const rs2 = await startSolidStorage(op2)
    try {
        const sessionStore = createMemoryStore()
        const [fenceA, fenceB] = sharedFences()
        const options = fence => ({provider: {namespace: "app", sessionStore, fence}, cache: createMemoryStore()})
        const a = solidClient(op2, rs2, options(fenceA))
        const b = solidClient(op2, rs2, options(fenceB))

        assert.equal((await a.manager.fetch(`${rs2.url}/alice/1`)).status, 200) // A: R1 in memory and durable
        assert.equal((await b.manager.fetch(`${rs2.url}/alice/2`)).status, 200) // B: consumes durable R1 -> R2
        assert.equal((await a.manager.fetch(`${rs2.url}/alice/3`)).status, 200) // A must use durable R2, not memory R1
        assert.equal((await b.manager.fetch(`${rs2.url}/alice/4`)).status, 200)
        assert.equal(op2.stats.reuse, 0)
        assert.equal(a.code.calls + b.code.calls, 1, "B restored without a window")
        fenceA.close(); fenceB.close()
    } finally {
        await rs2.close()
        await op2.close()
    }
})

test("review #2: logout in one tab makes other tabs' in-memory credentials unusable", async () => {
    const [fenceA, fenceB] = sharedFences()
    const a = solidClient(op, rs, {fence: fenceA, provider: {fence: fenceA}})
    const b = solidClient(op, rs, {fence: fenceB, provider: {fence: fenceB}})
    assert.equal((await a.manager.fetch(`${rs.url}/alice/x`)).status, 200)
    assert.equal((await b.manager.fetch(`${rs.url}/alice/x`)).status, 200)
    const oldTokenB = rs.accepted.at(-1).token

    await a.manager.logout()
    const refreshes = op.stats.refresh
    const accepted = rs.accepted.length
    assert.equal((await b.manager.fetch(`${rs.url}/alice/y`)).status, 200)
    assert.equal(b.code.calls, 2, "B re-authorized instead of using its pre-logout session")
    assert.equal(op.stats.refresh, refreshes, "no refresh of the pre-logout session")
    assert.notEqual(rs.accepted.slice(accepted)[0].token, oldTokenB)
    fenceA.close(); fenceB.close()
})

test("review #2: after reload, a pre-logout durable record in a store without clear() is ignored", async () => {
    const [fence] = sharedFences()
    const {getItem, setItem, removeItem} = createMemoryStore()
    const sessionStore = {getItem, setItem, removeItem} // three-method store: cannot be cleared
    const first = solidClient(op, rs, {fence, provider: {namespace: "app", sessionStore, fence}})
    assert.equal((await first.manager.fetch(`${rs.url}/alice/x`)).status, 200)

    // "Reload": a new provider that has not seen the key logs out, then another reload uses the store.
    const reloaded = solidClient(op, rs, {fence, provider: {namespace: "app", sessionStore, fence}})
    await reloaded.manager.logout()
    const again = solidClient(op, rs, {fence, provider: {namespace: "app", sessionStore, fence}})
    const refreshes = op.stats.refresh
    assert.equal(await again.provider.restore(new Request(`${rs.url}/alice/x`)), undefined)
    assert.equal(op.stats.refresh, refreshes, "stale-generation record was not used")
    fence.close()
})

test("review #3: a failed durable write leaves nothing usable and the next fetch re-authorizes", async () => {
    const [fence] = sharedFences()
    const sessionStore = createMemoryStore()
    const {manager, code} = solidClient(op, rs, {fence, provider: {namespace: "app", sessionStore, fence}})
    const write = sessionStore.setItem
    sessionStore.setItem = async () => { throw new Error("quota") }
    await assert.rejects(manager.fetch(`${rs.url}/alice/x`), /quota/)
    sessionStore.setItem = write
    const accepted = rs.accepted.length
    assert.equal((await manager.fetch(`${rs.url}/alice/x`)).status, 200)
    assert.equal(code.calls, 2)
    assert.equal(rs.accepted.length, accepted + 1)
    fence.close()
})

test("review #4: forget() without a caller fence aborts a pending authorization so it cannot repopulate", async () => {
    const gate = deferred()
    const started = deferred()
    const code = automaticCodeProvider(async () => { started.resolve(); await gate.promise })
    const {manager, provider} = solidClient(op, rs, {code})
    const pending = manager.fetch(`${rs.url}/alice/x`)
    await started.promise
    await provider.forget()
    gate.resolve()
    await assert.rejects(pending, e => e instanceof SessionSupersededError || e.name === "AbortError")
    assert.equal(await provider.identity(new Request(`${rs.url}/alice/x`)), undefined)
})

test("review #4: manager.logout() while the initial response is pending never attaches credentials", async () => {
    const gate = deferred()
    let first = true
    const fetch = async (request) => {
        if (first) { first = false; await gate.promise }
        return await globalThis.fetch(request)
    }
    const {manager, code} = solidClient(op, rs, {fetch})
    const pending = manager.fetch(`${rs.url}/alice/x`)
    await new Promise(r => setTimeout(r, 20))
    await manager.logout()
    gate.resolve()
    await assert.rejects(pending, SessionSupersededError)
    assert.equal(code.calls, 0)
})

test("review #6: refresh with an ID token but no rotation keeps identity and refresh token; subject changes are rejected", async () => {
    const op2 = await startOpenIdProvider({expiresIn: 20, rotate: false, refreshIdToken: true, webId: "https://id.example/alice#me"})
    const rs2 = await startSolidStorage(op2)
    try {
        const {manager, provider} = solidClient(op2, rs2)
        assert.equal((await manager.fetch(`${rs2.url}/alice/1`)).status, 200)
        assert.equal((await manager.fetch(`${rs2.url}/alice/2`)).status, 200)
        const identity = await provider.identity(new Request(`${rs2.url}/alice/2`))
        assert.equal(identity.webId, "https://id.example/alice#me")
        assert.equal(identity.subject, "alice")
        assert.equal(op2.stats.refresh, 1)
        const refreshToken = op2.stats.token.at(-1).refresh_token

        op2.setSubject("mallory")
        await assert.rejects(manager.fetch(`${rs2.url}/alice/3`), /different subject/)
        assert.equal(op2.stats.token.at(-1).refresh_token, refreshToken, "unrotated refresh token was kept")
    } finally {
        await rs2.close()
        await op2.close()
    }
})

test("identity: WebID verification against the profile (exact issuer match)", async () => {
    let listed
    const profile = await startSolidStorage(op, {handle: async (request, base) => new URL(request.url).pathname === "/card"
        ? new Response(`<${base}/card#me> <http://www.w3.org/ns/solid/terms#oidcIssuer> <${listed}> .`, {headers: {"content-type": "text/turtle"}})
        : undefined})
    try {
        op.setWebId(`${profile.url}/card#me`)
        listed = op.issuer
        const ok = solidClient(op, rs, {provider: {verifyWebId: true}})
        assert.equal((await ok.manager.fetch(`${rs.url}/alice/v`)).status, 200)
        const identity = await ok.provider.identity(new Request(`${rs.url}/alice/v`))
        assert.equal(identity.webIdVerified, true)
        assert.equal(identity.webId, `${profile.url}/card#me`)

        listed = `${op.issuer}tenant` // a different issuer identifier on the same origin
        const bad = solidClient(op, rs, {provider: {verifyWebId: true}})
        await assert.rejects(bad.manager.fetch(`${rs.url}/alice/v`), /does not list issuer/)
    } finally {
        op.setWebId(undefined)
        await profile.close()
    }
})

test("refresh-only persistence restores a session after reload without a window; logout revokes", async () => {
    const [fence] = sharedFences()
    const sessionStore = createMemoryStore()
    const first = solidClient(op, rs, {fence, provider: {namespace: "app", sessionStore, fence}})
    assert.equal((await first.manager.fetch(`${rs.url}/alice/p`)).status, 200)
    for (const record of sessionStore.entries?.() ?? []) assert.equal(record.tokenResult, undefined)

    const reloaded = solidClient(op, rs, {fence, provider: {namespace: "app", sessionStore, fence}})
    const identity = await reloaded.provider.restore(new Request(`${rs.url}/alice/p`))
    assert.equal(identity.subject, "alice")
    assert.equal(reloaded.code.calls, 0)
    assert.equal((await reloaded.manager.fetch(`${rs.url}/alice/p`)).status, 200)
    assert.equal(reloaded.code.calls, 0)

    const revoked = op.stats.revoked.length
    await reloaded.manager.logout()
    assert.equal(op.stats.revoked.length, revoked + 1)
    fence.close()
})

test("persistent stores require an explicit namespace and a fence", () => {
    assert.throws(() => solidClient(op, rs, {cache: createMemoryStore()}), /namespace/)
    assert.throws(() => solidClient(op, rs, {provider: {namespace: "x", sessionStore: createMemoryStore()}}), /SessionFence/)
})

test("providers use the pre-registration fetch, so a globally registered reactive fetch cannot deadlock (#21)", async () => {
    const original = globalThis.fetch
    const {manager} = solidClient(op, rs, {http: {allowInsecureRequests: true}})
    manager.registerGlobally()
    try {
        assert.equal((await fetch(`${rs.url}/alice/g`)).status, 200)
    } finally {
        manager.unregisterGlobally()
    }
    assert.equal(globalThis.fetch, original)
})

test("insecure HTTP is refused unless explicitly allowed (#18)", async () => {
    const {manager} = solidClient(op, rs, {http: {fetch: globalThis.fetch}})
    await assert.rejects(manager.fetch(`${rs.url}/alice/h`), /HTTPS/i)
})

test("follow-through #1: a supplied full credential cache needs a shared fence; shared logout reaches it", async () => {
    assert.throws(() => solidClient(op, rs, {cache: createMemoryStore(), provider: {namespace: "app"}}), /SessionFence/)
    const cache = createMemoryStore()
    const [fenceA, fenceB] = sharedFences()
    const a = solidClient(op, rs, {cache, fence: fenceA, provider: {namespace: "app", fence: fenceA}})
    const b = solidClient(op, rs, {cache, fence: fenceB, provider: {namespace: "app", fence: fenceB}})
    assert.equal((await a.manager.fetch(`${rs.url}/alice/shared`)).status, 200)
    assert.equal((await b.manager.fetch(`${rs.url}/alice/shared`)).status, 200)
    assert.equal(b.code.calls, 0, "B used the shared cache")
    await a.manager.logout()
    assert.equal((await b.manager.fetch(`${rs.url}/alice/shared`)).status, 200)
    assert.equal(b.code.calls, 1, "after logout B had to authorize")
    fenceA.close(); fenceB.close()
})
