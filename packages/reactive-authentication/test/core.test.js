import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { test } from "node:test"
import { createMemoryStore } from "@key-value-kit/storage/memory"
import {
    CredentialBoundary, ReactiveAuthenticationClient, ReactiveAuthenticationError, ReactiveFetchManager,
    SessionFence, SessionSupersededError, isWithin, parseChallenges,
} from "../dist/mod.js"
import { serve, transport } from "./helpers/http.js"

/** A provider that attaches a fixed bearer token and records its calls. */
function tokenProvider(token = "t0k3n") {
    return {
        upgrades: 0, invalidations: 0,
        async matches() { return true },
        async upgrade(request) {
            this.upgrades++
            const headers = new Headers(request.headers)
            headers.set("Authorization", `Bearer ${token}`)
            return new Request(request, {headers})
        },
        async invalidate() { this.invalidations++ },
    }
}

const boundaryFor = (...entries) => new CredentialBoundary(entries, {allowInsecureHttp: true})
const unauthorized = (headers = {}) => new Response("no", {status: 401, headers: {"www-authenticate": "Bearer", ...headers}})

test("challenge parsing: parameters, token68, several challenges", () => {
    assert.deepEqual(parseChallenges('Bearer as_uri="https://as.example", realm="https://s.example/1", error="invalid_token"'), [
        {scheme: "bearer", params: Object.assign(Object.create(null), {as_uri: "https://as.example", realm: "https://s.example/1", error: "invalid_token"})},
    ])
    const many = parseChallenges('Basic dGVzdA==, DPoP algs="ES256 PS256", UMA as_uri="https://a", ticket=abc')
    assert.deepEqual(many.map(c => c.scheme), ["basic", "dpop", "uma"])
    assert.equal(many[0].token68, "dGVzdA==")
    assert.equal(many[1].params.algs, "ES256 PS256")
    assert.equal(many[2].params.ticket, "abc")
    assert.equal(parseChallenges('Bearer realm="a\\"b"')[0].params.realm, 'a"b')
    assert.deepEqual(parseChallenges(null), [])
})

test("challenge parsing fails closed: duplicate parameters drop the challenge, malformed input stops parsing", () => {
    const duplicate = parseChallenges('Bearer as_uri="https://good", as_uri="https://evil", DPoP algs="ES256"')
    assert.deepEqual(duplicate.map(c => c.scheme), ["dpop"])
    const casing = parseChallenges('Bearer REALM="a", realm="b"')
    assert.deepEqual(casing, [])
    const malformed = parseChallenges('DPoP algs="ES256", Bearer realm="unterminated')
    assert.deepEqual(malformed.map(c => c.scheme), ["dpop"])
    assert.deepEqual(parseChallenges('Bearer realm="a" as_uri="b"'), [])
})

test("path containment and the credential boundary reject look-alikes and encoded traversal", () => {
    assert.ok(isWithin("https://h.example/alice/x", "https://h.example/alice/"))
    assert.ok(isWithin("https://h.example/alice/x", "https://h.example/alice"))
    for (const url of [
        "https://h.example/alice-evil/x", "https://h.example.attacker.test/alice/x", "http://h.example/alice/x",
        "https://h.example:444/alice/x", "https://h.example/alice/%2e%2e%2fsecret", "https://h.example/alice/..%2Fsecret",
        "https://h.example/alice/%5c..%5csecret", "https://user:pw@h.example/alice/x", "ftp://h.example/alice/x",
    ]) {
        assert.equal(isWithin(url, "https://h.example/alice/"), false, url)
    }
    // Literal dot segments and backslashes are normalized by URL parsing before comparison.
    assert.equal(isWithin("https://h.example/alice/../bob/x", "https://h.example/alice/"), false)
    assert.equal(isWithin("https://h.example/alice\\..\\bob", "https://h.example/alice/"), false)

    const boundary = new CredentialBoundary(["https://h.example/alice/", "https://h.example/profile/card"])
    assert.ok(boundary.allows("https://h.example/alice/deep/x?y=1"))
    assert.ok(boundary.allows("https://h.example/profile/card?x#me"))
    assert.equal(boundary.allows("https://h.example/profile/card/other"), false)
    assert.equal(boundary.allows("https://h.example/alice/%2E%2E/profile"), false)
    assert.throws(() => boundary.add("http://h.example/"), /insecure/)
    assert.throws(() => boundary.add("https://h.example/a%2fb/"), /encoded/)
    boundary.add("https://other.example/")
    assert.ok(boundary.allows("https://other.example/x"))
    boundary.delete("https://other.example/")
    assert.equal(boundary.allows("https://other.example/x"), false)
})

