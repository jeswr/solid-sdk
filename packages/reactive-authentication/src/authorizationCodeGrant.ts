import * as oauth from "oauth4webapi"
import type { CodeProvider } from "./CodeProvider.js"
import { withDPoPNonceRetry } from "./dpopNonce.js"
import { clientAuthFor, expectedNonce, isEssMissingIssInteractionNeeded } from "./serverQuirks.js"
import { oauthOptions, type HttpOptions } from "./transport.js"

export interface AuthorizationCodeGrantOptions {
    readonly authorizationServer: oauth.AuthorizationServer
    readonly client: oauth.Client
    readonly redirectUri: string
    readonly codeProvider: CodeProvider
    readonly scopes: readonly string[]
    readonly signal: AbortSignal
    readonly dpop?: oauth.DPoPHandle
    readonly http?: HttpOptions

    /** Extra authorization request parameters, e.g. `login_hint`. Protocol parameters cannot be overridden. */
    readonly parameters?: Readonly<Record<string, string>>

    /**
     * Use `prompt=consent` for the interactive attempt when `offline_access` is requested, as OpenID Connect
     * Core §11 requires unless the provider has other grounds to permit offline access.
     * @defaultValue true
     */
    readonly consentForOfflineAccess?: boolean

    /** Apply the compatibility exceptions in `serverQuirks.ts` for the listed issuers. @defaultValue true */
    readonly serverQuirks?: boolean
}

const protectedParameters = new Set(["client_id", "redirect_uri", "response_type", "scope", "state", "nonce", "code_challenge", "code_challenge_method", "prompt"])
const interactionErrors = new Set(["interaction_required", "consent_required", "login_required", "account_selection_required"])

/**
 * OAuth 2.0 authorization code grant with PKCE, state and nonce, fresh for every authorization request.
 *
 * A silent attempt (`prompt=none`) is made first; if the provider needs user interaction, an interactive
 * attempt follows. The code provider (popup, redirect, service-worker bridge…) supplies the redirect URL.
 */
export async function authorizationCodeGrant(options: AuthorizationCodeGrantOptions): Promise<oauth.TokenEndpointResponse> {
    for (const name of Object.keys(options.parameters ?? {})) {
        if (protectedParameters.has(name)) throw new TypeError(`Authorization parameter ${name} cannot be overridden`)
    }

    try {
        return await attempt(options, "none")
    } catch (e) {
        if (!needsInteraction(e, options.authorizationServer.issuer, options.serverQuirks ?? true)) throw e
    }

    const offline = options.scopes.includes("offline_access") && options.consentForOfflineAccess !== false
    return await attempt(options, offline ? "consent" : undefined)
}

async function attempt(options: AuthorizationCodeGrantOptions, prompt: string | undefined): Promise<oauth.TokenEndpointResponse> {
    const {authorizationServer: as, client, signal} = options
    options.signal.throwIfAborted()

    const state = oauth.generateRandomState()
    const nonce = oauth.generateRandomNonce()
    const codeVerifier = oauth.generateRandomCodeVerifier()
    const pkce = pkceMethod(as)

    const url = new URL(as.authorization_endpoint!)
    const params = url.searchParams
    params.set("client_id", client.client_id)
    params.set("redirect_uri", options.redirectUri)
    params.set("response_type", "code")
    params.set("scope", options.scopes.join(" "))
    params.set("state", state)
    params.set("nonce", nonce)
    params.set("code_challenge_method", pkce)
    params.set("code_challenge", pkce === "S256" ? await oauth.calculatePKCECodeChallenge(codeVerifier) : codeVerifier)
    if (prompt !== undefined) params.set("prompt", prompt)
    for (const [name, value] of Object.entries(options.parameters ?? {})) params.set(name, value)

    let callbackParameters: URLSearchParams
    {
        using response = await options.codeProvider.getCode(url, signal)
        callbackParameters = oauth.validateAuthResponse(as, client, new URL(response.value), state)
    }

    const requestOptions = {...oauthOptions(options.http, signal), ...(options.dpop === undefined ? {} : {DPoP: options.dpop})}
    return await withDPoPNonceRetry(async () => {
        const response = await oauth.authorizationCodeGrantRequest(as, client, clientAuthFor(as.issuer, client, options.serverQuirks ?? true), callbackParameters, options.redirectUri, codeVerifier, requestOptions)
        return await oauth.processAuthorizationCodeResponse(as, client, response, {
            expectedNonce: expectedNonce(as.issuer, nonce, options.serverQuirks ?? true),
            requireIdToken: options.scopes.includes("openid"),
        })
    })
}

/** S256 unless the server advertises only `plain`. */
function pkceMethod(as: oauth.AuthorizationServer): "S256" | "plain" {
    const methods = as.code_challenge_methods_supported
    return methods !== undefined && !methods.includes("S256") && methods.includes("plain") ? "plain" : "S256"
}

function needsInteraction(e: unknown, issuer: string, quirks: boolean): boolean {
    return (e instanceof oauth.AuthorizationResponseError && interactionErrors.has(e.error)) ||
        // TODO: Eliminate once ESS bug fixed
        isEssMissingIssInteractionNeeded(e, issuer, quirks)
}
