// Offline checks of the live target configurations (hosted Solid census, standard OAuth/OIDC providers, LWS
// deployments, Solid-OIDC + UMA deployments) and of the LWS and Solid UMA adapters' mechanics. No network request leaves this machine: the only server
// used are the repository's mock LWS / UMA / OpenID fixtures on 127.0.0.1, and passing against them is adapter
// self-testing, not interoperability evidence.
import assert from "node:assert/strict"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, before, test } from "node:test"
import { didKeyFromPublicKey } from "../dist/mod.js"
import { selected } from "../interop/adapters/index.js"
import * as lwsAdapter from "../interop/adapters/lws.js"
import * as umaAdapter from "../interop/adapters/uma.js"
import { authorizationFacts } from "../interop/lib/browserLogin.js"
import { validateOAuthConfig } from "../interop/adapters/oauth.js"
import { validateSolidConfig } from "../interop/adapters/solid.js"
import { adapterSpecs, loadManifest, resolveTarget } from "../interop/lib/manifest.js"
import { PASS, Report, UNTESTED } from "../interop/lib/report.js"
import { Cleanups, runSelection } from "../interop/lib/runner.js"
import { runScenarios } from "../interop/lib/scenario.js"
import { startLws } from "./helpers/lws.js"
import { automaticCodeProvider, startOpenIdProvider } from "./helpers/openid.js"
import { startUma } from "./helpers/uma.js"

const manifest = await loadManifest()
const fragments = ["live-oauth.json", "solid-hosted.json", "lws.json", "uma.json"]
const live = manifest.targets.filter(t => fragments.includes(t.fragment))
const byFragment = name => live.filter(t => t.fragment === name)

/** Plausible, non-real values for every variable a target declares (for offline validation only). */
function fakeEnvironment(target) {
    const env = {}
    for (const {name} of target.env) {
        const key = name.replace(/^RA_INTEROP_/, "")
        if (key.endsWith("REDIRECT_URI") || key.endsWith("_LOGIN") || key.endsWith("STORAGE_STATE") || key.endsWith("OTHER_PROTECTED")) continue
        if (key.endsWith("CLIENT_ID") && (target.adapter === "solid-oidc" || target.adapter === "solid-uma")) continue
        if (key.endsWith("AUTHORIZATION_SERVER") || key.endsWith("UMA_SERVER") || key.endsWith("SCRATCH") || key.endsWith("AUDIENCE") || key.endsWith("RESOURCE") && !key.endsWith("PRIVATE_RESOURCE")) continue
        if (key.endsWith("_PROMPT") || key.endsWith("IDENTITY_FIELD") || key.endsWith("EMAIL") || key.endsWith("PASSWORD")) continue
        env[name] =
            key.endsWith("WEBID") ? "https://pod.test.example/alice/profile/card#me"
            : key.endsWith("PRIVATE_RESOURCE") ? `${target.adapter === "lws" ? "https://lws.test.example/root/" : "https://pod.test.example/alice/"}private.txt`
            : key.endsWith("STORAGE") ? (target.adapter === "lws" ? "https://lws.test.example/root/" : "https://pod.test.example/alice/")
            : key === "AUTH0_ISSUER" ? "https://tenant.test.example/"
            : key.endsWith("ISSUER") ? "https://issuer.test.example"
            : key.endsWith("TENANT_ID") ? "00000000-0000-0000-0000-000000000000"
            : key.endsWith("API_URL") || key.endsWith("LOGIN_URL") || key.endsWith("ASSERTION_ENDPOINT") ? "https://api.test.example/me"
            : key === "LWS_CID_ID" ? "https://agent.test.example/id"
            : key === "LWS_CID_KEY_ID" ? "https://agent.test.example/id#key-1"
            : key.endsWith("KEY_FILE") ? "/nonexistent/test-key.jwk"
            : "test-value"
    }
    return env
}

const validators = {"solid-oidc": validateSolidConfig, "oauth-code": validateOAuthConfig, "lws": lwsAdapter.validate, "solid-uma": umaAdapter.validate}

