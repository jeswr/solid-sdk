import assert from "node:assert/strict"
import { after, before, test } from "node:test"
import {
    ClientCredentialsTokenProvider, ClientIdClientProvider, CredentialBoundary, HintIssuerProvider,
    ReactiveFetchManager, XASProvider, readIssuerHint, resolveStorageContext, sameIssuer,
} from "../dist/mod.js"
import { BridgedCodeProvider, isInteractionReply, isInteractionRequest, shouldIntercept, WindowBridge } from "../dist/service-worker.js"
import { insecure, serve, transport } from "./helpers/http.js"
import { startOpenIdProvider, startSolidStorage, verifyDPoP } from "./helpers/openid.js"

const ports = []

/** A service worker scope with one window client that answers through `respond`. */
function fakeScope(respond) {
    const client = {
        focused: true, visibilityState: "visible", messages: [],
        postMessage(message, [port]) {
            this.messages.push(message)
            ports.push(port)
            port.onmessage = event => { client.cancelled = event.data?.type === "cancel" }
            respond(message, reply => port.postMessage(reply))
        },
    }
    return {client, scope: {clients: {matchAll: async () => [client]}}}
}

test("window bridge: validated request/reply, page errors, malformed replies, timeout and cancellation", async () => {
    const ok = fakeScope((message, reply) => reply({ok: true, value: "https://app.example/cb?code=1&state=s"}))
    const code = await new BridgedCodeProvider(new WindowBridge(ok.scope)).getCode(new URL("https://op.example/authorize?x=1"), new AbortController().signal)
    assert.equal(code.value, "https://app.example/cb?code=1&state=s")
    assert.ok(isInteractionRequest(ok.client.messages[0]))

    const denied = fakeScope((_, reply) => reply({ok: false, name: "CodeRequestCancelledError", message: "cancelled"}))
    await assert.rejects(new WindowBridge(denied.scope).request("code", "https://op.example/a", new AbortController().signal), {name: "CodeRequestCancelledError"})

    const malformed = fakeScope((_, reply) => reply({ok: true, value: "javascript:alert(1)"}))
    await assert.rejects(new WindowBridge(malformed.scope).request("code", "https://op.example/a", new AbortController().signal), /Malformed/)

    const silent = fakeScope(() => {})
    await assert.rejects(new WindowBridge(silent.scope, {timeoutMs: 20}).request("code", "https://op.example/a", new AbortController().signal), /No answer/)
    await new Promise(resolve => setTimeout(resolve, 20))
    assert.equal(silent.client.cancelled, true, "the page is told to cancel")

    const controller = new AbortController()
    const pending = new WindowBridge(fakeScope(() => {}).scope).request("issuer", "https://pod.example/x", controller.signal)
    controller.abort(new Error("user navigated"))
    await assert.rejects(pending, /user navigated/)

    await assert.rejects(new WindowBridge({clients: {matchAll: async () => []}}).request("code", "https://op.example/a", new AbortController().signal), /No window/)
    ports.forEach(port => port.close()) // page-side ports would otherwise keep Node alive
})

test("interaction messages are strictly validated", () => {
    assert.equal(isInteractionRequest({type: "reactive-authentication:request", kind: "code", url: "https://op.example/a"}), true)
    for (const bad of [null, {}, {type: "reactive-authentication:request", kind: "eval", url: "https://a"}, {type: "reactive-authentication:request", kind: "code", url: "file:///etc/passwd"}, {type: "reactive-authentication:request", kind: "code", url: `https://a/${"x".repeat(9000)}`}]) {
        assert.equal(isInteractionRequest(bad), false)
    }
    assert.equal(isInteractionReply({ok: false, name: "E", message: "m"}), true)
    assert.equal(isInteractionReply({ok: false, name: "E", message: "m".repeat(5000)}), false)
})

test("service worker interception is limited to the boundary and skips navigations", () => {
    const boundary = new CredentialBoundary(["https://pod.example/alice/"])
    assert.equal(shouldIntercept(new Request("https://pod.example/alice/x"), {boundary}), true)
    assert.equal(shouldIntercept(new Request("https://cdn.example/lib.js"), {boundary}), false)
    const navigation = {url: "https://pod.example/alice/x", mode: "navigate"}
    assert.equal(shouldIntercept(navigation, {boundary}), false)
    assert.equal(shouldIntercept(navigation, {boundary, navigations: true}), true)
})

