// Real-browser smoke tests (Chromium via Playwright) against the same local mock servers as the Node tests:
// 1. page.html   — ReactiveFetchManager registered globally, <authorization-code-flow> popup, DPoP-bound
//                  requests with body replay, and no credentials outside the boundary.
//                  An authenticated write answered by a redirect yields the opaque response, written once.
// 2. sw.html     — a module service worker intercepting fetches in two tabs; each tab receives only its
//                  own authorization interaction through the message bridge.
// 3. popup.html  — popup lifecycle: forged callbacks from another origin or source are ignored, a queued
//                  flow can be aborted, closing the popup cancels, a genuine callback resolves.
// 4. auto.html   — automatic boundary: roots from a storage description and from ancestor traversal.
// 5. google.html — Google token-model adapter with a mock GIS SDK: interaction required before a click, the
//                  SDK request made inside the click's user activation, reactive Bearer requests, abort.
// 6. cache.html  — IndexedDB/Web Storage persistence across a reload, non-extractable keys still sign.
import { build } from "esbuild"
import { readFile } from "node:fs/promises"
import { extname, join, normalize } from "node:path"
import { fileURLToPath } from "node:url"
import { chromium } from "playwright"
import { serve } from "../helpers/http.js"
import { startOpenIdProvider, startSolidStorage } from "../helpers/openid.js"

