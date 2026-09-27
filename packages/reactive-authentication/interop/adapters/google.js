// Google Identity Services (token model), executed in a real browser: the real GIS script and the library run
// in a page served from the test OAuth client's authorized JavaScript origin (interop/browser/). A Playwright
// click on the page's button is the user gesture that starts Google's popup. Login modes (env.loginMode):
// "manual" — a person completes Google's sign-in and consent in headed mode; "session" — no person: the dedicated
// test account's saved Google session (storageState) must complete the popup with `prompt: "none"`, otherwise the
// scenario fails closed. Only safe facts come back from the page (statuses, schemes, allowlisted error facts).
import { authorizeByClick, call, evaluate, expectations, pageFailure, sdkSession } from "../browser/driver.js"
import { pageOriginProblem } from "../browser/server.js"
import { expectsCapability } from "../lib/scenario.js"

/**
 * @typedef {object} GoogleTargetConfig
 * @property {string} origin page origin registered as an authorized JavaScript origin, e.g. `http://localhost:39440`
 * @property {string} clientId Web application OAuth client ID
 * @property {string[]} scopes scopes of the probed API (the token model issues one token for them)
 * @property {"" | "none" | "consent" | "select_account"} [prompt] prompt for the first authorization
 * @property {{url: string, identity: {field: string, expected?: string, exploratory?: boolean}}} api read-only
 *   Google API probe; `expected` (the dedicated test account's email) is required unless `exploratory` is true
 * @property {{recipe: "manual" | "session"}} login "session" is set by the runner for unattended runs
 */

const prompts = ["", "none", "consent", "select_account"]

/** Validates the configuration before any network request; returns problems. */
export function validate(config) {
    const problems = []
    const origin = pageOriginProblem(config.origin)
    if (origin !== undefined) problems.push(origin)
    if (typeof config.clientId !== "string" || !/^[\w-]+\.apps\.googleusercontent\.com$/.test(config.clientId)) problems.push("clientId must be a Google OAuth client ID (….apps.googleusercontent.com)")
    if (!Array.isArray(config.scopes) || config.scopes.length === 0 || !config.scopes.every(s => typeof s === "string" && s !== "")) problems.push("scopes must be a non-empty list")
    if (config.prompt !== undefined && !prompts.includes(config.prompt)) problems.push(`prompt must be one of ${prompts.map(p => JSON.stringify(p)).join(", ")}`)
    try {
        if (new URL(config.api?.url).protocol !== "https:") problems.push("api.url must be https")
    } catch {
        problems.push("api.url is required")
    }
    if (typeof config.api?.identity?.field !== "string" || config.api.identity.field === "") problems.push("api.identity.field is required")
    problems.push(...identityProblems(config.api?.identity))
    if (!["manual", "session"].includes(config.login?.recipe)) problems.push("login.recipe must be manual (a person in --headed mode) or session (set by the runner for a dedicated account's storageState)")
    return problems
}

/** The expected test account is required for strict results; only an explicit exploratory flag waives it. */
export function identityProblems(identity) {
    if (identity?.exploratory !== undefined && typeof identity.exploratory !== "boolean") return ["api.identity.exploratory must be a boolean"]
    if (identity?.exploratory === true) return []
    return typeof identity?.expected === "string" && identity.expected !== "" ? [] : ["api.identity.expected (the dedicated test account) is required unless api.identity.exploratory is true"]
}

const sessions = new WeakMap()