test("live fragments: every target is live, names its software and marks sensitive variables", () => {
    assert.equal(byFragment("live-oauth.json").length, 7)
    assert.equal(byFragment("solid-hosted.json").length, 17)
    assert.equal(byFragment("lws.json").length, 4)
    assert.equal(byFragment("uma.json").length, 2)
    for (const t of live) {
        assert.equal(t.category, "live", t.id)
        assert.doesNotMatch(JSON.stringify(t.config), /"insecure"/, `${t.id} must not opt in to insecure HTTP`)
        assert.ok(t.env.some(e => e.optional !== true), `${t.id} requires configuration, so it is UNTESTED without it`)
        for (const e of t.env) {
            if (/SECRET|PASSWORD|KEY_FILE/.test(e.name)) assert.equal(e.secret, true, `${t.id}: ${e.name} is secret`)
            if (/WEBID|_STORAGE$|SUBJECT|USER_ID|OBJECT_ID|EMAIL|STORAGE_STATE|PRIVATE_RESOURCE|SCRATCH|OTHER_PROTECTED|_CID_ID|_CID_KEY_ID/.test(e.name)) {
                assert.equal(e.pii, true, `${t.id}: ${e.name} identifies the test account`)
            }
        }
        // Accounts, secrets and endpoints come from the environment, never from the committed configuration.
        assert.doesNotMatch(JSON.stringify(t.config), /@[a-z0-9-]+\.[a-z]/i, `${t.id}: no email addresses`)
        if (t.adapter !== "lws") assert.equal(t.config.login?.recipe?.startsWith("${") ? t.config.login.recipe.replace(/^\$\{[A-Z0-9_]+:-(\w+)\}$/, "$1") : t.config.login?.recipe, "manual", `${t.id}: manual sign-in by default`)
    }
})

test("with every variable set, each live target validates, and issuers and APIs are https", () => {
    for (const t of live) {
        const env = fakeEnvironment(t)
        const {configured, missing, config} = resolveTarget(t, env)
        assert.ok(configured, `${t.id}: missing ${missing.join(", ")}`)
        assert.deepEqual(validators[t.adapter](config), [], t.id)
        for (const url of [config.issuer, config.api?.url, config.authorizationServer?.authorization_endpoint, config.authorizationServer?.token_endpoint, config.openid?.issuer]) {
            if (url !== undefined) assert.equal(new URL(url).protocol, "https:", `${t.id}: ${url}`)
        }
        if (t.adapter === "oauth-code") assert.ok(config.scopes.length > 0 && !config.scopes.includes(""), t.id)
    }
})

test("the census records its source commit and has one target per listed provider", () => {
    const census = manifest.census
    assert.match(census.source.commit, /^[0-9a-f]{40}$/)
    assert.equal(census.source.url, "https://solidproject.org/get_a_pod")
    assert.equal(census.providers.length, 15)
    const ids = new Set(live.map(t => t.id))
    for (const p of census.providers) {
        assert.ok(ids.has(p.target), p.listed)
        assert.ok(p.discovery.reachable === false ? p.issuer === null : new URL(p.issuer).protocol === "https:", `${p.listed}: issuer observed or null`)
    }
    // Configurable closed-source deployments besides the census.
    assert.ok(ids.has("ess-live") && ids.has("trinpod-server-live"))
})

test("hosted capabilities follow what was observed: absence only from discovery, unknown behaviour unverified", () => {
    const census = new Map(manifest.census.providers.map(p => [p.target, p]))
    for (const t of byFragment("solid-hosted.json")) {
        const observed = census.get(t.id)?.discovery
        if (t.capabilities.revocation === false) {
            assert.equal(observed?.revocation, false, `${t.id}: revocation false only from a discovery document without it`)
            assert.match(t.capabilityNotes.revocation, /revocation_endpoint/)
        }
        if (t.capabilities.revocation === true) assert.equal(observed?.revocation, true, t.id)
        assert.notEqual(t.capabilities.refreshRotation, false, `${t.id}: rotation is not observable without an account`)
        assert.ok(!Object.values(t.capabilities).includes(true) || observed?.reachable !== false, `${t.id}: nothing is claimed for unreachable providers`)
    }
})

async function runLive(targets, {headed = true, env = {}} = {}) {
    const report = new Report({})
    const logs = []
    const cleanups = new Cleanups(report, line => logs.push(line))
    const browser = {newContext: async () => ({close: async () => {}})}
    await runSelection({
        report, targets, cleanups, setup: async () => ({browser}),
        adapterFor: () => ({run: async () => assert.fail("an unconfigured target must not reach its adapter")}),
        run: {runId: "r", headed, env, log: line => logs.push(line)},
    })
    return report
}

