// Tests of the interoperability harness itself (interop/): only what its correctness depends on — no false
// passes, no silent skips, configuration validation, redaction and run/teardown failure semantics. The real
// server and provider tests are run by `npm run interop:*`, not here.
import assert from "node:assert/strict"
import { once } from "node:events"
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { selected } from "../interop/adapters/index.js"
import { createCredential, validate as validateClientCredentials } from "../interop/adapters/clientCredentials.js"
import { oauthScenarios, validateOAuthConfig } from "../interop/adapters/oauth.js"
import { solidScenarios, validateSolidConfig } from "../interop/adapters/solid.js"
import { authorizationFacts, loginRecipes } from "../interop/lib/browserLogin.js"
import { loopbackRedirectProblem } from "../interop/lib/callbackServer.js"
import { CheckError } from "../interop/lib/checkError.js"
import { adapterSpecs, loadManifest, resolveTarget, selectTargets, validateManifest } from "../interop/lib/manifest.js"
import { recordingFetch, schemeName } from "../interop/lib/recorder.js"
import { redact, registerSensitive, safeDescription } from "../interop/lib/redact.js"
import { FAIL, PASS, Report, UNSUPPORTED, UNTESTED } from "../interop/lib/report.js"
import { applyRunConfig } from "../interop/lib/runConfig.js"
import { Cleanups, runSelection } from "../interop/lib/runner.js"
import { applicability, runScenarios } from "../interop/lib/scenario.js"
import { startApi, startOAuthProvider } from "./helpers/oauth.js"
import { automaticCodeProvider } from "./helpers/openid.js"

const manifest = await loadManifest()

function target(overrides = {}) {
    return {
        id: "t", name: "T", category: "local", adapter: "oauth-code", stack: "keycloak",
        software: {name: "X", source: "open"}, env: [], config: {},
        capabilities: {refreshTokens: true, refreshRotation: true, revocation: true, shortLivedTokens: true, audienceRestriction: true},
        ...overrides,
    }
}

test("the committed manifest is valid, and every target lists its adapter's scenarios", () => {
    assert.deepEqual(validateManifest(manifest), [])
    for (const t of manifest.targets) assert.ok(adapterSpecs[t.adapter], t.id)
})

test("manifest validation refuses gaps that could turn into silent coverage", () => {
    const problems = t => validateManifest({schemaVersion: 1, targets: [t]}).join("\n")
    assert.match(problems(target({capabilities: {refreshTokens: true}})), /refreshRotation must be declared/)
    assert.match(problems(target({capabilities: {...target().capabilities, revocation: false}})), /revocation is false without a capabilityNotes reason/)
    assert.match(problems(target({capabilities: {...target().capabilities, revocation: "unverified"}})), /revocation is unverified without a capabilityNotes reason/)
    assert.match(problems(target({capabilities: {...target().capabilities, revocation: "maybe"}})), /must be true, false or "unverified"/)
    assert.match(problems(target({capabilities: {...target().capabilities, invented: true}})), /unknown capability invented/)
    assert.match(problems(target({unsupported: {"oauth.nope": "a reason long enough"}})), /unknown scenario oauth.nope/)
    assert.match(problems(target({unsupported: {"oauth.logout": ""}})), /needs a reason/)
    assert.match(problems(target({category: "live", config: {insecure: true}})), /must not opt in to insecure HTTP/)
    assert.match(problems(target({config: {clientId: "${RA_INTEROP_UNDECLARED}"}})), /undeclared RA_INTEROP_UNDECLARED/)
    assert.match(problems(target({config: {x: "${HOME}"}})), /only RA_INTEROP_ variables/)
})

test("selection rejects unknown suites, unknown targets and empty selections", () => {
    assert.throws(() => selectTargets(manifest, {suite: "nightly"}), /Unknown suite/)
    assert.throws(() => selectTargets(manifest, {suite: "local", ids: ["no-such-target"]}), /Unknown target/)
    assert.throws(() => selectTargets({targets: [target({category: "live"})]}, {suite: "local"}), /matches no targets/)
})

