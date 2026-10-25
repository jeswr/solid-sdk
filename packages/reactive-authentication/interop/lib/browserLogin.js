// A CodeProvider whose user agent is a real browser (Playwright): it opens the authorization URL, lets a login
// recipe (or a human, in headed mode) complete the provider's own login and consent pages, and receives the
// redirect on a real loopback listener (the registered redirect URI). The authorization response is only
// ever handed to the library — never logged.
import { callbackServer } from "./callbackServer.js"

/** Parses the facts a report may keep about an authorization request (no state, nonce, challenge or hints). */
export function authorizationFacts(url) {
    const p = url.searchParams
    return {
        endpoint: `${url.origin}${url.pathname}`,
        responseType: p.get("response_type"),
        codeChallengeMethod: p.get("code_challenge_method"),
        hasState: p.has("state"),
        hasNonce: p.has("nonce"),
        scope: p.get("scope"),
        prompt: p.get("prompt") ?? undefined,
        resource: p.has("resource"),
        audience: p.has("audience"),
    }
}

/**
 * @param {object} options
 * @param {() => Promise<import("playwright").BrowserContext>} options.context browser context (cookies = the user's browser)
 * @param {string} options.redirectUri loopback redirect URI registered with the provider
 * @param {(page: import("playwright").Page, done: Promise<unknown>) => Promise<void>} options.login
 * @param {number} [options.timeoutMs]
 */
export function browserCodeProvider({context, redirectUri, login, timeoutMs = 120_000}) {
    return {
        calls: 0,
        /** Safe facts about each authorization request made. */
        requests: [],
        async getCode(authorizationUrl, signal) {
            signal?.throwIfAborted()
            this.calls++
            this.requests.push(authorizationFacts(authorizationUrl))
            const state = authorizationUrl.searchParams.get("state")
            if (!state) throw new Error("authorization request without state")

            // One signal covers the caller's abort and our deadline; aborting closes the page, which also stops
            // any navigation or login driving still in progress.
            const bound = AbortSignal.any([...(signal === undefined ? [] : [signal]), AbortSignal.timeout(timeoutMs)])
            const listener = await callbackServer(redirectUri)
            let page
            const stop = () => { page?.close().catch(() => {}) }
            bound.addEventListener("abort", stop, {once: true})
            try {
                bound.throwIfAborted()
                const callback = listener.wait(state, bound)
                callback.catch(() => {})
                page = await (await context()).newPage()
                bound.throwIfAborted() // aborted while the page was being created: stop() ran before it existed
                const driving = page.goto(authorizationUrl.href).then(() => login(page, callback))
                driving.catch(() => {})
                const value = await Promise.race([callback, driving.then(() => callback)])
                const opened = page
                return {value, [Symbol.dispose]() { opened.close().catch(() => {}) }}
            } catch (error) {
                stop()
                if (bound.aborted && !signal?.aborted) throw new Error(`no authorization response within ${timeoutMs} ms`, {cause: error})
                throw signal?.aborted ? signal.reason : error
            } finally {
                bound.removeEventListener("abort", stop)
                await listener.close()
            }
        },
    }
}

const pause = ms => new Promise(resolve => setTimeout(resolve, ms))

/**
 * Drives login pages: repeatedly acts on the first visible known element until the callback arrives. Each
 * action may run a limited number of times, so a rejected password fails fast instead of looping.
 *
 * @param {Array<{name: string, selector: string, act(page): Promise<void>, max?: number}>} steps
 */
export async function drive(page, done, steps, {error} = {}) {
    let finished = false
    done.then(() => { finished = true }, () => { finished = true })
    const counts = new Map()
    while (!finished && !page.isClosed()) {
        let acted = false
        for (const step of steps) {
            if (finished) return
            const locator = page.locator(step.selector).first()
            if (!await locator.isVisible().catch(() => false)) continue
            const count = (counts.get(step.name) ?? 0) + 1
            if (count > (step.max ?? 2)) {
                const detail = error === undefined ? "" : await page.locator(error).first().innerText({timeout: 500}).catch(() => "")
                throw new Error(`login step "${step.name}" is still shown after ${step.max ?? 2} attempts${detail ? `: ${detail.trim().slice(0, 160)}` : ""}`)
            }
            counts.set(step.name, count)
            const before = page.url()
            await step.act(page)
            await Promise.race([done.catch(() => {}), page.waitForURL(url => url.href !== before, {timeout: 8_000}).catch(() => {})])
            acted = true
            break
        }
        if (!acted) await Promise.race([done.catch(() => {}), pause(250)])
    }
}