test("issuer hints (OIDC third-party initiated login) are used only when accepted, once", async () => {
    const hint = readIssuerHint("https://app.example/?iss=https%3A%2F%2Fop.example&login_hint=alice&target_link_uri=https%3A%2F%2Fapp.example%2Fdoc")
    assert.equal(hint.issuer.href, "https://op.example/")
    assert.equal(hint.loginHint, "alice")
    assert.equal(readIssuerHint("https://app.example/#iss=https%3A%2F%2Fop.example").issuer.href, "https://op.example/")
    assert.equal(readIssuerHint("https://app.example/?iss=javascript:alert(1)").issuer, undefined)

    const fallback = {calls: 0, async getIssuer() { this.calls++; return new URL("https://picked.example/") }}
    const trusted = new HintIssuerProvider(hint, fallback, issuer => issuer.origin === "https://op.example")
    assert.equal((await trusted.getIssuer(new Request("https://pod.example/"))).href, "https://op.example/")
    assert.equal((await trusted.getIssuer(new Request("https://pod.example/"))).href, "https://picked.example/", "hint used once")
    const untrusted = new HintIssuerProvider(readIssuerHint("https://app.example/?iss=https%3A%2F%2Fevil.example"), fallback, issuer => issuer.origin === "https://op.example")
    assert.equal((await untrusted.getIssuer(new Request("https://pod.example/"))).href, "https://picked.example/")
})

test("issuer identifiers compare exactly, except origin-only forms", () => {
    assert.equal(sameIssuer("https://op.example", "https://op.example/"), true)
    assert.equal(sameIssuer("https://op.example/tenant", "https://op.example/tenant/"), false)
    assert.equal(sameIssuer("https://op.example/tenant", "https://op.example/tenant"), true)
    assert.equal(sameIssuer("https://op.example", "https://OP.example"), false)
})

let op
before(async () => { op = await startOpenIdProvider() })
after(async () => { await op.close() })

test("client ID documents must name themselves and list the redirect URI", async () => {
    const docs = await serve((request, {url}) => {
        const path = new URL(request.url).pathname
        if (path === "/good") return Response.json({client_id: `${url}/good`, redirect_uris: ["https://app.example/cb"]})
        if (path === "/wrong-id") return Response.json({client_id: "https://evil.example/id", redirect_uris: ["https://app.example/cb"]})
        return Response.json({client_id: `${url}/no-redirect`, redirect_uris: []})
    })
    try {
        const signal = new AbortController().signal
        assert.equal((await new ClientIdClientProvider(new URL(`${docs.url}/good`), insecure).getClient({}, "https://app.example/cb", signal)).client_id, `${docs.url}/good`)
        await assert.rejects(new ClientIdClientProvider(new URL(`${docs.url}/wrong-id`), insecure).getClient({}, "https://app.example/cb", signal), /does not match/)
        await assert.rejects(new ClientIdClientProvider(new URL(`${docs.url}/no-redirect`), insecure).getClient({}, "https://app.example/cb", signal), /redirect URI/)
        await assert.rejects(new ClientIdClientProvider(new URL(`${docs.url}/good`)).getClient({}, "https://app.example/cb", signal), /HTTPS/)
    } finally {
        await docs.close()
    }
})