test("redirects of credentialed requests: caller credentials never cross origins; POST→GET drops body headers", async () => {
    const other = await serve(() => new Response("other"))
    const origin = await serve(request => {
        const url = new URL(request.url)
        // Only this library's credential counts; caller headers on the unauthenticated attempt are the caller's own.
        if (!request.headers.get("authorization")?.startsWith("Bearer ")) return unauthorized()
        if (url.pathname === "/alice/cross") return new Response(null, {status: 307, headers: {location: `${other.url}/landing`}})
        if (url.pathname === "/alice/see-other") return new Response(null, {status: 303, headers: {location: "/alice/result"}})
        return new Response(`ok ${request.method} ${request.headers.get("content-type")}`)
    })
    try {
        const provider = tokenProvider()
        const client = new ReactiveAuthenticationClient({providers: [provider], boundary: boundaryFor(`${origin.url}/alice/`), fetch: transport})
        const init = {method: "POST", body: "payload", headers: {"content-type": "text/plain", cookie: "session=1", authorization: "Basic caller", dpop: "stale-proof"}}

        assert.equal(await (await client.fetch(`${origin.url}/alice/cross`, init)).text(), "other")
        const landed = other.requests.at(-1)
        for (const header of ["authorization", "cookie", "dpop"]) assert.equal(landed.headers.get(header), null, header)
        assert.equal(await landed.text(), "payload", "307 keeps method and body")

        const result = await client.fetch(`${origin.url}/alice/see-other`, init)
        assert.equal(await result.text(), "ok GET null")
        const final = origin.requests.at(-1)
        assert.equal(final.method, "GET")
        assert.equal(final.headers.get("dpop"), null, "caller DPoP proof dropped on URL change")
        assert.equal(final.headers.get("authorization"), "Bearer t0k3n", "re-upgraded for the same-origin destination")
    } finally {
        await other.close()
        await origin.close()
    }
})

test("browser opaque redirects after an authenticated write are returned, never replayed; error mode rejects", async () => {
    let writes = 0
    const fetch = async request => {
        if (!request.headers.has("authorization")) return unauthorized()
        writes++
        const response = new Response(null, {status: 200})
        Object.defineProperty(response, "type", {value: "opaqueredirect"})
        return response
    }
    const client = new ReactiveAuthenticationClient({providers: [tokenProvider()], boundary: boundaryFor("https://s.example/"), fetch})
    const response = await client.fetch("https://s.example/x", {method: "POST", body: "once"})
    assert.equal(response.type, "opaqueredirect")
    assert.equal(writes, 1)
    await assert.rejects(client.fetch("https://s.example/x", {method: "POST", body: "once", redirect: "error"}), TypeError)
    assert.equal(writes, 2)
})

test("bounded retries: one nonce retry and one renewal, then the 401 is returned", async () => {
    let attempts = 0
    const fetch = async request => {
        if (request.headers.has("authorization")) attempts++
        return unauthorized({"www-authenticate": 'DPoP error="use_dpop_nonce"', "dpop-nonce": "n"})
    }
    const provider = tokenProvider()
    const client = new ReactiveAuthenticationClient({providers: [provider], boundary: boundaryFor("https://s.example/"), fetch})
    assert.equal((await client.fetch("https://s.example/x")).status, 401)
    assert.equal(attempts, 3)
    assert.equal(provider.invalidations, 1)
})

