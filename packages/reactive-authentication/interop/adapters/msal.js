// Microsoft Entra ID through the real @azure/msal-browser v5, executed in a real browser: MSAL and the library
// are bundled into a page served from the registered SPA origin, whose same-origin redirect.html runs MSAL's v5
// redirect bridge. A Playwright click starts acquireTokenPopup. Login modes (env.loginMode): "manual" — a person
// completes Microsoft's sign-in in headed mode; "session" — no person: the dedicated test account's saved Entra
// session (storageState) must complete the popup with `prompt: "none"`, otherwise the scenario fails closed.
// Only safe facts come back from the page (statuses, schemes, booleans, allowlisted error facts).
import { authorizeByClick, call, evaluate, expectations, pageFailure, reloadHarness, sdkSession } from "../browser/driver.js"
import { pageOriginProblem } from "../browser/server.js"
import { identityProblems } from "./google.js"

/**
 * @typedef {object} MsalTargetConfig
 * @property {string} origin page origin; `${origin}/redirect.html` is the registered SPA redirect URI
 * @property {string} clientId application (client) ID
 * @property {string} authority e.g. `https://login.microsoftonline.com/<tenant-id>`
 * @property {string[]} scopes scopes of one resource (Graph: `User.Read`)
 * @property {string} [prompt] prompt for the interactive authorization (e.g. `select_account`)
 * @property {{url: string, identity: {field: string, expected?: string, exploratory?: boolean}}} api read-only API
 *   probe; `expected` (the dedicated account's userPrincipalName, or object id with field `id`) is required unless
 *   `exploratory` is true
 * @property {{recipe: "manual" | "session"}} login "session" is set by the runner for unattended runs
 */

