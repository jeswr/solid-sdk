// Real-browser regressions of the browser-SDK driver (interop/browser/driver.js), in a local page with no provider:
// cancellation unwinds outstanding in-page work (page and popups closed before the call settles, no late effects)
// and session mode fails closed when a popup asks for a person. Not part of `npm test` (which stays offline):
//   npm run build && RA_TEST_BROWSER=chromium|firefox|webkit node --test test/browser/sdk-regressions.test.js
// A browser that cannot launch fails the run — there is no skip.
import assert from "node:assert/strict"
import { once } from "node:events"
import { createServer } from "node:http"
import { test } from "node:test"
import * as playwright from "playwright"
import { authorizeByClick, call, openHarnessPage } from "../../interop/browser/driver.js"

const engine = process.env.RA_TEST_BROWSER ?? "chromium"
if (!["chromium", "firefox", "webkit"].includes(engine)) throw new Error(`Unknown RA_TEST_BROWSER ${engine}`)

async function fixtureServer() {
    const hits = {late: 0}
    const harnessPage = `<!doctype html><button id="authorize">authorize</button><script>
        globalThis.harness = {
            ready: true,
            pending() {
                window.open("/popup", "p", "popup")
                setTimeout(() => { fetch("/late", {method: "POST"}); localStorage.setItem("late", "1") }, 1_500)
                return new Promise(() => {})
            },
            quick() { return 1 },
            late() { return localStorage.getItem("late") },
        }
        document.querySelector("#authorize").addEventListener("click", () => {
            harness.authorization = {done: false}
            window.open("/login", "p", "popup")
        })
    </script>`
    const server = createServer((request, response) => {
        if (request.url === "/late") hits.late++
        const body = request.url === "/" ? harnessPage : request.url === "/login" ? `<!doctype html><form><input type="email" name="u"><input type="password" name="p"></form>` : "<!doctype html>popup"
        response.writeHead(200, {"content-type": "text/html", "cache-control": "no-store"}).end(body)
    })
    server.listen(0, "127.0.0.1")
    await once(server, "listening")
    return {url: `http://127.0.0.1:${server.address().port}/`, hits, close: () => new Promise(resolve => server.close(resolve))}
}

async function withBrowser(fn) {
    // A launch failure fails the test: this file exists to run these regressions in a real engine.
    const browser = await playwright[engine].launch()
    const fixture = await fixtureServer()
    try {
        const context = await browser.newContext()
        await fn({env: {context: async () => context}, fixture, context})
    } finally {
        await browser.close()
        await fixture.close()
    }
}

test("aborting an outstanding in-page operation closes the page and its popups before the call settles", async () => {
    await withBrowser(async ({env, fixture, context}) => {
        // Success path: the routine post-scenario abort must not destroy the reusable page.
        const finished = new AbortController()
        const reusable = await openHarnessPage(env, fixture.url, finished.signal)
        assert.equal(await call(reusable.page, "quick", undefined, finished.signal), 1)
        finished.abort(new Error("scenario finished"))
        await new Promise(resolve => setTimeout(resolve, 100))
        assert.equal(reusable.page.isClosed(), false, "a completed operation leaves no cancellation listener behind")
        await reusable.page.close()

        // Timeout path: a pending harness call that opened a popup and scheduled late side effects.
        const controller = new AbortController()
        const opened = await openHarnessPage(env, fixture.url, controller.signal)
        const popup = context.waitForEvent("page")
        const pending = call(opened.page, "pending", undefined, controller.signal)
        const popupPage = await popup
        setTimeout(() => controller.abort(new Error("timed out")), 100)
        await assert.rejects(pending, /timed out/)
        assert.equal(opened.page.isClosed(), true, "the page is closed before the cancelled call settles")
        assert.equal(popupPage.isClosed(), true, "the page's popup is closed before the cancelled call settles")
        assert.equal(opened.popups.count, 1)

        // The next scenario gets a fresh page; nothing from the cancelled one runs any more.
        const next = await openHarnessPage(env, fixture.url, new AbortController().signal)
        await new Promise(resolve => setTimeout(resolve, 2_000))
        assert.equal(fixture.hits.late, 0, "no late request from the cancelled page")
        assert.equal(await call(next.page, "late", undefined, undefined), null, "no late storage mutation visible to the next page")

        // An operation started after the abort is refused and also unwinds.
        await assert.rejects(call(next.page, "quick", undefined, controller.signal), /timed out/)
        assert.equal(next.page.isClosed(), true)
    })
})

test("session mode fails closed when the popup asks a person for anything, and closes it", async () => {
    await withBrowser(async ({env, fixture, context}) => {
        const controller = new AbortController()
        const opened = await openHarnessPage(env, fixture.url, controller.signal)
        const popup = context.waitForEvent("page")
        const started = Date.now()
        const authorizing = authorizeByClick(opened.page, {label: "Fixture", signal: controller.signal, mode: "session"})
        const popupPage = await popup
        await assert.rejects(authorizing, error => error.name === "CheckError" && /dedicated session expired or needs interaction/.test(error.message))
        assert.ok(Date.now() - started < 30_000, "detected before the session deadline")
        assert.equal(popupPage.isClosed(), true, "the sign-in popup is closed; nothing was typed into it")
        assert.equal(opened.page.isClosed(), true)
    })
})