test("missing configuration is reported by variable name and secrets are registered for redaction", () => {
    const t = target({env: [{name: "RA_INTEROP_X_SECRET", description: "secret", secret: true}], config: {clientSecret: "${RA_INTEROP_X_SECRET}"}})
    assert.deepEqual(resolveTarget(t, {}).missing, ["RA_INTEROP_X_SECRET"])
    const resolved = resolveTarget(t, {RA_INTEROP_X_SECRET: "very-secret-value-1"})
    assert.equal(resolved.configured, true)
    assert.equal(redact("error mentioning very-secret-value-1"), "error mentioning [sensitive]")
})

test("an undeclared capability is UNTESTED, a declared false one UNSUPPORTED with its reason", () => {
    const scenario = {id: "oauth.refresh-restore", needs: ["refreshTokens"]}
    assert.equal(applicability(target({capabilities: {}}), scenario).status, UNTESTED)
    const unsupported = applicability(target({capabilities: {refreshTokens: false}, capabilityNotes: {refreshTokens: "the provider issues none"}}), scenario)
    assert.deepEqual(unsupported, {status: UNSUPPORTED, reason: "the provider issues none"})
    assert.equal(applicability(target(), {...scenario, untested: () => "no scratch container"}).status, UNTESTED)
    const unverified = applicability(target({capabilities: {refreshTokens: "unverified"}, capabilityNotes: {refreshTokens: "not observed yet"}}), scenario)
    assert.equal(unverified.status, UNTESTED, "unknown behaviour is never reported as unsupported")
})

test("scenarios: no checks is FAIL; failed prerequisites block; timeouts abort and block what could overlap", async () => {
    const report = new Report({})
    const t = target()
    report.target(t)
    let aborted = false
    const outcome = await runScenarios(report, t, [
        {id: "a", run: async () => {}},
        {id: "b", after: ["a"], run: async ctx => ctx.check(true, "x")},
        {id: "c", run: async ctx => ctx.check(true, "x")},
        {id: "d", timeoutMs: 20, run: ctx => new Promise(resolve => ctx.signal.addEventListener("abort", () => { aborted = true; resolve() }))},
        {id: "e", timeoutMs: 20, run: () => new Promise(() => {})}, // never stops
        {id: "f", run: async ctx => ctx.check(true, "x")},
        {id: "g", always: true, run: async ctx => ctx.check(true, "x")},
    ], {}, {graceMs: 50})
    assert.equal(outcome.get("a"), FAIL)
    assert.match(report.targets[0].scenarios.find(s => s.id === "a").reason, /no checks/)
    assert.equal(outcome.get("b"), FAIL)
    assert.equal(outcome.get("c"), PASS)
    assert.equal(outcome.get("d"), FAIL)
    assert.ok(aborted, "the timed-out scenario's signal was aborted")
    assert.equal(outcome.get("e"), FAIL)
    assert.equal(outcome.get("f"), FAIL, "nothing runs while a timed-out scenario may still be running")
    assert.equal(outcome.get("g"), FAIL, "not even cleanup")
    assert.match(report.targets[0].scenarios.find(s => s.id === "f").reason, /did not stop after its timeout/)
})