export async function scenarios(config, env) {
    const revokeOnForget = expectsCapability(env, "revocation")
    const mode = env.loginMode === "session" || config.login?.recipe === "session" ? "session" : "manual"
    // Session mode: `prompt: "none"` — Google must not show any page; a needed sign-in/consent/account choice is an
    // error (interaction_required, consent_required, …), which fails closed. The expected account is the hint.
    const prompt = mode === "session" ? "none" : config.prompt
    const loginHint = config.api.identity.expected
    const session = sdkSession(env, config.origin, "/google.html", decoy => ({
        clientId: config.clientId, scopes: config.scopes, prompt, loginHint, api: config.api.url,
        identityField: config.api.identity.field, decoy, revokeOnForget,
    }))
    const sdk = (page, signal) => evaluate(page, () => ({...globalThis.harness.sdk, interactionCallbacks: globalThis.harness.interactionCallbacks}), undefined, signal)

    const list = [
        {
            id: "gis.interaction-required",
            async run(ctx) {
                const {page, popups} = await session.open(ctx)
                const before = popups.count
                const result = await call(page, "probe", undefined, ctx.signal)
                expectations.interactionRequired(ctx, result, "a reactive request before any click")
                const counts = await sdk(page, ctx.signal)
                ctx.equal(popups.count - before, 0, "popups opened without a click")
                ctx.equal(counts.initTokenClient, 0, "GIS token clients created without a click")
                ctx.equal(counts.interactionCallbacks, 1, "onInteractionRequired calls")
                ctx.note({sdk: "Google Identity Services (https://accounts.google.com/gsi/client)"})
            },
        },
        {
            id: "gis.authorize-api",
            timeoutMs: 330_000,
            async run(ctx) {
                const {page, popups} = await session.open(ctx)
                const before = popups.count
                const authorization = await authorizeByClick(page, {label: config.label ?? "Google", signal: ctx.signal, mode})
                if (!authorization.ok) throw pageFailure("Google authorization from the click failed", authorization)
                const counts = await sdk(page, ctx.signal)
                ctx.equal(counts.requests.length, 1, "GIS token requests")
                ctx.check(counts.requests[0] !== false, "requestAccessToken ran inside the click's user activation")
                ctx.check(popups.count - before >= 1, "Google's popup opened from the click")

                const result = await call(page, "probe", undefined, ctx.signal)
                expectations.authorizedCall(ctx, result, "the reactive API request after authorization")
                expectations.identity(ctx, result, config.api.identity)
                ctx.note({loginMode: mode, userActivation: counts.requests[0] ?? "not reported by this engine", popupsOpened: popups.count - before})
            },
        },
        {
            id: "gis.boundary",
            after: ["gis.authorize-api"],
            async run(ctx) {
                const {page} = await session.open(ctx)
                // A token is available (the API still answers), so only the provider's resources keep it home.
                expectations.authorizedCall(ctx, await call(page, "probe", undefined, ctx.signal), "the API request")
                const before = session.decoy.seen.length
                expectations.decoy(ctx, await call(page, "probeDecoy", undefined, ctx.signal), session.decoy, before)
            },
        },
        {
            id: "gis.forget",
            after: ["gis.authorize-api"],
            // Google's revoke withdraws the app's whole grant: in session mode that would remove the dedicated
            // account's consent that unattended runs depend on, so revocation is only exercised with a person.
            untested: () => mode === "session" && revokeOnForget ? "session mode: revocation would withdraw the dedicated account's consent that unattended runs rely on; run gis.forget with --headed" : undefined,
            async run(ctx) {
                const {page, popups} = await session.open(ctx)
                const before = popups.count
                const forgotten = await call(page, "forget", undefined, ctx.signal)
                if (!forgotten.ok) throw pageFailure("logout (GoogleTokenSource.forget) failed", forgotten)
                const counts = await sdk(page, ctx.signal)
                if (revokeOnForget) {
                    ctx.equal(counts.revocations, 1, "google.accounts.oauth2.revoke calls on forget")
                    const refused = await call(page, "lastTokenRefused", undefined, ctx.signal)
                    ctx.equal(refused.status, 401, "Google refuses the revoked access token")
                } else {
                    ctx.equal(counts.revocations, 0, "no revocation without revokeOnForget")
                }
                const result = await call(page, "probe", undefined, ctx.signal)
                expectations.interactionRequired(ctx, result, "a reactive request after logout")
                ctx.equal(popups.count - before, 0, "popups opened by logout or the request after it")
                ctx.note({revokeOnForget})
            },
        },
    ]
    sessions.set(list, session)
    return list
}

export async function close(list) {
    await sessions.get(list)?.close()
}