test("client credentials grant: DPoP-bound, cached, renewed after rejection", async () => {
    const seen = new Set()
    let grants = 0
    const as = await serve(async (request, {url}) => {
        const path = new URL(request.url).pathname
        if (path === "/.well-known/openid-configuration") return Response.json({issuer: `${url}/`, token_endpoint: `${url}/token`, token_endpoint_auth_methods_supported: ["client_secret_basic"]})
        const form = new URLSearchParams(await request.text())
        assert.equal(form.get("grant_type"), "client_credentials")
        assert.equal(request.headers.get("authorization"), `Basic ${btoa("bot:s3cret")}`)
        await verifyDPoP(request.headers.get("dpop"), {method: "POST", url: `${url}/token`, seen})
        grants++
        return Response.json({access_token: `at-${grants}`, token_type: "DPoP", expires_in: 300})
    })
    const rs = await serve(async request => {
        const auth = request.headers.get("authorization")
        if (auth === `DPoP at-${grants}`) {
            await verifyDPoP(request.headers.get("dpop"), {method: request.method, url: request.url, accessToken: auth.slice(5), seen})
            return new Response("bot ok")
        }
        return new Response(null, {status: 401, headers: {"www-authenticate": 'DPoP algs="ES256"'}})
    })
    try {
        const provider = new ClientCredentialsTokenProvider(new XASProvider({getIssuer: async () => new URL(`${as.url}/`)}, insecure), "bot", "s3cret", {http: insecure})
        const manager = new ReactiveFetchManager({providers: [provider], boundary: new CredentialBoundary([`${rs.url}/`], {allowInsecureHttp: true}), fetch: transport})
        assert.equal(await (await manager.fetch(`${rs.url}/a`)).text(), "bot ok")
        assert.equal(await (await manager.fetch(`${rs.url}/b`)).text(), "bot ok")
        assert.equal(grants, 1)
        grants = 2 // the server now only accepts at-2, which was never issued: at-1 is rejected
        assert.equal(await (await manager.fetch(`${rs.url}/c`)).text(), "bot ok")
        assert.equal(grants, 3, "one new grant after the rejection")
    } finally {
        await rs.close()
        await as.close()
    }
})

test("storage context: only mutually confirmed, same-origin, non-redirected evidence groups resources (#46)", async () => {
    const solidLink = path => `<${path}>; rel="http://www.w3.org/ns/solid/terms#storageDescription"`
    const typed = `<http://www.w3.org/ns/pim/space#Storage>; rel="type"`
    const external = await serve(() => new Response("<https://unused/> a <http://www.w3.org/ns/pim/space#Storage> .", {headers: {"content-type": "text/turtle"}}))
    const server = await serve((request, {url: base}) => {
        const path = new URL(request.url).pathname
        const turtle = body => new Response(body, {headers: {"content-type": "text/turtle"}})
        switch (path) {
            // /alice/ is a storage; /alice/nested/ is another storage inside it.
            case "/alice/": return new Response(null, {status: 401, headers: {link: `${solidLink("/alice/desc")}, ${typed}`}})
            case "/alice/desc": return turtle(`<${base}/alice/> a <http://www.w3.org/ns/pim/space#Storage> .`)
            case "/alice/nested/": return new Response(null, {status: 401, headers: {link: `${solidLink("/alice/nested/desc")}, ${typed}`}})
            // The nested description also claims its parent: the parent does not confirm this description.
            case "/alice/nested/desc": return turtle(`<${base}/alice/> a <http://www.w3.org/ns/pim/space#Storage> . <${base}/alice/nested/> a <http://www.w3.org/ns/pim/space#Storage> .`)
            // A description claiming the whole origin, whose root is not a storage.
            case "/greedy/desc": return turtle(`<${base}/> a <http://www.w3.org/ns/pim/space#Storage> . <${base}/greedy/> a <http://www.w3.org/ns/pim/space#Storage> .`)
            case "/": return new Response("home")
            case "/greedy/": return new Response(null, {status: 401})
            case "/moved": return new Response(null, {status: 302, headers: {location: "/alice/x"}})
        }
        return new Response(null, {status: 401, headers: {link: solidLink("/alice/desc")}})
    })
    const http = insecure
    const at = (path, link, init = {}) => resolveStorageContext(`${server.url}${path}`, new Response(null, {headers: link === undefined ? {} : {link}, ...init}), {http})
    try {
        assert.deepEqual(await at("/alice/x", solidLink(`${server.url}/alice/desc`)),
            {key: `${server.url}/alice/`, root: `${server.url}/alice/`, storage: `${server.url}/alice/`, source: "solid"})
        assert.equal((await at("/alice/nested/x", solidLink(`${server.url}/alice/nested/desc`))).key, `${server.url}/alice/nested/`, "nested storage wins")
        server.requests.length = 0
        // Break the nested root's confirmation: the parent must not absorb the nested resource.
        const nestedOnlyParent = await resolveStorageContext(`${server.url}/alice/nested/y`, new Response(null, {headers: {link: solidLink(`${server.url}/greedy/desc`)}}), {http})
        assert.equal(nestedOnlyParent.source, "exact")
        assert.equal((await at("/greedy/x", solidLink(`${server.url}/greedy/desc`))).source, "exact", "unconfirmed broad and narrow roots")
        assert.equal((await at("/alice/x", solidLink(`${external.url}/desc`))).source, "exact", "external description")
        assert.equal(external.requests.length, 0, "external description not even fetched")
        assert.equal((await at("/alice/x", `<${server.url}/alice/desc>; rel="http://www.w3.org/ns/solid/terms#storageDescription"; anchor="/other"`)).source, "exact", "anchored at another resource")
        const redirected = await transport(`${server.url}/moved`)
        assert.equal((await resolveStorageContext(`${server.url}/moved`, redirected, {http})).source, "exact", "a followed redirect is no evidence for the original URL")
        assert.equal((await resolveStorageContext(`${server.url}/alice/x`, undefined, {http})).key, `${server.url}/alice/x`, "no response: exact URL")
    } finally {
        await server.close()
        await external.close()
    }
})