test("known incompatibilities: only the declared failure is UNSUPPORTED (with dependents); success, other failures and timeouts FAIL", async () => {
    const known = {reason: "the server omits the nonce claim in ID tokens", signature: "nonce claim missing"}
    const runWith = async login => {
        const report = new Report({})
        const t = target({knownIncompatible: {login: known}})
        report.target(t)
        await runScenarios(report, t, [
            {id: "login", timeoutMs: 30, run: login},
            {id: "read", after: ["login"], run: async ctx => ctx.check(true, "x")},
            {id: "cleanup", after: ["login"], always: true, run: async ctx => ctx.check(true, "x")},
        ], {}, {graceMs: 20})
        return Object.fromEntries(report.targets[0].scenarios.map(s => [s.id, s]))
    }
    const expected = await runWith(async () => { throw new Error("JWT nonce claim missing") })
    assert.equal(expected.login.status, UNSUPPORTED)
    assert.match(expected.login.reason, /verified this run/)
    assert.equal(expected.read.status, UNSUPPORTED)
    assert.equal(expected.cleanup.status, UNSUPPORTED)

    const passed = await runWith(async ctx => ctx.check(true, "x"))
    assert.equal(passed.login.status, FAIL)
    assert.match(passed.login.reason, /did not reproduce/)
    const different = await runWith(async () => { throw new Error("connection refused") })
    assert.equal(different.login.status, FAIL)
    assert.match(different.login.reason, /failed differently/)
    assert.equal(different.read.status, FAIL)
    const timedOut = await runWith(async ctx => new Promise((_, reject) => ctx.signal.addEventListener("abort", () => reject(new Error("nonce claim missing")))))
    assert.equal(timedOut.login.status, FAIL, "a timeout is never taken for the known incompatibility")
    const noChecks = await runWith(async () => {})
    assert.equal(noChecks.login.status, FAIL)

    // A wholly incompatible target still fails strict or required coverage: it proves nothing positive.
    const report = new Report({})
    const t = target({id: "nss", knownIncompatible: {login: known}})
    report.target(t)
    await runScenarios(report, t, [{id: "login", run: async () => { throw new Error("nonce claim missing") }}], {})
    assert.equal(report.verdict().ok, false, "no PASS: nothing about compatibility was verified")
    assert.equal(report.verdict({strict: true}).ok, false)
    assert.equal(report.verdict({required: ["nss"]}).ok, false)
    assert.equal(report.verdict({verifyKnownIncompatible: true}).ok, true, "the explicit incompatibility check is satisfied")

    // An incompatibility that was not reproduced (here: never run) fails --verify-known-incompatible.
    const skipped = new Report({})
    skipped.target(target({id: "nss", knownIncompatible: {login: known}}))
    skipped.record("nss", {id: "login", status: UNTESTED, reason: "not configured"})
    assert.equal(skipped.verdict().ok, false, "an all-UNTESTED run is never OK")
    assert.equal(skipped.verdict({verifyKnownIncompatible: true}).ok, false)
})

test("report verdicts: strict and required coverage, run errors and empty reports all fail", () => {
    const report = new Report({})
    const a = target({id: "a"}), b = target({id: "b"})
    report.target(a)
    report.target(b)
    report.record("a", {id: "x", status: PASS, checks: 1})
    report.record("b", {id: "x", status: UNTESTED, reason: "not configured"})
    assert.equal(report.verdict().ok, true)
    assert.equal(report.verdict({strict: true}).ok, false)
    assert.equal(report.verdict({required: ["b"]}).ok, false)
    assert.equal(report.verdict({required: ["zzz"]}).ok, false)
    assert.throws(() => report.record("a", {id: "y", status: PASS, checks: 0}), /at least one check/)
    assert.throws(() => report.record("a", {id: "z", status: FAIL}), /needs a reason/)
    report.error("teardown failed")
    assert.equal(report.verdict().ok, false)
    assert.equal(new Report({}).verdict().ok, false, "no targets is never green")
})

async function run(targets, {setup, adapter}) {
    const report = new Report({})
    const logs = []
    const cleanups = new Cleanups(report, line => logs.push(line))
    await runSelection({report, targets, adapterFor: () => adapter, setup, cleanups, run: {runId: "r", log: line => logs.push(line)}})
    return report
}

const fakeBrowser = (close = async () => {}) => ({newContext: async () => ({close})})
const oneScenario = target({scenarios: ["oauth.login-api"]})

