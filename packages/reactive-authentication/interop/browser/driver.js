// Runner-side driving of the SDK pages (Playwright): open a page, call its harness, wait for the authorization.
// Only the safe facts the page returns cross back; page errors are counted, never echoed.
//
// Cancellation: every browser operation of a scenario runs through `guarded`. If the scenario's signal aborts
// while an operation is outstanding (a timeout), the page and every popup it opened are closed — which destroys
// the in-page work (SDK calls, timers, fetches) — and only then does the operation reject, so the scenario body
// cannot settle while its browser work still runs. The next scenario gets a fresh page and harness. On success the
// abort listener is removed, so the runner's routine "scenario finished" abort leaves the reusable page alone.
import { createHash } from "node:crypto"
import { CheckError } from "../lib/checkError.js"
import { errorFacts, interactionCodes } from "./errors.js"
import { corsDecoy, startPageServer } from "./server.js"

/** Where the library executed, for the report (distinguishes in-page execution from the Node adapters). */
export function executionFacts(env) {
    return {execution: "browser", engine: env.browser.browserType().name(), engineVersion: env.browser.version()}
}

/** Pages opened by this module -> the popups they (transitively) opened. */
const owned = new WeakMap()

function adopt(page) {
    const handle = {page, popupPages: new Set(), popups: {count: 0}, pageErrors: {count: 0}}
    const track = opener => opener.on("popup", popup => {
        handle.popups.count++
        handle.popupPages.add(popup)
        popup.once("close", () => handle.popupPages.delete(popup))
        track(popup)
    })
    track(page)
    page.on("pageerror", () => { handle.pageErrors.count++ })
    owned.set(page, handle)
    return handle
}

const bounded = (promise, ms) => {
    let timer
    return Promise.race([promise, new Promise(resolve => { timer = setTimeout(resolve, ms) })]).finally(() => clearTimeout(timer))
}

/** Closes the page's popups and the page itself (bounded; closing is idempotent). */
export async function discard(page) {
    const handle = owned.get(page)
    const popups = [...(handle?.popupPages ?? [])]
    await Promise.all(popups.map(p => bounded(p.close({runBeforeUnload: false}).catch(() => {}), 5_000)))
    await bounded(page.close({runBeforeUnload: false}).catch(() => {}), 5_000)
}

/**
 * Runs `operation()` (browser work on `page`) under `signal`. If `signal` is already aborted, or aborts while
 * the operation is outstanding, the page and its popups are closed before this rejects with the abort reason.
 */
export async function guarded(page, operation, signal) {
    if (signal === undefined) return await operation()
    if (signal.aborted) {
        await discard(page)
        throw signal.reason
    }
    let onAbort
    let closing
    const aborted = new Promise((_, reject) => {
        onAbort = () => {
            closing = discard(page)
            closing.then(() => reject(signal.reason))
        }
        signal.addEventListener("abort", onAbort, {once: true})
    })
    aborted.catch(() => {})
    const work = Promise.resolve().then(operation)
    work.catch(() => {}) // if the abort wins, the closed page rejects this later: nothing unhandled
    try {
        const value = await Promise.race([work, aborted])
        if (signal.aborted) throw signal.reason // settled in the same turn as the abort: still an abort
        return value
    } catch (error) {
        // Closing the page may reject the operation ("target closed") before the abort's own rejection, depending on
        // the engine: whenever the signal aborted, settle only once the page is closed, and with the abort reason.
        if (signal.aborted) {
            await (closing ?? discard(page))
            throw signal.reason
        }
        throw error
    } finally {
        signal.removeEventListener("abort", onAbort)
    }
}

/**
 * Opens `url` in the target's browser context and waits for the page harness.
 * @returns {Promise<{page: import("playwright").Page, popups: {count: number}, pageErrors: {count: number}}>}
 */
export async function openHarnessPage(env, url, signal) {
    const context = await env.context()
    const page = await context.newPage()
    const handle = adopt(page)
    try {
        await guarded(page, async () => {
            await page.goto(url)
            await page.waitForFunction(() => globalThis.harness?.ready === true, null, {timeout: 30_000})
        }, signal)
    } catch (error) {
        await discard(page)
        throw error
    }
    return {page, popups: handle.popups, pageErrors: handle.pageErrors}
}