test("requests outside the boundary are passed through natively: no upgrade, no buffering", async () => {
    let seen
    const fetch = async request => { seen = request; return unauthorized() }
    const provider = tokenProvider()
    const client = new ReactiveAuthenticationClient({providers: [provider], boundary: boundaryFor("https://s.example/"), fetch})
    const body = new ReadableStream({pull(controller) { controller.enqueue(new Uint8Array(1)); controller.close() }})
    const response = await client.fetch("https://elsewhere.example/x", {method: "POST", body, duplex: "half"})
    assert.equal(response.status, 401)
    assert.equal(provider.upgrades, 0)
    assert.equal(seen.body !== null && !seen.bodyUsed, true)
})

test("replay buffering honours abort for never-ending bodies and enforces its size bound", async () => {
    const client = new ReactiveAuthenticationClient({providers: [tokenProvider()], boundary: boundaryFor("https://s.example/"), fetch: async () => new Response("ok"), maxReplayBodyBytes: 8})
    const controller = new AbortController()
    let cancelled = false
    const endless = new ReadableStream({
        pull: c => new Promise(resolve => setTimeout(() => { if (!cancelled) c.enqueue(new Uint8Array(1)); resolve() }, 5)),
        cancel() { cancelled = true },
    })
    const pending = client.fetch("https://s.example/x", {method: "PUT", body: endless, duplex: "half", signal: controller.signal, headers: {"content-length": "1"}})
    setTimeout(() => controller.abort(new Error("stop")), 20)
    await assert.rejects(pending, /stop/)
    assert.ok(cancelled, "the body stream was cancelled")

    const big = new ReadableStream({start(c) { c.enqueue(new Uint8Array(16)); c.close() }})
    await assert.rejects(client.fetch("https://s.example/x", {method: "PUT", body: big, duplex: "half"}), ReactiveAuthenticationError)
})

/**
 * Runs `body` as in a runtime without request body streams: Firefox does not implement `Request.prototype.body`
 * (it reads `undefined`), while `blob()` and friends work. Restores the real getter afterwards.
 */
async function withoutRequestBodyStreams(body) {
    const original = Object.getOwnPropertyDescriptor(Request.prototype, "body")
    Object.defineProperty(Request.prototype, "body", {configurable: true, get: () => undefined})
    try {
        assert.equal(new Request("https://s.example/", {method: "PUT", body: "x"}).body, undefined)
        return await body()
    } finally {
        Object.defineProperty(Request.prototype, "body", original)
    }
}

test("without request body streams (Firefox), challenged writes replay their body with its type, size bound and abort", () => withoutRequestBodyStreams(async () => {
    const seen = []
    const fetch = async request => {
        seen.push({method: request.method, auth: request.headers.get("authorization"), type: request.headers.get("content-type"), text: await request.text()})
        return request.headers.has("authorization") ? new Response("ok") : unauthorized()
    }
    const client = new ReactiveAuthenticationClient({providers: [tokenProvider()], boundary: boundaryFor("https://s.example/"), fetch, maxReplayBodyBytes: 8})

    const put = await client.fetch("https://s.example/x", {method: "PUT", body: "replayed", headers: {"content-type": "text/plain"}})
    assert.equal(put.status, 200)
    assert.deepEqual(seen.map(s => [s.method, s.auth, s.type, s.text]), [["PUT", null, "text/plain", "replayed"], ["PUT", "Bearer t0k3n", "text/plain", "replayed"]])

    seen.length = 0
    const bytes = await client.fetch("https://s.example/b", {method: "POST", body: new Uint8Array([1, 2, 3])})
    assert.equal(bytes.status, 200)
    assert.equal(seen.at(-1).text, "\u0001\u0002\u0003", "binary bodies replay byte for byte")

    seen.length = 0
    assert.equal((await client.fetch("https://s.example/get")).status, 200)
    assert.equal((await client.fetch("https://s.example/empty", {method: "PUT", body: ""})).status, 200)
    assert.deepEqual(seen.map(s => s.text), ["", "", "", ""], "no body, and an empty body, replay as no body")

    seen.length = 0
    await assert.rejects(client.fetch("https://s.example/big", {method: "PUT", body: "123456789"}), ReactiveAuthenticationError)
    const controller = new AbortController()
    controller.abort(new Error("stop"))
    await assert.rejects(client.fetch("https://s.example/x", {method: "PUT", body: "a", signal: controller.signal}), /stop/)
    assert.equal(seen.length, 0, "an oversized or aborted body is never sent")
}))