test("runner: a failed setup fails the run and leaves every selected target UNTESTED", async () => {
    const report = await run([oneScenario, {...oneScenario, id: "u"}], {
        setup: async register => {
            register("stack", async () => { throw new Error("down failed") })
            throw new Error("docker not running")
        },
        adapter: {run: async () => assert.fail("must not run")},
    })
    const json = report.toJSON()
    assert.equal(json.verdict.ok, false)
    assert.match(json.verdict.problems.join(), /setup failed.*docker not running/)
    assert.match(json.verdict.problems.join(), /teardown \(stack\) failed/)
    assert.deepEqual(json.targets.map(t => t.scenarios.map(s => s.status)), [[UNTESTED], [UNTESTED]])
})

test("runner: an adapter that throws after recording PASS still fails the run; others still run", async () => {
    const second = {...oneScenario, id: "second"}
    const report = await run([oneScenario, second], {
        setup: async () => ({browser: fakeBrowser()}),
        adapter: {run: async (report, t) => {
            report.record(t.id, {id: "oauth.login-api", status: PASS, checks: 3})
            if (t.id === "t") throw new Error("close() failed")
        }},
    })
    const json = report.toJSON()
    assert.equal(json.verdict.ok, false)
    assert.match(json.errors.join(), /t: adapter error.*close\(\) failed/)
    assert.equal(json.targets[1].scenarios[0].status, PASS, "the next target still ran")
})

test("runner: a browser context that fails to close is a run error", async () => {
    const report = await run([oneScenario], {
        setup: async () => ({browser: fakeBrowser(async () => { throw new Error("context stuck") })}),
        adapter: {run: async (report, t, config, env) => {
            await env.context()
            report.record(t.id, {id: "oauth.login-api", status: PASS, checks: 1})
        }},
    })
    assert.equal(report.verdict().ok, false)
    assert.match(report.errors.join(), /closing the browser context failed/)
})

test("runner: an adapter that records nothing leaves no scenario unaccounted for", async () => {
    const report = await run([oneScenario], {setup: async () => ({browser: fakeBrowser()}), adapter: {run: async () => {}}})
    assert.equal(report.targets[0].scenarios[0].status, FAIL)
})

test("redaction: credentials, OAuth parameters and emails; live descriptions keep only allowlisted parts", () => {
    registerSensitive("alice-account-name")
    const text = redact("Bearer abcdefghijkl code=xyz&state=s1 eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiJ4In0.sig alice@example.org alice-account-name")
    for (const leak of ["abcdefghijkl", "xyz", "s1", "eyJhbGci", "alice@example.org", "alice-account-name"]) assert.ok(!text.includes(leak), leak)

    const provider = Object.assign(new Error("user alice@example.org denied at https://idp/cb?code=abc"), {code: "EVIL_abc", error: "access_denied", status: 400})
    assert.equal(safeDescription(provider), "Error [access_denied] HTTP 400")
    assert.equal(safeDescription(Object.assign(new Error("x"), {code: "ECONNREFUSED"})), "Error [ECONNREFUSED]")
    assert.equal(safeDescription(Object.assign(new Error("x"), {code: "E_SECRET_VALUE"})), "Error", "unknown codes are dropped")
    assert.equal(safeDescription(Object.assign(new Error("secret message"), {name: "CheckError"})), "Error", "a spoofed CheckError name is not trusted")
    assert.equal(safeDescription(new CheckError("status: expected 200, got 401")), "CheckError: status: expected 200, got 401")
})

test("redirect URIs: loopback http with a port, independent of the server's transport", () => {
    assert.equal(loopbackRedirectProblem("http://127.0.0.1:39398/callback"), undefined)
    assert.equal(loopbackRedirectProblem("http://localhost:8765/cb"), undefined)
    for (const bad of ["https://app.example/cb", "http://example.org:80/cb", "http://127.0.0.1/cb", "http://u:p@127.0.0.1:1/cb", "http://127.0.0.1:1/cb#x", "http://127.0.0.1:1/cb?x=1"]) {
        assert.ok(loopbackRedirectProblem(bad) !== undefined, bad)
    }
})

