#!/usr/bin/env node
// Offline wiring check of the browser-SDK adapters — NOT provider validation. It runs the adapters' own
// interaction-required scenarios in a real browser with every non-loopback request intercepted:
// - Google: GIS's script URL is answered with an inert stub (the scenario must not call it before a click);
// - Microsoft: the real bundled @azure/msal-browser, with a placeholder client ID (no account, so MSAL must
//   make no request);
// - the API is a reserved `.invalid` host answered locally with a Bearer 401;
// and checks that the redirect bridge page is served `no-store` without Cross-Origin-Opener-Policy.
// Anything else leaving the machine is aborted and fails the check.
//
//   npm run build && node interop/browser/wiring.js [--browser chromium|firefox|webkit]
import { parseArgs } from "node:util"
import * as playwright from "playwright"
import * as google from "../adapters/google.js"
import * as msal from "../adapters/msal.js"
import { Report, PASS } from "../lib/report.js"
import { runScenarios } from "../lib/scenario.js"
import { startPageServer } from "./server.js"

const {values: args} = parseArgs({options: {browser: {type: "string", default: "chromium"}}})
const gisScript = "https://accounts.google.com/gsi/client"
const api = "https://api.interop.invalid/v1/me"
const gisStub = `window.google = {accounts: {oauth2: {
    initTokenClient() { throw new Error("stub: no token client in the offline wiring check") },
    hasGrantedAllScopes() { return false },
    revoke(_token, done) { done({successful: false, error: "stub"}) },
}}}`

const loopback = new Set(["127.0.0.1", "[::1]", "localhost"])
const blocked = []
const browser = await playwright[args.browser].launch()
const failures = []
try {
    const targets = [
        {
            adapter: google, id: "google-gis-wiring", scenario: "gis.interaction-required", capabilities: {revocation: true},
            config: {origin: "http://localhost:0", clientId: "000000000000-wiring.apps.googleusercontent.com", scopes: ["https://www.googleapis.com/auth/userinfo.email"], api: {url: api, identity: {field: "email", expected: "wiring@example.invalid"}}, login: {recipe: "manual"}},
        },
        {
            adapter: msal, id: "microsoft-msal-wiring", scenario: "msal.interaction-required", capabilities: {silentRenewal: true},
            config: {origin: "http://localhost:0", clientId: "00000000-0000-0000-0000-000000000000", authority: "https://login.microsoftonline.com/organizations", scopes: ["User.Read"], api: {url: api, identity: {field: "userPrincipalName", expected: "wiring@example.invalid"}}, login: {recipe: "manual"}},
        },
    ]
    for (const t of targets) {
        const problems = t.adapter.validate(t.config)
        if (problems.length > 0) throw new Error(`${t.id}: ${problems.join("; ")}`)
        const context = await browser.newContext()
        await context.route("**/*", async route => {
            const url = new URL(route.request().url())
            if (loopback.has(url.hostname)) return route.continue()
            if (url.href === gisScript) return route.fulfill({status: 200, contentType: "text/javascript", body: gisStub})
            if (url.origin === new URL(api).origin) {
                const origin = route.request().headers().origin ?? "*"
                return route.fulfill({status: 401, headers: {"www-authenticate": "Bearer realm=\"wiring\"", "access-control-allow-origin": origin, "access-control-expose-headers": "www-authenticate"}})
            }
            blocked.push(`${t.id}: ${url.origin}`)
            return route.abort()
        })
        const env = {runId: "wiring", browser, live: false, headed: false, capabilities: t.capabilities, context: async () => context}
        const report = new Report({})
        const target = {id: t.id, capabilities: t.capabilities}
        report.target({...target, name: t.id, category: "local", adapter: "wiring", software: {name: "wiring", source: "open"}})
        const all = await t.adapter.scenarios(t.config, env)
        try {
            console.log(t.id)
            const outcome = await runScenarios(report, target, all.filter(s => s.id === t.scenario), {}, {config: t.config, log: console.log})
            if (outcome.get(t.scenario) !== PASS) failures.push(`${t.id} ${t.scenario}`)
        } finally {
            await t.adapter.close(all)
            await context.close()
        }
    }

    // The redirect bridge page: no-store, no COOP (MSAL v5 relies on BroadcastChannel and window handles).
    const server = await startPageServer("http://127.0.0.1:0")
    try {
        const response = await fetch(`${server.origin}/redirect.html`)
        await response.body?.cancel()
        const ok = response.status === 200 && response.headers.get("cache-control") === "no-store" && !response.headers.has("cross-origin-opener-policy")
        console.log(`  ${ok ? "✓" : "x"} redirect.html is served no-store without Cross-Origin-Opener-Policy`)
        if (!ok) failures.push("redirect.html headers")
        const outside = await fetch(`${server.origin}/server.js`)
        await outside.body?.cancel()
        console.log(`  ${outside.status === 404 ? "✓" : "x"} files outside the page allowlist are not served`)
        if (outside.status !== 404) failures.push("page server allowlist")
    } finally {
        await server.close()
    }
} finally {
    await browser.close()
}

if (blocked.length > 0) failures.push(`unexpected requests leaving the machine: ${[...new Set(blocked)].join(", ")}`)
console.log(`\nbrowser: ${args.browser}. This checks page wiring only; it is not Google or Microsoft validation.`)
if (failures.length > 0) {
    console.error(`Wiring check failed:\n- ${failures.join("\n- ")}`)
    process.exit(1)
}
console.log("Wiring check: OK")
