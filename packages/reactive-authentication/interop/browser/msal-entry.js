// Microsoft page: the real @azure/msal-browser v5 PublicClientApplication (popup through the v5 redirect bridge
// page) with MsalTokenSource, OAuthBearerTokenProvider and ReactiveFetchManager running in the page.
import { EventType, InteractionType, PublicClientApplication, version } from "@azure/msal-browser"
import { MsalTokenSource } from "../../dist/mod.js"
import { bindAuthorizeButton, errorFacts, probe, probeDecoy, wire } from "./page-common.js"

/** A pass-through view of the MSAL instance that records calls as booleans (never results). */
function observed(msal, sdk) {
    return {
        acquireTokenPopup(request) {
            sdk.popups++
            return msal.acquireTokenPopup(request)
        },
        async acquireTokenSilent(request) {
            const entry = {forceRefresh: request.forceRefresh === true, fromCache: undefined}
            sdk.silent.push(entry)
            const result = await msal.acquireTokenSilent(request)
            entry.fromCache = result.fromCache
            return result
        },
        getActiveAccount: () => msal.getActiveAccount(),
    }
}

const harness = {
    ready: true,
    sdk: {popups: 0, silent: []},
    interactionCallbacks: 0,

    async setup(config) {
        this.config = config
        // sessionStorage (MSAL's default): survives a reload of this tab, like an application's session.
        this.msal = new PublicClientApplication({
            auth: {clientId: config.clientId, authority: config.authority, redirectUri: config.redirectUri},
            cache: {cacheLocation: "sessionStorage"},
        })
        await this.msal.initialize()
        // The application's account choice: the account of an interactive result becomes active (MSAL's
        // documented pattern), and a reload restores it from MSAL's cache.
        this.msal.addEventCallback(event => {
            if ((event.eventType === EventType.LOGIN_SUCCESS || event.eventType === EventType.ACQUIRE_TOKEN_SUCCESS) && event.interactionType === InteractionType.Popup && event.payload?.account) {
                this.msal.setActiveAccount(event.payload.account)
            }
        })
        const restored = this.msal.getActiveAccount() !== null
        this.source = new MsalTokenSource(observed(this.msal, this.sdk), {
            scopes: config.scopes,
            ...(config.authority === undefined ? {} : {authority: config.authority}),
            account: () => this.msal.getActiveAccount(),
            ...(config.prompt === undefined ? {} : {prompt: config.prompt}),
            ...(config.loginHint === undefined ? {} : {loginHint: config.loginHint}),
            onInteractionRequired: () => { this.interactionCallbacks++ },
        })
        this.client = wire(this.source, config)
        return {sdkVersion: /^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version) ? version : "unknown", cachedAccounts: this.msal.getAllAccounts().length, activeAccountRestored: restored}
    },

    probe() {
        return probe(this.client, this.config)
    },

    probeDecoy() {
        return probeDecoy(this.client, this.config.decoy)
    },

    /**
     * The renewal the provider requests after an API rejects a token: `rejectedToken` = the token last sent.
     * (A valid Graph token cannot be made to fail on demand, so this asks the source directly.)
     */
    async renewAfterRejection() {
        const before = this.sdk.silent.length
        const rejectedToken = this.client.recorder.lastSent()
        if (rejectedToken === undefined) return {ok: false, error: {name: "Error", code: "no_token_sent"}}
        try {
            const token = await this.source.getAccessToken({signal: AbortSignal.timeout(30_000), rejectedToken})
            return {ok: true, calls: this.sdk.silent.slice(before), changed: !this.client.recorder.wasSent(token.token)}
        } catch (error) {
            return {ok: false, error: errorFacts(error), calls: this.sdk.silent.slice(before)}
        }
    },

    /** Application logout of this resource: clear the account choice, then the manager's local logout. */
    async forget() {
        try {
            this.msal.setActiveAccount(null)
            await this.client.manager.logout()
            return {ok: true, cachedAccounts: this.msal.getAllAccounts().length}
        } catch (error) {
            return {ok: false, error: errorFacts(error?.errors?.[0] ?? error)}
        }
    },
}

bindAuthorizeButton(harness, () => harness.source.authorize())
globalThis.harness = harness