test("missing configuration: every scenario is UNTESTED naming the variables, and requiring the target fails", async () => {
    const report = await runLive(live)
    for (const t of report.targets) {
        const target = live.find(x => x.id === t.id)
        const required = target.env.filter(e => e.optional !== true).map(e => e.name)
        assert.ok(t.scenarios.length > 0)
        for (const s of t.scenarios) {
            assert.equal(s.status, UNTESTED, `${t.id}/${s.id}`)
            for (const name of required) assert.ok(s.reason.includes(name), `${t.id}: reason names ${name}`)
        }
    }
    assert.equal(report.verdict({required: ["github"]}).ok, false)
    assert.equal(report.verdict({strict: true}).ok, false)
})

test("manual sign-in without --headed is UNTESTED even when every variable is set", async () => {
    const targets = live.filter(t => resolveTarget(t, fakeEnvironment(t)).config.login?.recipe === "manual")
    assert.ok(targets.length >= 20)
    const env = Object.assign({}, ...targets.map(fakeEnvironment))
    const report = await runLive(targets, {headed: false, env})
    for (const t of report.targets) for (const s of t.scenarios) assert.match(s.reason, /manual sign-in needs --headed/, t.id)
})

test("LWS adapter: scenario ids match the manifest spec; unsafe configurations are refused before any request", async () => {
    const base = {suite: "did-key", storage: "https://lws.test.example/root/", privateResource: "https://lws.test.example/root/doc", selfIssued: {keyFile: "/k.jwk"}}
    const scenarios = await lwsAdapter.scenarios(base, {runId: "r"})
    assert.deepEqual(selected({adapter: "lws"}, scenarios).map(s => s.id), adapterSpecs.lws.scenarios)
    assert.deepEqual(lwsAdapter.validate(base), [])
    const problems = config => lwsAdapter.validate({...base, ...config}).join("; ")
    assert.match(problems({storage: "http://lws.test.example/root/"}), /storage must be https/)
    assert.match(problems({privateResource: "https://lws.test.example/other/doc"}), /inside storage/)
    assert.match(problems({privateResource: undefined}), /scratchContainer .* or privateResource/)
    assert.match(problems({scratchContainer: "https://lws.test.example/root/../x/"}), /inside storage/)
    assert.match(problems({otherProtected: "https://lws.test.example/root/x"}), /outside storage/)
    assert.match(problems({suite: "bearer"}), /suite must be one of/)
    assert.match(problems({selfIssued: {}}), /keyFile/)
    assert.match(problems({suite: "controlled-identifier", selfIssued: {keyFile: "/k", subject: "https://a.example/id", keyId: "https://b.example/id#k"}}), /keyId/)
    assert.match(problems({suite: "openid", openid: {issuer: "https://op.example"}, redirectUri: "https://app.example/cb"}), /redirectUri/)
    assert.match(problems({suite: "saml", saml: {loginUrl: "https://sp.example/login", assertionEndpoint: "https://sp.example/a"}}), /login.recipe manual/)
    assert.deepEqual(lwsAdapter.validate({...base, authorizationServers: [""]}), [], "an unset trusted-AS variable is ignored")
})

let fixture, directory
before(async () => {
    fixture = await startLws({})
    directory = await mkdtemp(join(tmpdir(), "ra-lws-adapter-"))
})
after(async () => {
    await fixture.close()
    await rm(directory, {recursive: true, force: true})
})

test("LWS adapter mechanics against the repository's mock LWS fixture (self-test, not interoperability)", async () => {
    const keys = await crypto.subtle.generateKey({name: "Ed25519"}, true, ["sign", "verify"])
    const keyFile = join(directory, "agent.jwk")
    await writeFile(keyFile, JSON.stringify(await crypto.subtle.exportKey("jwk", keys.privateKey)), {mode: 0o600})
    const config = {
        suite: "did-key", insecure: true,
        storage: `${fixture.url}/root/`, privateResource: `${fixture.url}/root/doc`, otherProtected: `${fixture.url}/other/doc`,
        expectedSubject: await didKeyFromPublicKey(keys.publicKey),
        selfIssued: {keyFile},
    }
    assert.deepEqual(lwsAdapter.validate(config), [])
    const target = {id: "lws-fixture", adapter: "lws", capabilities: {writes: true}}
    const report = new Report({})
    report.target(target)
    await runScenarios(report, target, await lwsAdapter.scenarios(config, {runId: "t1"}), {}, {config})
    const results = Object.fromEntries(report.targets[0].scenarios.map(s => [s.id, s]))
    assert.equal(results["lws.login-read"].status, PASS, results["lws.login-read"].reason)
    assert.equal(results["lws.boundary"].status, PASS, results["lws.boundary"].reason)
    assert.equal(results["lws.logout"].status, PASS, results["lws.logout"].reason)
    assert.equal(results["lws.write"].status, UNTESTED, "read-only without a scratch container")
    assert.equal(results["lws.cleanup"].status, UNTESTED)
    assert.ok(fixture.stats.accepted.every(a => a.sub === config.expectedSubject))

    // The same adapter refuses a key that is not the configured identity.
    const other = new Report({})
    other.target(target)
    await runScenarios(other, target, await lwsAdapter.scenarios({...config, expectedSubject: "did:key:z6MkNotThisKey"}, {runId: "t2"}), {}, {config})
    assert.equal(other.targets[0].scenarios.find(s => s.id === "lws.login-read").status, "FAIL")
})