test("Solid targets: an HTTPS live pod with a loopback callback is valid; unsafe data locations are refused", () => {
    const live = {storage: "https://pod.example/alice/", webId: "https://pod.example/alice/profile/card#me", redirectUri: "http://127.0.0.1:39398/callback", privateResource: "https://pod.example/alice/private/note.txt"}
    assert.deepEqual(validateSolidConfig(live), [])
    assert.deepEqual(validateSolidConfig({...live, scratchContainer: "https://pod.example/alice/tests/"}), [])
    assert.match(validateSolidConfig({...live, storage: "http://pod.example/alice/"}).join(), /storage must be https/)
    assert.match(validateSolidConfig({...live, scratchContainer: "https://pod.example/bob/"}).join(), /inside storage/)
    assert.match(validateSolidConfig({...live, scratchContainer: "https://pod.example/alice/../bob/"}).join(), /inside storage/)
    assert.match(validateSolidConfig({...live, scratchContainer: "https://pod.example/alice/%2e%2e/bob/"}).join(), /inside storage/)
    assert.match(validateSolidConfig({...live, scratchContainer: "https://other.example/alice/"}).join(), /inside storage/)
    assert.match(validateSolidConfig({...live, otherProtected: "https://pod.example/alice/x"}).join(), /outside storage/)
    assert.match(validateSolidConfig({...live, privateResource: undefined}).join(), /scratchContainer .* or privateResource/)
    assert.match(validateSolidConfig({...live, redirectUri: "https://app.example/cb"}).join(), /redirectUri must be http/)
})

test("OAuth targets: exactly one authorization server, loopback callback, HTTPS API", () => {
    const ok = {issuer: "https://idp.example", clientId: "c", scopes: [], redirectUri: "http://127.0.0.1:1/cb", api: {url: "https://api.example/me"}}
    assert.deepEqual(validateOAuthConfig(ok), [])
    assert.match(validateOAuthConfig({...ok, authorizationServer: {}}).join(), /exactly one/)
    assert.match(validateOAuthConfig({...ok, api: {url: "http://api.example/me"}}).join(), /api.url must be https/)
})

test("the live workflow takes one validated configuration secret, runs only on dispatch and requires every target", () => {
    const workflow = readFileSync(new URL("../.github/workflows/interop-live.yml", import.meta.url), "utf8")
    assert.match(workflow, /RA_INTEROP_CONFIG: \$\{\{ secrets\.INTEROP_LIVE_CONFIG \}\}/)
    assert.match(workflow, /--require "\$TARGETS"/)
    assert.doesNotMatch(workflow, /schedule:/, "live tests run only on explicit dispatch")
    assert.doesNotMatch(workflow, /path: .*(tmp|secrets|STORAGE_STATE)/i, "only the sanitized report is uploaded")
})