const root = fileURLToPath(new URL("../../", import.meta.url))
const types = {".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".jsonld": "application/ld+json", ".map": "application/json"}

await build({entryPoints: {page: "test/browser/page-entry.js"}, bundle: true, format: "iife", globalName: "RA", outdir: "test/browser/.bundle", platform: "browser", absWorkingDir: root, logLevel: "warning"})
await build({entryPoints: {sw: "test/browser/sw-entry.js"}, bundle: true, format: "esm", outdir: "test/browser/.bundle", platform: "browser", absWorkingDir: root, logLevel: "warning"})

const app = await serve(async request => {
    const path = normalize(decodeURIComponent(new URL(request.url).pathname))
    if (path.includes("..")) return new Response(null, {status: 400})
    try {
        const body = await readFile(join(root, path))
        const headers = {"content-type": types[extname(path)] ?? "application/octet-stream"}
        if (path.endsWith("/sw.js")) headers["service-worker-allowed"] = "/"
        return new Response(body, {headers})
    } catch {
        return new Response("not found", {status: 404})
    }
})
const op = await startOpenIdProvider()
const rs = await startSolidStorage(op, {
    // A page on the storage origin that impersonates the callback by messaging its opener.
    handle: async request => {
        const url = new URL(request.url)
        // A storage root that only identifies itself (no description link on its resources).
        if (url.pathname === "/pods/bob/" && !request.headers.has("authorization")) {
            return new Response(null, {status: 401, headers: {"www-authenticate": "DPoP", link: `<http://www.w3.org/ns/pim/space#Storage>; rel="type"`}})
        }
        if (url.pathname !== "/popup-evil") return undefined
        const forged = JSON.stringify(`${url.searchParams.get("redirect_uri")}?code=evil`)
        return new Response(`<script>setInterval(() => opener?.postMessage(${forged}, "*"), 100)</script>`, {headers: {"content-type": "text/html"}})
    },
    after: async request => new URL(request.url).pathname === "/alice/redirect-write"
        ? new Response(null, {status: 303, headers: {location: "/alice/page"}})
        : undefined,
})
const appOrigin = app.url // 127.0.0.1 is a potentially trustworthy origin, so service workers work over HTTP

const browser = await chromium.launch()
const failures = []
try {
    const context = await browser.newContext()
    const query = `op=${encodeURIComponent(op.issuer)}&rs=${encodeURIComponent(rs.url)}`

    const report = (name, ok, detail) => {
        console.log(`${ok ? "PASS" : "FAIL"} ${name}: ${typeof detail === "string" ? detail : JSON.stringify(detail)}`)
        if (!ok) failures.push(name)
    }
    const resultOf = async (page, timeout = 30_000) => {
        await page.waitForFunction(() => window.__result !== undefined, null, {timeout})
        return await page.evaluate(() => window.__result)
    }

    {
        const page = await context.newPage()
        page.on("pageerror", e => console.error(`[page] ${e}`))
        await page.goto(`${appOrigin}/test/browser/page.html?${query}`)
        const r = await resultOf(page)
        report("page", r.get?.[0] === 200 && r.get[1] === "hello alice" && r.put === 200 && r.outside === 401 && r.subject === "alice", r)
        const redirectWrites = rs.writes.filter(w => w.url.endsWith("/alice/redirect-write")).length
        report("opaque-redirect", r.redirected?.[0] === "opaqueredirect" && r.redirected[1] === 0 && redirectWrites === 1, {redirected: r.redirected, redirectWrites})
        await page.close()
    }

    {
        const tabs = [await context.newPage(), await context.newPage()]
        for (const tab of tabs) {
            tab.on("pageerror", e => console.error(`[sw] ${e}`))
            await tab.goto(`${appOrigin}/test/browser/sw.html?${query}`)
            await tab.waitForFunction(() => window.__ready === true, null, {timeout: 30_000})
        }
        await Promise.all([tabs[0].evaluate(() => window.run("/alice/worker")), tabs[1].evaluate(() => window.run("/bob/worker"))])
        const [a, b] = await Promise.all(tabs.map(tab => resultOf(tab)))
        report("sw", a.inside?.[0] === 200 && b.inside?.[0] === 200 && a.outside === 401 && b.outside === 401 && a.interactions === 1 && b.interactions === 1, {a, b})
        for (const tab of tabs) await tab.close()
    }

    {
        // A fresh context: the service worker registered above would otherwise answer these requests.
        const isolated = await browser.newContext()
        const page = await isolated.newPage()
        page.on("pageerror", e => console.error(`[auto] ${e}`))
        await page.goto(`${appOrigin}/test/browser/auto.html?${query}`)
        const r = await resultOf(page)
        report("auto-boundary", r.described === 200 && r.walked === 200 && r.none === 401 && JSON.stringify(r.roots) === JSON.stringify(["/alice/", "/pods/bob/"]), r)
        await isolated.close()
    }

    {
        const bearerApi = await serve(request => request.headers.get("authorization") === "Bearer g-browser"
            ? new Response("drive ok")
            : new Response(null, {status: 401, headers: {"www-authenticate": "Bearer"}}))
        const isolated = await browser.newContext()
        const page = await isolated.newPage()
        page.on("pageerror", e => console.error(`[google] ${e}`))
        await page.goto(`${appOrigin}/test/browser/google.html?api=${encodeURIComponent(bearerApi.url)}`)
        await page.waitForFunction(() => window.__ready === true)
        await page.click("#connect")
        const r = await resultOf(page)
        report("google-adapter", r.beforeClick === "interaction_required" && r.activation === true && r.afterClick === 200 && r.aborted === "AbortError" && r.stillUsesOriginal === 200, r)
        await isolated.close()
        await bearerApi.close()
    }

    {
        const page = await context.newPage()
        page.on("pageerror", e => console.error(`[popup] ${e}`))
        await page.goto(`${appOrigin}/test/browser/popup.html?${query}`)
        const r = await resultOf(page)
        report("popup", r.forged?.error === "AbortError" && r.queued?.error === "AbortError" && r.closed?.error === "CodeRequestCancelledError" && r.genuine === "good", r)
        await page.close()
    }

    const page = await context.newPage()
    await page.goto(`${appOrigin}/test/browser/cache.html`)
    await page.waitForFunction(() => /^(PASS|FAIL)/.test(document.querySelector("#result")?.textContent ?? ""), null, {timeout: 30_000})
    const text = await page.textContent("#result")
    console.log(`${text.startsWith("PASS") ? "PASS" : "FAIL"} cache: ${text}`)
    if (!text.startsWith("PASS")) failures.push("cache")

    const writes = rs.writes.filter(w => w.url.endsWith("/alice/page"))
    const replayed = writes.length === 1 && writes[0].body === "replayed body"
    console.log(`${replayed ? "PASS" : "FAIL"} replay: authenticated PUT reached the server once with its body`)
    if (!replayed) failures.push("replay")
} finally {
    await browser.close()
    await rs.close()
    await op.close()
    await app.close()
}

if (failures.length > 0) {
    console.error(`Browser smoke tests failed: ${failures.join(", ")}`)
    process.exit(1)
}
