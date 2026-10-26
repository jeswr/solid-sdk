// Solid-OIDC with the library executing IN A REAL BROWSER (Chromium, Firefox or WebKit — the runner's --browser):
// interop/runtime/solid.html bundles the built library with <authorization-code-flow>; the page performs WebID →
// issuer discovery, dynamic registration, the popup authorization code flow with PKCE, DPoP-bound requests and
// logout itself. Playwright only acts as the user in the provider's popup (login recipe) and reads back safe
// results (statuses, booleans, counts). Contrast with the solid-oidc adapter, where the library runs in Node.
//
// Ownership: every 201 Created is reported to Node at once (page binding), so cleanup knows exactly what this run
// created even after a partial failure or a closed page, and deletes only that, children first.
// Cancellation: a step that is aborted (scenario timeout) closes its page and popups before the step settles;
// the next step starts on a fresh page (a new application instance in the same browser session).
import { build } from "esbuild"
import { readFile } from "node:fs/promises"
import { createServer } from "node:http"
import { once } from "node:events"
import { fileURLToPath } from "node:url"
import { loginRecipes } from "../lib/browserLogin.js"
import { validateSolidConfig } from "./solid.js"

const root = fileURLToPath(new URL("../../", import.meta.url))
const runtime = fileURLToPath(new URL("../runtime/", import.meta.url))
const files = {"/solid.html": ["solid.html", "text/html"], "/callback.html": ["callback.html", "text/html"], "/.bundle/page.js": [".bundle/page.js", "text/javascript"]}

/**
 * @param {object} config Solid target configuration plus `appPort` (the page's loopback origin; the redirect URI
 *   is derived from it, so `redirectUri` is not used) — writes need `scratchContainer`
 */
export function validate(config) {
    const problems = validateSolidConfig({...config, redirectUri: `http://localhost:${config.appPort}/callback.html`})
    if (config.scratchContainer === undefined) problems.push("the browser run needs a scratchContainer (it writes and cleans up its own data)")
    if (!Number.isInteger(Number(config.appPort))) problems.push("appPort must be a port number")
    return problems
}

export async function serve(port) {
    await build({entryPoints: {page: "test/browser/page-entry.js"}, bundle: true, format: "iife", globalName: "RA", outdir: `${runtime}.bundle`, platform: "browser", absWorkingDir: root, logLevel: "warning"})
    const server = createServer(async (req, res) => {
        const file = files[new URL(req.url, "http://localhost").pathname]
        if (file === undefined) return res.writeHead(404).end()
        res.writeHead(200, {"content-type": file[1], "cache-control": "no-store"}).end(await readFile(`${runtime}${file[0]}`))
    })
    server.listen(Number(port), "localhost")
    await once(server, "listening")
    return server
}

export async function closeServer(server) {
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
}

/**
 * Pages for one target: the current page, created on demand, and closed (with its popups) on abort.
 * `owned` collects every URL a page reported as created (201).
 */
export function pages({context, url, login, owned}) {
    let current
    const popups = new Set()
    const open = async () => {
        const page = await context.newPage()
        await page.exposeFunction("__owned", created => { owned.add(created) })
        page.on("popup", popup => {
            popups.add(popup)
            const done = new Promise(resolve => popup.once("close", () => { popups.delete(popup); resolve() }))
            login(popup, done).catch(() => {})
        })
        await page.goto(url)
        await page.waitForFunction(() => window.__ready === true)
        return page
    }
    const discard = async () => {
        const page = current
        current = undefined
        await Promise.all([...popups].map(p => p.close().catch(() => {})))
        await page?.then(p => p.close(), () => {}).catch(() => {})
    }
    return {
        /**
         * Runs a page step bound to `signal`: on abort, the page and its popups are closed before this settles.
         * When window.open is blocked, the page's "open" button is clicked (the user's gesture).
         */
        async step(signal, name, argument) {
            signal.throwIfAborted()
            // Resolves at once if the signal is already aborted (a listener added later would never fire).
            const aborted = new Promise(resolve => signal.aborted ? resolve() : signal.addEventListener("abort", resolve, {once: true}))
            current ??= open()
            const opened = await Promise.race([current.then(page => ({page})), aborted.then(() => ({aborted: true}))])
            if (opened.aborted) {
                await discard()
                throw signal.reason ?? new Error("aborted")
            }
            const page = opened.page
            const result = page.evaluate(([step, value]) => window.step(step, value), [name, argument])
            result.catch(() => {})
            const opener = page.locator("authorization-code-flow button[value=open]")
            let settled = false
            const clicking = (async () => {
                while (!settled) {
                    if (await opener.isVisible().catch(() => false)) await opener.click().catch(() => {})
                    await Promise.race([result.catch(() => {}), aborted, new Promise(resolve => setTimeout(resolve, 250))])
                }
            })()
            try {
                const outcome = await Promise.race([result.then(value => ({value})), aborted.then(() => ({aborted: true}))])
                if (outcome.aborted) {
                    await discard() // unwinds the in-page operation: nothing it does can affect later steps
                    throw signal.reason ?? new Error("aborted")
                }
                return outcome.value
            } finally {
                settled = true
                await clicking
            }
        },
        discard,
        get popups() { return popups.size },
    }
}