test("strict live results are tied to the configured test account: identity variables are required", () => {
    for (const t of byFragment("live-oauth.json")) {
        const identity = t.env.filter(e => /(USER_ID|SUBJECT|OBJECT_ID)$/.test(e.name))
        assert.ok(identity.length === 1 && identity[0].optional !== true && identity[0].pii === true, `${t.id}: the expected identity is required`)
        assert.ok(JSON.stringify(t.config.api.identity.expected).includes(identity[0].name), `${t.id}: the API identity is compared`)
    }
    for (const t of [...byFragment("solid-hosted.json"), ...byFragment("uma.json")]) {
        assert.ok(t.env.some(e => e.name.endsWith("_WEBID") && e.optional !== true && e.pii === true), `${t.id}: the WebID is required`)
    }
    for (const id of ["lws-openid", "lws-did-key"]) {
        assert.ok(live.find(t => t.id === id).env.some(e => e.name.endsWith("_SUBJECT") && e.optional !== true), `${id}: the expected subject is required`)
    }
})

test("every live browser sign-in accepts an optional test-account session file; hosted Solid targets accept a Client ID document", () => {
    const browserLogin = t => t.config.login !== undefined
    for (const t of live.filter(browserLogin)) {
        const state = t.env.find(e => e.name.endsWith("_STORAGE_STATE"))
        assert.ok(state !== undefined && state.optional === true && state.pii === true, `${t.id}: STORAGE_STATE declared (optional, pii)`)
        assert.equal(t.config.storageState, `\${${state.name}}`, `${t.id}: mapped to config.storageState`)
    }
    for (const t of [...byFragment("solid-hosted.json"), ...byFragment("uma.json")]) {
        const prefix = t.env.find(e => e.name.endsWith("_WEBID")).name.replace(/_WEBID$/, "")
        const clientId = t.env.find(e => e.name === `${prefix}_CLIENT_ID`)
        assert.ok(clientId?.optional === true, `${t.id}: optional ${prefix}_CLIENT_ID`)
        assert.equal(t.config.clientId, `\${${clientId.name}}`, t.id)
        const {config} = resolveTarget(t, {...fakeEnvironment(t), [clientId.name]: "https://app.test.example/client.jsonld"})
        assert.equal(config.clientId, "https://app.test.example/client.jsonld", t.id)
        assert.equal(resolveTarget(t, fakeEnvironment(t)).config.clientId, undefined, `${t.id}: dynamic registration by default`)
        assert.ok(t.notes.some(n => n.startsWith("client registration")) || t.fragment === "uma.json", `${t.id}: registration documented`)
    }
    for (const t of live) if (t.config.login !== undefined) assert.ok(t.notes.some(n => n.startsWith("unattended")), `${t.id}: unattended feasibility documented`)
})