test("run configuration: only declared RA_INTEROP_ variables; files are private, redacted and removed", () => {
    const declared = new Set(["RA_INTEROP_A_CLIENT_ID", "RA_INTEROP_A_STORAGE_STATE"])
    const environment = {}
    const document = JSON.stringify({variables: {RA_INTEROP_A_CLIENT_ID: "client-value-123"}, files: {RA_INTEROP_A_STORAGE_STATE: {base64: Buffer.from("{\"cookies\":[]}").toString("base64")}}})
    const applied = applyRunConfig(document, declared, environment)
    assert.deepEqual(applied, {...applied, variables: ["RA_INTEROP_A_CLIENT_ID"], files: ["RA_INTEROP_A_STORAGE_STATE"]})
    assert.equal(environment.RA_INTEROP_A_CLIENT_ID, "client-value-123")
    const path = environment.RA_INTEROP_A_STORAGE_STATE
    assert.ok(dirname(path).startsWith(tmpdir()) && /ra-interop-secrets-/.test(dirname(path)), "a fresh directory under the user's temporary directory")
    if (process.platform !== "win32") {
        // POSIX only: Windows has no group/other mode bits; there the per-user temp directory's ACL applies.
        assert.equal(statSync(path).mode & 0o777, 0o600)
        assert.equal(statSync(dirname(path)).mode & 0o777, 0o700)
    }
    assert.equal(readFileSync(path, "utf8"), "{\"cookies\":[]}")
    assert.equal(redact("value client-value-123"), "value [sensitive]")
    applied.cleanup()
    assert.equal(existsSync(path), false)

    const refuse = (doc, pattern) => assert.throws(() => applyRunConfig(JSON.stringify(doc), declared, {}), pattern)
    refuse({variables: {HOME: "/x"}}, /1 name\(s\) that no target declares/)
    refuse({variables: {RA_INTEROP_UNKNOWN: "x"}}, /no target declares/)
    refuse({variables: ["RA_INTEROP_A_CLIENT_ID"]}, /"variables" must be a JSON object/)
    refuse({files: {RA_INTEROP_A_STORAGE_STATE: {base64: "e30=", extra: 1}}}, /base64/)
    // A mistyped key or name that is really a secret value must not be echoed.
    for (const doc of [{"ghp_secretLookingValue123": {}}, {variables: {"ghp_secretLookingValue123": "x"}}, {files: {"eyJhbGciOi.secret": {base64: "e30="}}}]) {
        assert.throws(() => applyRunConfig(JSON.stringify(doc), declared, {}), error => !/ghp_secret|eyJhbGciOi/.test(error.message))
    }
    refuse({variables: {RA_INTEROP_A_CLIENT_ID: ""}}, /non-empty string/)
    refuse({files: {RA_INTEROP_A_STORAGE_STATE: "raw"}}, /base64/)
    refuse({extra: {}}, /unknown top-level key/)
    assert.throws(() => applyRunConfig("{not json", declared, {}), /not valid JSON/)
})

test("runner: a configured storageState file that is missing is a configuration error; a session file enables unattended runs", async () => {
    const live = target({category: "live", stack: undefined, scenarios: ["oauth.login-api"], config: {login: {recipe: "manual"}, storageState: "/nonexistent/ra-interop-session.json"}})
    const missing = await run([live], {setup: async () => ({browser: fakeBrowser()}), adapter: {run: async () => assert.fail("must not run")}})
    assert.equal(missing.verdict().ok, false)
    assert.match(missing.errors.join(), /storageState file does not exist/)
    assert.equal(missing.targets[0].scenarios[0].status, FAIL)

    const noSession = await run([{...live, config: {login: {recipe: "manual"}}}], {setup: async () => ({browser: fakeBrowser()}), adapter: {run: async () => assert.fail("must not run")}})
    assert.match(noSession.targets[0].scenarios[0].reason, /needs --headed/)

    const sessionFile = join(mkdtempSync(join(tmpdir(), "ra-interop-test-")), "state.json")
    writeFileSync(sessionFile, "{}")
    let seen
    await run([{...live, config: {login: {recipe: "manual"}, storageState: sessionFile}}], {
        setup: async () => ({browser: fakeBrowser()}),
        adapter: {run: async (report, t, config, env) => {
            seen = {recipe: config.login.recipe, mode: env.loginMode}
            report.record(t.id, {id: "oauth.login-api", status: PASS, checks: 1})
        }},
    })
    assert.deepEqual(seen, {recipe: "session", mode: "session"})
})

test("login recipe \"session\" never types credentials and fails closed when a login form appears or nothing happens", async () => {
    const page = visible => ({locator: () => ({first: () => ({isVisible: async () => visible})})})
    const never = new Promise(() => {})
    await assert.rejects(loginRecipes.session({label: "x"})(page(true), never), /expired or needs interaction \(a login form is shown\)/)
    await assert.rejects(loginRecipes.session({label: "x", waitMs: 50})(page(false), never), /no redirect within 50 ms/)
    await loginRecipes.session({label: "x"})(page(false), Promise.resolve())
})