export async function scenarios(config, env) {
    const server = await serve(config.appPort)
    let harness
    try {
        const context = await env.context()
        const {recipe, ...parameters} = config.login
        const login = loginRecipes[recipe]({label: config.label, ...parameters})
        const owned = new Set()
        const query = new URLSearchParams({storage: config.storage, webId: config.webId, scratch: config.scratchContainer, run: env.runId, insecure: String(config.insecure === true),
            ...(config.otherProtected === undefined ? {} : {otherProtected: config.otherProtected})})
        harness = pages({context, url: `http://localhost:${config.appPort}/solid.html?${query}`, login, owned})
        const engine = {execution: "browser", engine: env.browser.browserType().name(), engineVersion: env.browser.version()}

        const step = async (ctx, name, argument) => {
            const value = await harness.step(ctx.signal, name, argument)
            ctx.note(engine)
            if (value?.error !== undefined) throw new Error(`the page step ${name} failed (${["TypeError", "AbortError", "SessionSupersededError", "ReactiveAuthenticationError"].includes(value.error) ? value.error : "Error"})`)
            return value
        }

        const list = [
            {
                id: "browser.login-write",
                async run(ctx) {
                    const r = await step(ctx, "login-write")
                    ctx.equal(r.made, 201, "the page created its run-owned container (If-None-Match: *)")
                    ctx.equal(r.created, 201, "the page created its resource")
                    ctx.check(r.firstUnauthenticated, "the first attempt was sent without credentials and challenged with 401")
                    ctx.equal(r.replayScheme, "DPoP", "the replayed write used the DPoP scheme")
                    ctx.check(r.replayDpop, "the replayed write carried a DPoP proof made in the browser (WebCrypto)")
                    ctx.check(r.flows >= 1 && r.flows <= 2, `popup authorization flows: ${r.flows}`)
                    ctx.check(r.webIdMatches && r.webIdVerified, "the ID token's WebID is the configured one and its profile lists the issuer")
                },
            },
            {
                id: "browser.private-read",
                after: ["browser.login-write"],
                async run(ctx) {
                    const r = await step(ctx, "private-read")
                    ctx.check(r.anonymous === 401 || r.anonymous === 403, `the resource is private (unauthenticated GET answered ${r.anonymous})`)
                    ctx.equal(r.status, 200, "authenticated GET in the browser")
                    ctx.check(r.matches, "the written content reads back")
                },
            },
            {
                id: "browser.boundary",
                after: ["browser.login-write"],
                untested: () => config.otherProtected === undefined ? "no otherProtected resource configured" : undefined,
                async run(ctx) {
                    const r = await step(ctx, "boundary")
                    ctx.equal(r.outside, 401, "the other account's protected resource stays challenged")
                    ctx.equal(r.credentialed, 0, "credentialed requests outside the boundary")
                },
            },
            {
                id: "browser.logout",
                after: ["browser.login-write"],
                async run(ctx) {
                    const r = await step(ctx, "logout")
                    ctx.equal(r.after, 200, "GET after logout (re-authorized)")
                    ctx.check(r.newFlows >= 1, "logout forgot the session: a new popup authorization was needed")
                },
            },
            {
                id: "browser.cleanup",
                after: ["browser.login-write"],
                always: true, // also after a partial failure: whatever was reported created is deleted
                async run(ctx) {
                    if (owned.size === 0) throw new Error("blocked: the page created nothing, so nothing is cleaned up")
                    const urls = [...owned].reverse() // children before their container
                    const r = await step(ctx, "cleanup", urls)
                    ctx.check(r.deleted.every(s => [200, 204, 205].includes(s)), `DELETE statuses ${r.deleted.join(", ")}`)
                    ctx.equal(r.gone, 404, "the run-owned container is gone")
                    for (const url of urls) owned.delete(url)
                },
            },
        ]
        list.close = async () => {
            await harness.discard()
            await closeServer(server)
        }
        return list
    } catch (error) {
        // Nothing is returned to close: release what was opened here.
        await harness?.discard().catch(() => {})
        await closeServer(server)
        throw error
    }
}

export async function close(scenarios) {
    await scenarios.close()
}