/** Reloads the page (a new application instance) and waits for its harness, under `signal`. */
export function reloadHarness(page, signal) {
    return guarded(page, async () => {
        await page.reload()
        await page.waitForFunction(() => globalThis.harness?.ready === true, null, {timeout: 30_000})
    }, signal)
}

/**
 * The resources of one target's run: the page server on the registered origin, the decoy, and one page
 * (opened and set up on first use, and again after a cancelled operation closed it).
 * @param {string} path page path on the origin
 * @param {(decoy: string) => object} pageConfig the page's setup argument (no secrets: pages are test code)
 */
export function sdkSession(env, origin, path, pageConfig) {
    let server
    let decoy
    let opened
    return {
        get decoy() { return decoy },
        get current() { return opened },
        async open(ctx) {
            ctx.note(executionFacts(env))
            if (opened !== undefined && !opened.page.isClosed()) return opened
            server ??= await startPageServer(origin)
            decoy ??= await corsDecoy()
            const candidate = await openHarnessPage(env, `${server.origin}${path}`, ctx.signal)
            try {
                candidate.setup = await this.setup(ctx, candidate.page)
            } catch (error) {
                await discard(candidate.page)
                throw error
            }
            opened = candidate
            return opened
        },
        /** (Re-)runs the page's setup, e.g. after a reload. */
        async setup(ctx, page = opened.page) {
            return await call(page, "setup", pageConfig(decoy.url), ctx.signal)
        },
        async close() {
            if (opened !== undefined) await discard(opened.page)
            await Promise.all([server?.close(), decoy?.close()])
        },
    }
}

/** Calls `harness[name](argument)` in the page. */
export function call(page, name, argument, signal) {
    return guarded(page, () => page.evaluate(([n, a]) => globalThis.harness[n](a), [name, argument]), signal)
}

/** Evaluates `fn(argument)` in the page. */
export function evaluate(page, fn, argument, signal) {
    return guarded(page, () => page.evaluate(fn, argument), signal)
}

/** How long a dedicated session may take to complete the popup on its own. */
const sessionPopupMs = 60_000

/** Elements that only appear when a person is asked for something (sign-in, account choice, MFA code). */
const interactionSelector = 'input[type="password"], input[type="email"], input[name="loginfmt"], input[autocomplete="one-time-code"]'

/**
 * Clicks the page's authorize button (a real user activation) and waits for the authorization to settle.
 * `mode` "manual": a person completes the popup (headed). `mode` "session": nobody is there — the dedicated
 * account's saved session must complete it on its own; if the popup shows an input a person would fill, or does
 * not finish in time, the page and popup are closed and this fails closed. Nothing is ever typed.
 */
export async function authorizeByClick(page, {label, signal, mode = "manual", timeoutMs = 300_000}) {
    const session = mode === "session"
    if (session) {
        console.log(`[interop] ${label}: session mode — the popup must complete from the dedicated session without interaction.`)
    } else {
        console.log(`[interop] Complete the ${label} sign-in and consent in the popup window (waiting up to ${Math.round(timeoutMs / 60_000)} minutes).`)
    }
    const needsInteraction = new CheckError(`${label}: dedicated session expired or needs interaction (session mode never signs in; refresh the dedicated account's storageState)`)
    const handle = owned.get(page)
    let watching = true
    const watch = async () => {
        while (watching) {
            await new Promise(resolve => setTimeout(resolve, 500))
            for (const popup of handle?.popupPages ?? []) {
                const shown = await popup.locator(interactionSelector).count().catch(() => 0)
                if (shown > 0) return true
            }
        }
        return false
    }
    const authorization = await guarded(page, async () => {
        await page.click("#authorize")
        const done = page.waitForFunction(() => globalThis.harness.authorization?.done === true, null, {timeout: session ? sessionPopupMs : timeoutMs, polling: 250})
        if (!session) return await (await done).dispose()
        const interaction = watch()
        done.catch(() => {})
        const first = await Promise.race([done.then(h => h.dispose()).then(() => false, () => true), interaction])
        if (first) throw needsInteraction
        return undefined
    }, signal).then(
        async () => await evaluate(page, () => globalThis.harness.authorization, undefined, signal),
        async error => {
            if (error === needsInteraction) await discard(page) // fail closed: nothing stays open waiting for a person
            throw error
        },
    ).finally(() => { watching = false })
    if (session && !authorization.ok && interactionCodes.has(authorization.error?.code)) throw needsInteraction
    return authorization
}