const guid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Validates the configuration before any network request; returns problems. */
export function validate(config) {
    const problems = []
    const origin = pageOriginProblem(config.origin)
    if (origin !== undefined) problems.push(origin)
    if (typeof config.clientId !== "string" || !guid.test(config.clientId)) problems.push("clientId must be an Entra application (client) ID (a GUID)")
    try {
        const authority = new URL(config.authority)
        if (authority.protocol !== "https:" || authority.search !== "" || authority.hash !== "") problems.push("authority must be an https URL without query or fragment")
    } catch {
        problems.push("authority is required")
    }
    if (!Array.isArray(config.scopes) || config.scopes.length === 0 || !config.scopes.every(s => typeof s === "string" && s !== "")) problems.push("scopes must be a non-empty list")
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

const sessions = new WeakMap()

export async function scenarios(config, env) {
    const mode = env.loginMode === "session" || config.login?.recipe === "session" ? "session" : "manual"
    // Session mode: `prompt: "none"` — Entra must not show any page; a needed sign-in/consent/MFA is an MSAL
    // InteractionRequiredAuthError (login_required, interaction_required, …), which fails closed.
    const prompt = mode === "session" ? "none" : config.prompt
    const loginHint = config.api.identity.field === "userPrincipalName" ? config.api.identity.expected : undefined
    const session = sdkSession(env, config.origin, "/msal.html", decoy => ({
        clientId: config.clientId, authority: config.authority, redirectUri: `${new URL(config.origin).origin}/redirect.html`,
        scopes: config.scopes, prompt, loginHint, api: config.api.url, identityField: config.api.identity.field, decoy,
    }))
    const sdk = (page, signal) => evaluate(page, () => ({...globalThis.harness.sdk, interactionCallbacks: globalThis.harness.interactionCallbacks}), undefined, signal)

    const list = [
        {
            id: "msal.interaction-required",
            async run(ctx) {
                const {page, popups, setup} = await session.open(ctx)
                const before = popups.count
                const result = await call(page, "probe", undefined, ctx.signal)
                expectations.interactionRequired(ctx, result, "a reactive request before any click")
                const counts = await sdk(page, ctx.signal)
                ctx.equal(popups.count - before, 0, "popups opened without a click")
                ctx.equal(counts.popups, 0, "acquireTokenPopup calls without a click")
                ctx.equal(counts.silent.length, 0, "acquireTokenSilent calls without a selected account")
                ctx.equal(counts.interactionCallbacks, 1, "onInteractionRequired calls")
                ctx.note({sdk: `@azure/msal-browser ${setup.sdkVersion}`})
            },
        },
        {
            id: "msal.authorize-api",
            timeoutMs: 330_000,
            async run(ctx, state) {
                const {page, popups} = await session.open(ctx)
                const before = popups.count
                const authorization = await authorizeByClick(page, {label: config.label ?? "Microsoft", signal: ctx.signal, mode})
                if (!authorization.ok) throw pageFailure("MSAL authorization from the click failed", authorization)
                const counts = await sdk(page, ctx.signal)
                ctx.equal(counts.popups, 1, "acquireTokenPopup calls")
                ctx.check(authorization.activation !== false, "the click handler ran with user activation")
                ctx.check(popups.count - before >= 1, "MSAL's popup opened from the click")

                const result = await call(page, "probe", undefined, ctx.signal)
                expectations.authorizedCall(ctx, result, "the reactive API request after authorization")
                expectations.identity(ctx, result, config.api.identity)
                state.identity = result.identityDigest // in memory only, for the reload comparison
                ctx.note({loginMode: mode, popupsOpened: popups.count - before})
            },
        },
        {
            id: "msal.silent-renewal",
            needs: ["silentRenewal"],
            after: ["msal.authorize-api"],
            async run(ctx, state) {
                // A reload is a new application instance: MSAL restores the account from its cache and the
                // request is authorized silently — no click, no popup.
                const opened = await session.open(ctx)
                const {page, popups} = opened
                const before = popups.count
                await reloadHarness(page, ctx.signal)
                const setup = await session.setup(ctx)
                ctx.check(setup.cachedAccounts >= 1, "MSAL restored the signed-in account from its cache after a reload")
                ctx.check(setup.activeAccountRestored, "the active account (the application's choice) survived the reload")
                const restored = await call(page, "probe", undefined, ctx.signal)
                expectations.authorizedCall(ctx, restored, "the reactive API request after a reload")
                ctx.same(restored.identityDigest, state.identity, "the same user is identified after the reload")
                let counts = await sdk(page, ctx.signal)
                ctx.equal(counts.popups, 0, "acquireTokenPopup calls after the reload")
                ctx.check(counts.silent.length >= 1 && counts.silent.every(c => !c.forceRefresh), "acquireTokenSilent served the reloaded instance")

                // After an API rejects a token the provider asks for another one: forceRefresh must bypass the cache.
                const renewal = await call(page, "renewAfterRejection", undefined, ctx.signal)
                if (!renewal.ok) throw pageFailure("renewal after a rejected token failed", renewal)
                ctx.check(renewal.calls.length === 1 && renewal.calls[0].forceRefresh, "the rejected token led to one acquireTokenSilent with forceRefresh")
                ctx.equal(renewal.calls[0].fromCache, false, "the renewed token came from Microsoft, not MSAL's cache")
                expectations.authorizedCall(ctx, await call(page, "probe", undefined, ctx.signal), "the reactive API request after renewal")
                counts = await sdk(page, ctx.signal)
                ctx.equal(popups.count - before, 0, "popups opened during silent renewal")
                ctx.note({reloadServedFromCache: counts.silent[0]?.fromCache, renewedTokenDiffers: renewal.changed})
            },
        },
        {
            id: "msal.boundary",
            after: ["msal.authorize-api"],
            async run(ctx) {
                const {page} = await session.open(ctx)
                expectations.authorizedCall(ctx, await call(page, "probe", undefined, ctx.signal), "the API request")
                const before = session.decoy.seen.length
                expectations.decoy(ctx, await call(page, "probeDecoy", undefined, ctx.signal), session.decoy, before)
            },
        },
        {
            id: "msal.forget",
            after: ["msal.authorize-api"],
            async run(ctx) {
                // Documented behaviour: forget is local to the source; with an `account` selector the application
                // also clears its choice. MSAL's account cache (and Microsoft's session) are left alone.
                const {page, popups} = await session.open(ctx)
                const before = popups.count
                const silentBefore = (await sdk(page, ctx.signal)).silent.length
                const forgotten = await call(page, "forget", undefined, ctx.signal)
                if (!forgotten.ok) throw pageFailure("logout (MsalTokenSource.forget) failed", forgotten)
                const result = await call(page, "probe", undefined, ctx.signal)
                expectations.interactionRequired(ctx, result, "a reactive request after logout")
                const counts = await sdk(page, ctx.signal)
                ctx.equal(counts.silent.length - silentBefore, 0, "acquireTokenSilent calls after logout")
                ctx.equal(popups.count - before, 0, "popups opened by logout or the request after it")
                ctx.note({msalAccountsKeptAfterLocalLogout: forgotten.cachedAccounts})
            },
        },
    ]
    sessions.set(list, session)
    return list
}

export async function close(list) {
    await sessions.get(list)?.close()
}
