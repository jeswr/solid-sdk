import * as oauth from "oauth4webapi"
import type { SubjectCredential } from "../credentials/CredentialSource.js"
import { ReactiveAuthenticationError } from "../ReactiveAuthenticationError.js"
import { oauthOptions, secureFetch, type HttpOptions } from "../transport.js"
import { LWS_CONFIGURATION, TOKEN_EXCHANGE_GRANT, tokenTypeAliases } from "./constants.js"

/**
 * Fetches LWS authorization server metadata (lws10-core "Authorization Server Metadata").
 *
 * The draft only says the document is at the path `/.well-known/lws-configuration`; for issuers with a
 * path we insert the well-known segment before it, as RFC 8414 §3.1 does. oauth4webapi validates that the
 * document's `issuer` equals `as_uri`.
 */
export async function discoverLwsAuthorizationServer(issuer: URL, signal: AbortSignal, http?: HttpOptions): Promise<oauth.AuthorizationServer> {
    const url = new URL(issuer)
    url.pathname = issuer.pathname === "/" ? LWS_CONFIGURATION : `${LWS_CONFIGURATION}${issuer.pathname.replace(/\/$/, "")}`
    const response = await secureFetch(url, {signal, headers: {accept: "application/json"}}, http)
    return await oauth.processDiscoveryResponse(issuer, response)
}

/**
 * RFC 8693 token exchange as profiled by lws10-core: `resource` is the realm, the subject token is the
 * authentication credential. The response must be a Bearer access token.
 */
export async function exchangeToken(as: oauth.AuthorizationServer, credential: SubjectCredential, realm: URL, signal: AbortSignal, http?: HttpOptions): Promise<oauth.TokenEndpointResponse> {
    assertAdvertised(as, "grant_types_supported", [TOKEN_EXCHANGE_GRANT])
    assertAdvertised(as, "subject_token_types_supported", tokenTypeAliases[credential.tokenType] ?? [credential.tokenType])

    const client: oauth.Client = {client_id: credential.clientId}
    const parameters = new URLSearchParams({
        resource: realm.href,
        subject_token: credential.token,
        subject_token_type: credential.tokenType,
    })

    const response = await oauth.genericTokenEndpointRequest(as, client, oauth.None(), TOKEN_EXCHANGE_GRANT, parameters, oauthOptions(http, signal))
    const result = await oauth.processGenericTokenEndpointResponse(as, client, response)
    if (result.token_type !== "bearer") {
        throw new ReactiveAuthenticationError(`LWS token exchange returned token_type ${result.token_type}, expected Bearer`)
    }
    return result
}

/** Metadata lists are optional (and only SHOULD be advertised); when present they must include a value. */
function assertAdvertised(as: oauth.AuthorizationServer, field: string, accepted: readonly string[]): void {
    const advertised = as[field]
    if (advertised === undefined) return
    if (!Array.isArray(advertised) || !accepted.some(v => advertised.includes(v))) {
        throw new ReactiveAuthenticationError(`Authorization server ${as.issuer} does not support ${accepted[0]} (${field})`)
    }
}