test("--exercise-unverified runs scenarios whose capability is unverified and says so in the result", async () => {
    const t = target({capabilities: {refreshTokens: "unverified"}, capabilityNotes: {refreshTokens: "not observed before"}})
    const scenario = {id: "refresh", needs: ["refreshTokens"], run: async ctx => ctx.check(true, "observed")}
    const without = new Report({})
    without.target(t)
    await runScenarios(without, t, [scenario], {})
    assert.equal(without.targets[0].scenarios[0].status, UNTESTED)
    assert.match(without.targets[0].scenarios[0].reason, /--exercise-unverified/)
    const exercised = new Report({})
    exercised.target(t)
    await runScenarios(exercised, t, [scenario], {}, {exerciseUnverified: true})
    assert.equal(exercised.targets[0].scenarios[0].status, PASS)
    assert.equal(exercised.targets[0].scenarios[0].flow.exercisedUnverified, "refreshTokens")
})

test("exercising an unverified capability asserts it: a non-rotating provider FAILS refresh rotation, a rotating one passes", async () => {
    // The real oauth-code adapter against the local mock provider (in-process HTTP), with rotation declared
    // "unverified": without --exercise-unverified rotation is not asserted; with it, the assertion decides.
    const scenariosFor = async ({rotate, exerciseUnverified}) => {
        const provider = await startOAuthProvider({rotate})
        const api = await startApi(provider)
        const capabilities = {refreshTokens: true, refreshRotation: "unverified", revocation: false, shortLivedTokens: false, audienceRestriction: false}
        const t = target({scenarios: ["oauth.login-api", "oauth.refresh-restore"], capabilities,
            capabilityNotes: {refreshRotation: "not observed before", revocation: "none", shortLivedTokens: "no", audienceRestriction: "no"}})
        const codeProvider = () => {
            const code = automaticCodeProvider()
            code.requests = []
            const getCode = code.getCode.bind(code)
            code.getCode = (url, signal) => (code.requests.push(authorizationFacts(url)), getCode(url, signal))
            return code
        }
        const config = {issuer: provider.issuer, clientId: "c", scopes: ["read"], resource: api.url, redirectUri: "https://app.example/oauth/callback", insecure: true, api: {url: `${api.url}/me`}}
        const {scenarios, close} = oauthScenarios(config, {runId: "r", live: false, exerciseUnverified, capabilities, codeProvider})
        const report = new Report({})
        report.target(t)
        try {
            await runScenarios(report, t, selected(t, scenarios), {}, {config, exerciseUnverified})
        } finally {
            await close()
            await api.close()
            await provider.close()
        }
        return report.targets[0].scenarios.find(s => s.id === "oauth.refresh-restore")
    }
    // Restore itself needs only refresh tokens: it runs, but rotation (unverified) is neither asserted nor claimed.
    const notAsserted = await scenariosFor({rotate: false, exerciseUnverified: false})
    assert.equal(notAsserted.status, PASS)
    assert.equal(notAsserted.flow.rotationVerified, false)
    assert.equal(notAsserted.flow.exercisedUnverified, undefined)
    const absent = await scenariosFor({rotate: false, exerciseUnverified: true})
    assert.equal(absent.status, FAIL, "exercised but absent: the rotation assertion fails")
    assert.match(absent.reason, /rotated the refresh token \(values withheld\)/)
    const present = await scenariosFor({rotate: true, exerciseUnverified: true})
    assert.equal(present.status, PASS)
    assert.equal(present.flow.exercisedUnverified, "refreshRotation", "the report says the capability was exercised, not declared")
    assert.equal(present.flow.rotationVerified, true)
})

test("server-supplied challenge schemes are reduced to known names before any message or report", async () => {
    assert.equal(schemeName("dpop"), "DPoP")
    assert.equal(schemeName("UMA"), "UMA")
    assert.equal(schemeName("ghp_secretLookingValue"), "other")
    const recorder = recordingFetch(async () => new Response(null, {status: 401, headers: {"www-authenticate": "eyJhbGciOiJub25lIn0.secret realm=x"}}))
    await recorder.fetch("https://rs.example/x")
    assert.equal(recorder.log[0].challenge, "other")
})