test("without request body streams, logout while the body is being read prevents any upgrade", () => withoutRequestBodyStreams(async () => {
    const gate = Promise.withResolvers()
    const reading = Promise.withResolvers()
    const blob = Request.prototype.blob
    Request.prototype.blob = function () {
        reading.resolve()
        return gate.promise.then(() => blob.call(this))
    }
    try {
        const provider = tokenProvider()
        let sent = 0
        const manager = new ReactiveFetchManager({providers: [provider], boundary: boundaryFor("https://s.example/"), fetch: async () => (sent++, unauthorized())})
        const pending = manager.fetch("https://s.example/x", {method: "PUT", body: "late"})
        await reading.promise
        await manager.logout()
        gate.resolve()
        await assert.rejects(pending, SessionSupersededError)
        assert.equal(sent, 0)
        assert.equal(provider.upgrades, 0)
    } finally {
        Request.prototype.blob = blob
    }
}))

test("logout while the initial fetch, provider matching or body buffering is pending prevents any upgrade", async () => {
    for (const phase of ["fetch", "matches", "body"]) {
        const gate = Promise.withResolvers()
        const started = Promise.withResolvers()
        const provider = tokenProvider()
        const fetch = async () => {
            if (phase === "fetch") { started.resolve(); await gate.promise }
            return unauthorized()
        }
        if (phase === "matches") provider.matches = async () => { started.resolve(); await gate.promise; return true }
        const manager = new ReactiveFetchManager({providers: [provider], boundary: boundaryFor("https://s.example/"), fetch})
        const body = phase === "body"
            ? new ReadableStream({async pull(c) { started.resolve(); await gate.promise; c.close() }})
            : undefined
        const pending = manager.fetch("https://s.example/x", body ? {method: "PUT", body, duplex: "half"} : {})
        await started.promise
        await manager.logout()
        gate.resolve()
        await assert.rejects(pending, SessionSupersededError, phase)
        assert.equal(provider.upgrades, 0, phase)
    }
})

test("a fence keeps its captured signal: logout aborts fetches started before it, later fetches proceed", async () => {
    const store = createMemoryStore()
    const fence = new SessionFence("ns", {store})
    const other = new SessionFence("ns", {store})
    const generation = await fence.generation()
    await other.supersede()
    await assert.rejects(fence.commit(generation, async () => "late"), SessionSupersededError)
    assert.equal(await fence.commit(await fence.generation(), async () => "fresh"), "fresh")
    // The broadcast from `other` aborted `fence`'s signal of the time.
    await new Promise(r => setTimeout(r, 20))
    fence.close(); other.close()
})

test("SessionFence's BroadcastChannel does not keep Node.js alive, and close() is idempotent", () => {
    const script = `import("./dist/SessionFence.js").then(({SessionFence}) => { const f = new SessionFence("x"); globalThis.f = f })`
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {timeout: 5000, cwd: process.cwd()})
    assert.equal(result.status, 0, String(result.stderr))
    assert.equal(result.signal, null, "process exited on its own")
    const fence = new SessionFence("y")
    fence.close()
    fence.close()
})

test("registerGlobally is reversible and upgrades requests through the global fetch", async () => {
    const original = globalThis.fetch
    const server = await serve(request => request.headers.has("authorization") ? new Response("in") : unauthorized())
    try {
        const manager = new ReactiveFetchManager({providers: [tokenProvider()], boundary: boundaryFor(`${server.url}/`), fetch: transport})
        manager.registerGlobally()
        assert.equal(await (await fetch(`${server.url}/x`)).text(), "in")
        manager.unregisterGlobally()
        assert.equal(globalThis.fetch, original)
    } finally {
        globalThis.fetch = original
        await server.close()
    }
})

test("the main entry point imports without DOM globals", async () => {
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", `const m = await import("./dist/mod.js"); if (!m.ReactiveFetchManager) process.exit(1)`], {timeout: 5000})
    assert.equal(result.status, 0, String(result.stderr))
})