test("LWS targets declare automatic storage discovery; Solid UMA targets are never ordinary OAuth", () => {
    for (const t of byFragment("lws.json")) {
        assert.equal(t.capabilities.storageDiscovery, "unverified", t.id)
        assert.match(t.capabilityNotes.storageDiscovery, /lws#storage/)
    }
    for (const t of byFragment("uma.json")) {
        assert.equal(t.adapter, "solid-uma")
        assert.doesNotMatch(`${t.software.name} ${t.name}`, /keycloak/i, t.id)
        assert.ok(t.notes.some(n => /never counts/.test(n)), t.id)
    }
})

test("Solid UMA adapter: scenario ids match the manifest spec; unsafe configurations are refused; challenges are parsed without tickets", async () => {
    const base = {webId: "https://pod.test.example/alice/profile/card#me", storage: "https://pod.test.example/alice/", privateResource: "https://pod.test.example/alice/doc", redirectUri: "http://127.0.0.1:39398/callback"}
    const scenarios = await umaAdapter.scenarios(base, {runId: "r", codeProvider: () => automaticCodeProvider()})
    assert.deepEqual(selected({adapter: "solid-uma"}, scenarios).map(s => s.id), adapterSpecs["solid-uma"].scenarios)
    assert.deepEqual(umaAdapter.validate(base), [])
    const problems = config => umaAdapter.validate({...base, ...config}).join("; ")
    assert.match(problems({storage: "http://pod.test.example/alice/"}), /storage must be https/)
    assert.match(problems({privateResource: "https://pod.test.example/bob/doc"}), /inside storage/)
    assert.match(problems({privateResource: undefined}), /scratchContainer .* or privateResource/)
    assert.match(problems({otherProtected: "https://pod.test.example/alice/x"}), /outside storage/)
    assert.match(problems({umaServers: ["http://uma.test.example"]}), /umaServers\[0\] must be https/)
    assert.match(problems({clientId: "not a url"}), /clientId/)
    assert.match(problems({redirectUri: "https://app.example/cb"}), /redirectUri/)
    assert.deepEqual(umaAdapter.validate({...base, umaServers: [""]}), [], "an unset trusted-UMA variable is ignored")
    assert.deepEqual(umaAdapter.umaChallengeOf('UMA as_uri="https://uma.example", ticket="t1",Bearer,DPoP algs="ES256"'), {asUri: "https://uma.example", ticket: true})
    assert.deepEqual(umaAdapter.umaChallengeOf('DPoP algs="ES256", UMA realm="x", as_uri="https://uma.example", ticket="t"'), {asUri: "https://uma.example", ticket: true})
    assert.equal(umaAdapter.umaChallengeOf('Bearer realm="x"'), undefined)
})

test("Solid UMA adapter mechanics against the repository's mock OP + UMA fixtures (self-test, not interoperability)", async () => {
    // The mock UMA server requires an https WebID; its profile is answered in-process (no request leaves the machine).
    const webId = "https://id.test.example/alice/profile#me"
    const op = await startOpenIdProvider({webId})
    const uma = await startUma(op)
    const realFetch = globalThis.fetch
    globalThis.fetch = async (input, init) => {
        const request = new Request(input, init)
        if (new URL(request.url).origin !== "https://id.test.example") return realFetch(request)
        return new Response(`@prefix solid: <http://www.w3.org/ns/solid/terms#>. <${webId}> solid:oidcIssuer <${op.issuer}>.`, {headers: {"content-type": "text/turtle"}})
    }
    try {
        const config = {
            insecure: true, webId, issuer: op.issuer,
            storage: `${uma.url}/uma/`, privateResource: `${uma.url}/uma/doc`, redirectUri: "http://127.0.0.1:39398/callback",
        }
        assert.deepEqual(umaAdapter.validate(config), [])
        const codeProvider = () => {
            const code = automaticCodeProvider(url => code.requests.push(authorizationFacts(url)))
            code.requests = []
            return code
        }
        const target = {id: "uma-fixture", adapter: "solid-uma", capabilities: {writes: true}}
        const report = new Report({})
        report.target(target)
        await runScenarios(report, target, await umaAdapter.scenarios(config, {runId: "u1", codeProvider}), {}, {config})
        const results = Object.fromEntries(report.targets[0].scenarios.map(s => [s.id, s]))
        for (const id of ["uma.login-read", "uma.private-read", "uma.boundary", "uma.logout"]) assert.equal(results[id].status, PASS, `${id}: ${results[id].reason}`)
        assert.equal(results["uma.write"].status, UNTESTED, "read-only without a scratch container")
        assert.equal(results["uma.cleanup"].status, UNTESTED)
        assert.equal(results["uma.login-read"].flow.rptTokenType, "dpop")
        assert.ok(uma.stats.exchanges.every(e => e.claim_token_format === "http://openid.net/specs/openid-connect-core-1_0.html#IDToken"))
        assert.ok(uma.stats.accepted.every(a => a.webid === webId))
        assert.doesNotMatch(JSON.stringify(report.targets), /eyJ|ticket=|id\.test\.example/, "no tokens, tickets or WebIDs in the report")

        // The same adapter refuses another account's WebID.
        const other = new Report({})
        other.target(target)
        await runScenarios(other, target, await umaAdapter.scenarios({...config, webId: "https://id.test.example/bob/profile#me"}, {runId: "u2", codeProvider}), {}, {config})
        assert.equal(other.targets[0].scenarios.find(s => s.id === "uma.login-read").status, "FAIL")
    } finally {
        globalThis.fetch = realFetch
        await uma.close()
        await op.close()
    }
})

test("LWS adapter: automatic headers-only boundary from the first 401's storage links; no ownership without 201", async () => {
    const keys = await crypto.subtle.generateKey({name: "Ed25519"}, true, ["sign", "verify"])
    const keyFile = join(directory, "agent-2.jwk")
    await writeFile(keyFile, JSON.stringify(await crypto.subtle.exportKey("jwk", keys.privateKey)), {mode: 0o600})
    const config = {
        suite: "did-key", insecure: true,
        storage: `${fixture.url}/root/`, privateResource: `${fixture.url}/root/doc`, otherProtected: `${fixture.url}/other/doc`,
        expectedSubject: await didKeyFromPublicKey(keys.publicKey), selfIssued: {keyFile},
    }
    const target = {id: "lws-fixture", adapter: "lws", capabilities: {writes: true, storageDiscovery: true}}
    const report = new Report({})
    report.target(target)
    await runScenarios(report, target, await lwsAdapter.scenarios(config, {runId: "t3"}), {}, {config})
    const automatic = report.targets[0].scenarios.find(s => s.id === "lws.boundary-automatic")
    assert.equal(automatic.status, PASS, automatic.reason)
    assert.equal(automatic.flow.discoveredVia, "lws")

    // A storage root that is not the configured one is not approved: nothing is disclosed.
    const narrow = new Report({})
    narrow.target(target)
    const elsewhere = {...config, storage: `${fixture.url}/root/sub/`, privateResource: `${fixture.url}/root/sub/doc`}
    await runScenarios(narrow, target, (await lwsAdapter.scenarios(elsewhere, {runId: "t4"})).filter(s => s.id === "lws.boundary-automatic"), {}, {config: elsewhere})
    assert.equal(narrow.targets[0].scenarios[0].status, "FAIL")

    // The mock storage answers 200 (not 201) to a create-only PUT: not recorded as owned, and nothing is deleted.
    const writes = new Report({})
    writes.target(target)
    const scratch = {...config, scratchContainer: `${fixture.url}/root/scratch/`, privateResource: undefined}
    await runScenarios(writes, target, await lwsAdapter.scenarios(scratch, {runId: "t5"}), {}, {config: scratch})
    const results = Object.fromEntries(writes.targets[0].scenarios.map(s => [s.id, s]))
    assert.equal(results["lws.login-read"].status, "FAIL")
    assert.match(results["lws.login-read"].reason, /not 201 Created.*not recorded as run-owned/)
    assert.equal(results["lws.cleanup"].status, "FAIL")
    assert.match(results["lws.cleanup"].reason, /created nothing/)
})

test("LWS SAML: assertion requests are bounded, cancelled with the scenario signal and release their bodies", async () => {
    const config = {saml: {loginUrl: "https://sp.test.example/login", assertionEndpoint: "https://sp.test.example/assertion"}}
    const calls = []
    let disposed = 0
    let release
    const context = {
        request: {
            get: (url, options) => {
                calls.push(options)
                return new Promise(resolve => { release = () => resolve({status: () => 200, headers: () => ({}), json: async () => ({}), dispose: async () => { disposed++ }}) })
            },
        },
        newPage: async () => assert.fail("a non-interactive run must not open a sign-in page"),
    }
    const obtain = lwsAdapter.samlObtainer(config, {context: async () => context, headed: false}, {requestTimeoutMs: 1_000})
    const controller = new AbortController()
    const pending = obtain({authorizationServer: new URL("https://as.test.example/"), signal: controller.signal})
    await new Promise(resolve => setImmediate(resolve))
    controller.abort(new Error("scenario timed out"))
    await assert.rejects(pending, /scenario timed out/)
    assert.equal(calls[0].timeout, 1_000, "every assertion request has a timeout")
    release()
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(disposed, 1, "the late response is disposed")

    // Stored-session mode without an assertion fails closed (no sign-in page) and disposes the response.
    const stale = {request: {get: async () => ({status: () => 302, headers: () => ({}), dispose: async () => { disposed++ }})}, newPage: context.newPage}
    const closed = lwsAdapter.samlObtainer(config, {context: async () => stale, headed: false})
    await assert.rejects(closed({authorizationServer: new URL("https://as.test.example/"), signal: new AbortController().signal}), /non-interactive runs never sign in/)
    assert.equal(disposed, 2)
})