test("client credentials: containment like the Solid adapter; account-based creation only locally; account API stays on the issuer", async () => {
    const base = {issuer: "https://pod.example/", storage: "https://pod.example/alice/", webId: "https://pod.example/alice/profile/card#me",
        scratchContainer: "https://pod.example/alice/tests/", clientId: "id", clientSecret: "secret"}
    assert.deepEqual(validateClientCredentials(base), [])
    for (const [override, pattern] of [
        [{scratchContainer: "https://pod.example/alice-evil/"}, /scratchContainer must be a container inside storage/],
        [{storage: "https://pod.example/alice", scratchContainer: "https://pod.example/alice-evil/"}, /storage must end with \//],
        [{scratchContainer: "https://pod.example/alice/../bob/"}, /scratchContainer must be a container inside storage/],
        [{scratchContainer: "https://pod.example/alice/x/?q=1"}, /scratchContainer must be a container inside storage/],
        [{otherProtected: "https://pod.example/alice/other"}, /otherProtected must be outside storage/],
    ]) assert.match(validateClientCredentials({...base, ...override}).join(), pattern)
    const account = {...base, clientId: undefined, clientSecret: undefined, account: {email: "a@example.test", password: "pw"}}
    assert.deepEqual(validateClientCredentials(account, {live: false}), [])
    assert.match(validateClientCredentials(account, {live: true}).join(), /disposable local targets only/)

    // A control URL on another origin (or a redirect) must never receive the password or the account token.
    const elsewhere = []
    const other = createServer((req, res) => { elsewhere.push(req.url); res.writeHead(200, {"content-type": "application/json"}).end("{}") })
    other.listen(0, "127.0.0.1")
    await once(other, "listening")
    const otherUrl = `http://127.0.0.1:${other.address().port}`
    let mode = "foreign-control"
    const issuer = createServer((req, res) => {
        if (mode === "redirect") return res.writeHead(307, {location: `${otherUrl}/login`}).end()
        res.writeHead(200, {"content-type": "application/json"}).end(JSON.stringify({controls: {password: {login: `${otherUrl}/login`}}}))
    })
    issuer.listen(0, "127.0.0.1")
    await once(issuer, "listening")
    const config = {issuer: `http://127.0.0.1:${issuer.address().port}/`, webId: "http://127.0.0.1/alice#me", account: {email: "a@example.test", password: "local-only"}}
    try {
        await assert.rejects(createCredential(config, "n", AbortSignal.timeout(5_000)), /outside the issuer's origin/)
        mode = "redirect"
        await assert.rejects(createCredential(config, "n", AbortSignal.timeout(5_000)), /redirect, which is not followed/)
        assert.deepEqual(elsewhere, [], "nothing reached the other origin")
    } finally {
        issuer.close()
        other.close()
    }
})

test("adapters implement exactly the scenarios the manifest spec names", () => {
    const env = {runId: "r", capabilities: {}, codeProvider: () => ({})}
    const solid = solidScenarios({storage: "https://p.example/", webId: "https://p.example/#me", redirectUri: "http://127.0.0.1:1/cb", privateResource: "https://p.example/x"}, env)
    assert.deepEqual(selected({adapter: "solid-oidc"}, solid).map(s => s.id), adapterSpecs["solid-oidc"].scenarios)
    const {scenarios} = oauthScenarios({issuer: "https://idp.example", clientId: "c", scopes: [], redirectUri: "http://127.0.0.1:1/cb", api: {url: "https://api.example/me"}}, env)
    assert.deepEqual(selected({adapter: "oauth-code"}, scenarios).map(s => s.id), adapterSpecs["oauth-code"].scenarios)
    assert.throws(() => selected({adapter: "oauth-code"}, scenarios.slice(1)), /differ from the manifest spec/)
})