/** A failure whose message holds only harness text and allowlisted error facts (re-checked here). */
export function pageFailure(what, facts) {
    const error = facts?.error === undefined ? undefined : errorFacts(facts.error)
    const detail = error === undefined ? "" : `: ${error.name}${error.code === undefined ? "" : ` [${error.code}]`}`
    const status = Number.isInteger(facts?.status) && facts.status >= 100 && facts.status < 600 ? ` (HTTP ${facts.status})` : ""
    return new CheckError(`${what}${detail}${status}`)
}

/** Assertions shared by both SDK adapters. */
export const expectations = {
    /** A reactive request before authorization: one unauthenticated, readable 401, then InteractionRequiredError. */
    interactionRequired(ctx, result, what) {
        if (!result.interactionRequired) throw pageFailure(`${what} did not fail with InteractionRequiredError`, result)
        ctx.check(result.attempts.length === 1 && result.attempts[0].scheme === undefined && result.attempts[0].status === 401,
            `${what}: exactly one unauthenticated attempt, answered with a readable 401 (got ${result.attempts.map(a => `${a.status ?? "no response"}${a.scheme ? ` ${a.scheme}` : ""}`).join(", ") || "none"})`)
    },

    /** A successful reactive request: challenged unauthenticated attempt, then Bearer (never DPoP), 200. */
    authorizedCall(ctx, result, what) {
        if (result.status === undefined) throw pageFailure(`${what} failed`, result)
        ctx.equal(result.status, 200, `${what}: API status`)
        ctx.check(result.attempts[0]?.scheme === undefined && result.attempts[0]?.status === 401, `${what}: the first attempt carried no credentials and was challenged`)
        ctx.equal(result.attempts.at(-1)?.scheme, "Bearer", `${what}: the retried request used the Bearer scheme`)
        ctx.check(!result.attempts.some(a => a.dpop), `${what}: no DPoP proof was sent to a Bearer API`)
    },

    /**
     * The identity field is present and is the configured test account. The page returns only a digest; the
     * comparison happens here in memory and neither value is reported. `exploratory` targets (never the committed
     * ones) may omit the expected account; the report then says the identity was not compared.
     */
    identity(ctx, result, identity) {
        ctx.check(result.identityDigest !== undefined, `the API response identifies the user (${identity.field})`)
        if (identity.expected === undefined) {
            if (identity.exploratory !== true) throw new CheckError("no expected test account is configured (required outside exploratory mode)")
            ctx.note({identityCheck: "exploratory: not compared with a configured test account"})
            return
        }
        ctx.same(result.identityDigest, sha256(identity.expected), `the API identifies the configured test account (${identity.field})`)
        ctx.note({identityCheck: "matches the configured test account"})
    },

    /** The decoy is inside the manager's boundary but not a provider resource: it must receive nothing. */
    decoy(ctx, result, decoy, before) {
        if (result.status === undefined) throw pageFailure("the decoy request failed", result)
        ctx.equal(result.status, 401, "the decoy's challenge was not answered with credentials")
        ctx.check(result.attempts.length >= 1 && result.attempts.every(a => a.scheme === undefined && !a.dpop), "no credentials were attached to requests to the decoy")
        const seen = decoy.seen.slice(before)
        ctx.check(seen.length >= 1 && seen.every(s => !s.credentials), "the decoy never received (or was asked to accept) credentials")
    },
}

/** Hex SHA-256 (the page's identity digest format). */
export function sha256(value) {
    return createHash("sha256").update(value).digest("hex")
}