/** Login recipes by name. Credentials come from the (test-only) target configuration, never from the report. */
export const loginRecipes = {
    /** Community Solid Server 7 account pages: password login, then the OIDC consent page with a WebID choice. */
    "css-password": ({email, password, webId}) => (page, done) => drive(page, done, [
        {name: "password login", selector: "#mainForm input#email", act: async p => {
            await p.fill("input#email", email)
            await p.fill("input#password", password)
            await p.click("#mainForm button[type=submit]")
        }},
        {name: "consent", selector: "button#authorize", act: async p => {
            if (webId !== undefined) {
                // The page fills its WebID list from the account API after loading.
                const choice = p.locator(`input[name=webId][value="${webId}"]`)
                await choice.waitFor({state: "attached", timeout: 10_000}).catch(() => {
                    throw new Error("the consent page does not offer the configured WebID")
                })
                await choice.check()
            }
            await p.click("button#authorize")
        }},
    ], {error: "#error"}),

    /** Keycloak login theme (v2): username/password form and, when a client requires it, the consent screen. */
    "keycloak-password": ({username, password}) => (page, done) => drive(page, done, [
        {name: "password login", selector: "form#kc-form-login input#username", act: async p => {
            await p.fill("input#username", username)
            await p.fill("input#password", password)
            await p.click("#kc-login")
        }},
        {name: "consent", selector: "form#kc-oauth input[name=accept], #kc-oauth button[name=accept]", act: async p => {
            await p.click("[name=accept]")
        }},
    ], {error: "#input-error, .kc-feedback-text, .pf-v5-c-alert__title"}),

    /** Node Solid Server 5 password login (`/login/password`) and its consent (sharing) page. */
    "nss-password": ({username, password}) => (page, done) => drive(page, done, [
        {name: "password login", selector: "form input#username", act: async p => {
            await p.fill("input#username", username)
            await p.fill("input#password", password)
            await p.click("form button[type=submit]")
        }},
        {name: "consent", selector: "form button[name=consent], form input[name=consent]", act: async p => {
            await p.click("[name=consent]")
        }},
    ], {error: ".alert-danger"}),

    /**
     * Nextcloud login form, then the Solid app's sharing (consent) page. Not yet exercised end to end: Solid
     * Nextcloud never issues a 401 challenge, so no authorization starts (see the target's knownIncompatible).
     */
    "nextcloud-password": ({username, password}) => (page, done) => drive(page, done, [
        {name: "password login", selector: "form input#user", act: async p => {
            await p.fill("input#user", username)
            await p.fill("input#password", password)
            await p.click("form button[type=submit]")
        }},
        {name: "consent", selector: "button[name=approval][value=allow], input[name=approval][value=allow]", act: async p => {
            await p.click("[name=approval][value=allow]")
        }},
    ], {error: ".warning, .login-form__error"}),

    /**
     * PHP Solid Server login form (src/Template/login.html) and approval page. Not yet exercised end to end: the
     * server never issues a 401 challenge, so no authorization starts (see the target's knownIncompatible).
     */
    "php-password": ({username, password}) => (page, done) => drive(page, done, [
        {name: "password login", selector: "form input[name=username]", act: async p => {
            await p.fill("input[name=username]", username)
            await p.fill("input[name=password]", password)
            await p.click("form [type=submit]")
        }},
        {name: "consent", selector: "[name=approval][value=allow]", act: async p => {
            await p.click("[name=approval][value=allow]")
        }},
    ]),

    /**
     * Unattended runs with a dedicated test account's saved IdP session (Playwright storageState): the provider
     * must redirect back without any interaction. Nothing is typed; a visible password field or no redirect within
     * `waitMs` fails closed (the session expired, or the provider asks for consent, MFA or a login).
     */
    session: ({label, waitMs = 30_000}) => async (page, done) => {
        let finished = false
        done.then(() => { finished = true }, () => { finished = true })
        const deadline = Date.now() + waitMs
        while (!finished && Date.now() < deadline) {
            if (await page.locator("input[type=password]").first().isVisible().catch(() => false)) {
                throw new Error(`the dedicated session for ${label} expired or needs interaction (a login form is shown)`)
            }
            await Promise.race([done.catch(() => {}), pause(250)])
        }
        if (!finished) throw new Error(`the dedicated session for ${label} expired or needs interaction (no redirect within ${waitMs} ms)`)
    },

    /** A person completes login (and MFA) in the headed browser; nothing is typed or stored by the harness. */
    manual: ({label}) => async (_page, done) => {
        console.log(`[interop] Complete the sign-in for ${label} in the opened browser window (waiting for the redirect).`)
        await done
    },
}