test("review-3 #2: client credentials forget() during a pending grant prevents caching and attachment", async () => {
    const gate = Promise.withResolvers()
    const started = Promise.withResolvers()
    let grants = 0
    const as = await serve(async (request, {url}) => {
        if (new URL(request.url).pathname === "/.well-known/openid-configuration") return Response.json({issuer: `${url}/`, token_endpoint: `${url}/token`})
        grants++
        started.resolve()
        await gate.promise
        return Response.json({access_token: `at-${grants}`, token_type: "DPoP", expires_in: 300})
    })
    const rs = await serve(request => request.headers.has("authorization") ? new Response("ok") : new Response(null, {status: 401, headers: {"www-authenticate": "DPoP"}}))
    try {
        const provider = new ClientCredentialsTokenProvider(new XASProvider({getIssuer: async () => new URL(`${as.url}/`)}, insecure), "bot", "s", {http: insecure})
        const manager = new ReactiveFetchManager({providers: [provider], boundary: new CredentialBoundary([`${rs.url}/`], {allowInsecureHttp: true}), fetch: transport})
        const pending = manager.fetch(`${rs.url}/x`)
        await started.promise
        await provider.forget()
        gate.resolve()
        await assert.rejects(pending, e => e.name === "SessionSupersededError" || e.name === "AbortError")
        assert.equal(rs.requests.filter(r => r.headers.has("authorization")).length, 0, "no credential attached")
        assert.equal(await (await manager.fetch(`${rs.url}/y`)).text(), "ok")
        assert.equal(grants, 2, "the superseded grant was not cached")
    } finally {
        await rs.close()
        await as.close()
    }
})

test("window bridge routes to the requesting client and rejects when it is gone", async () => {
    const replies = {a: "https://app.example/cb?for=a", b: "https://app.example/cb?for=b"}
    const clients = Object.fromEntries(Object.entries(replies).map(([id, value]) => [id, {id, postMessage(_, [port]) { port.postMessage({ok: true, value}); setTimeout(() => port.close(), 10) }}]))
    const scope = {clients: {get: async id => clients[id], matchAll: async () => Object.values(clients)}}
    const bridge = new WindowBridge(scope)
    const signal = new AbortController().signal
    assert.equal(await bridge.forClient("b").request("code", "https://op.example/a", signal), replies.b)
    assert.equal(await bridge.forClient("a").request("code", "https://op.example/a", signal), replies.a)
    await assert.rejects(bridge.forClient("gone").request("code", "https://op.example/a", signal), /gone/)
})

test("final-check #2: a stale invalidation never removes a renewed client-credentials token; stores need a fence", async () => {
    let grants = 0
    const as = await serve(async (request, {url}) => {
        if (new URL(request.url).pathname === "/.well-known/openid-configuration") return Response.json({issuer: `${url}/`, token_endpoint: `${url}/token`})
        grants++
        return Response.json({access_token: `at-${grants}`, token_type: "DPoP", expires_in: 300})
    })
    const rs = await serve(request => request.headers.has("authorization") ? new Response("ok") : new Response(null, {status: 401, headers: {"www-authenticate": "DPoP"}}))
    try {
        const {createMemoryStore} = await import("@key-value-kit/storage/memory")
        const asProvider = new XASProvider({getIssuer: async () => new URL(`${as.url}/`)}, insecure)
        assert.throws(() => new ClientCredentialsTokenProvider(asProvider, "bot", "s", {namespace: "n", tokenStore: createMemoryStore()}), /SessionFence/)
        const provider = new ClientCredentialsTokenProvider(asProvider, "bot", "s", {http: insecure})
        const manager = new ReactiveFetchManager({providers: [provider], boundary: new CredentialBoundary([`${rs.url}/`], {allowInsecureHttp: true}), fetch: transport})
        await manager.fetch(`${rs.url}/a`)
        const stale = new Request(`${rs.url}/a`, {headers: {authorization: "DPoP at-1"}})
        await provider.invalidate(stale)
        await manager.fetch(`${rs.url}/a`)
        assert.equal(grants, 2)
        await provider.invalidate(stale)
        await manager.fetch(`${rs.url}/a`)
        assert.equal(grants, 2, "no extra grant: the replacement survived the stale invalidation")
        assert.equal(rs.requests.at(-1).headers.get("authorization"), "DPoP at-2")
    } finally {
        await rs.close()
        await as.close()
    }
})

test("issue #5: #autologin/<WebID> hints (raw, encoded, fragments) are parsed strictly", async () => {
    const {readWebIdHint} = await import("../dist/mod.js")
    assert.equal(readWebIdHint("https://app.example/#autologin/https://alice.example/profile/card#me").href, "https://alice.example/profile/card#me")
    assert.equal(readWebIdHint("https://app.example/#autologin/https%3A%2F%2Falice.example%2Fprofile%2Fcard%23me").href, "https://alice.example/profile/card#me")
    for (const bad of [
        "https://app.example/#autologin/", "https://app.example/#autologin/not a url", "https://app.example/#autologin/%E0%A4%A",
        "https://app.example/#autologin/http://alice.example/card#me", "https://app.example/#autologin/javascript:alert(1)",
        "https://app.example/#autologin/https://user:pw@alice.example/card", "https://app.example/#other/https://alice.example/card",
        `https://app.example/#autologin/https://alice.example/${"x".repeat(3000)}`,
    ]) {
        assert.equal(readWebIdHint(bad), undefined, bad)
    }
    assert.equal(readWebIdHint("https://app.example/#autologin/http://localhost:3000/card#me", {allowInsecure: true}).href, "http://localhost:3000/card#me")
})

test("issue #5: a WebID hint is used once, only after approving the WebID and exactly one issuer; otherwise fallback", async () => {
    const {WebIdHintIssuerProvider} = await import("../dist/mod.js")
    const profiles = await serve((request, {url}) => new Response(
        `<${url}/card#me> <http://www.w3.org/ns/solid/terms#oidcIssuer> <https://op.example/>, <https://other-op.example/> .`,
        {headers: {"content-type": "text/turtle"}}))
    try {
        const webId = new URL(`${profiles.url}/card#me`)
        const fallback = {calls: 0, async getIssuer() { this.calls++; return new URL("https://picked.example/") }}
        const rejected = []
        const options = {http: insecure, acceptWebId: id => id.origin === profiles.url, acceptIssuer: issuer => issuer.origin === "https://op.example", onRejected: e => rejected.push(e.message)}

        const provider = new WebIdHintIssuerProvider(webId, fallback, options)
        assert.equal((await provider.getIssuer(new Request("https://pod.example/x"))).href, "https://op.example/")
        assert.equal((await provider.getIssuer(new Request("https://pod.example/x"))).href, "https://picked.example/", "once only")

        const fetched = profiles.requests.length
        const untrusted = new WebIdHintIssuerProvider(webId, fallback, {...options, acceptWebId: () => false})
        assert.equal((await untrusted.getIssuer(new Request("https://pod.example/x"))).href, "https://picked.example/")
        assert.equal(profiles.requests.length, fetched, "unapproved WebID profile is never fetched")

        const ambiguous = new WebIdHintIssuerProvider(webId, fallback, {...options, acceptIssuer: () => true})
        assert.equal((await ambiguous.getIssuer(new Request("https://pod.example/x"))).href, "https://picked.example/")
        const none = new WebIdHintIssuerProvider(new URL(`${profiles.url}/missing#me`), fallback, {...options, acceptIssuer: () => false})
        assert.equal((await none.getIssuer(new Request("https://pod.example/x"))).href, "https://picked.example/")
        assert.equal(rejected.length, 3)
        assert.match(rejected.join("|"), /not accepted/)
        assert.match(rejected.join("|"), /expected exactly one/)
    } finally {
        await profiles.close()
    }
})
