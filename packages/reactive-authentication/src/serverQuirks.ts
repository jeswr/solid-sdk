import * as oauth from "oauth4webapi"

/*
 * Compatibility exceptions for deployed servers that deviate from the specifications, retained from upstream.
 * They apply automatically, but only to the exact issuer origins listed below, and can be switched off with
 * `serverQuirks: false`. All other issuers get strict validation. Remove each once the server is fixed.
 *
 * - ESS (`https://login.inrupt.com`): client_secret_basic without URL-encoding; `interaction_required`
 *   without the RFC 9207 `iss` parameter treated as needing interaction (FEEDBACK-443, FEEDBACK-445).
 * - NSS deployments (`https://datapod.igrant.io`, `https://solidweb.org`): ID tokens without `nonce`.
 */

const ESS = new Set(["https://login.inrupt.com"])
const NSS_WITHOUT_NONCE = new Set(["https://datapod.igrant.io", "https://solidweb.org"])

function originOf(issuer: string): string | undefined {
    try {
        return new URL(issuer).origin
    } catch {
        return undefined
    }
}

function isEss(issuer: string, enabled: boolean): boolean {
    return enabled && ESS.has(originOf(issuer) ?? "")
}

/**
 * ESS returns `interaction_required` without the RFC 9207 `iss` parameter.
 *
 * @see Bug report at https://inrupt.atlassian.net/servicedesk/customer/portal/4/FEEDBACK-445
 * @see Bug repro at https://gist.github.com/langsamu/ac55045a6ddc5893000b722429146b3a#file-iss_missing_error_callback-html
 * @see Spec https://www.rfc-editor.org/rfc/rfc9207.html#name-response-parameter-iss
 */
export function isEssMissingIssInteractionNeeded(e: unknown, issuer: string, enabled = true): boolean {
    if (!isEss(issuer, enabled)) return false
    try {
        return ((((e as oauth.OperationProcessingError).cause as any).parameters) as URLSearchParams).get("error") === "interaction_required"
    } catch {
        return false
    }
}

/**
 * A variation of oauth4webapi's client_secret_basic that does not URL-encode the ID and secret.
 *
 * @remarks PodSpaces (ESS) fails when the spec is followed.
 * @see Original code at https://github.com/panva/oauth4webapi/blob/b914d175a58a1738b65a360dc2f28d6c0f88a720/src/index.ts#L1777
 * @see Bug report at https://inrupt.atlassian.net/servicedesk/customer/portal/4/FEEDBACK-443
 * @see Bug repro at https://gist.github.com/langsamu/ac55045a6ddc5893000b722429146b3a#file-podspaces_client_auth_bug-html
 * @see Spec https://www.rfc-editor.org/rfc/rfc6749.html#section-2.3.1
 */
function noUrlEncodeClientSecretBasic(clientSecret: string): oauth.ClientAuth {
    return (_, client, __, headers) => {
        headers.set("Authorization", `Basic ${btoa(`${client.client_id}:${clientSecret}`)}`)
    }
}

/** Client authentication per the client's registered `token_endpoint_auth_method`. */
export function clientAuthFor(issuer: string, client: oauth.Client, quirks = true): oauth.ClientAuth {
    const secret = client.client_secret as string | undefined
    switch (client.token_endpoint_auth_method) {
        case "client_secret_basic":
            // TODO: Eliminate once ESS bug fixed
            return isEss(issuer, quirks) ? noUrlEncodeClientSecretBasic(secret!) : oauth.ClientSecretBasic(secret!)
        case "client_secret_post":
            return oauth.ClientSecretPost(secret!)
        default:
            return secret === undefined ? oauth.None() : oauth.ClientSecretBasic(secret)
    }
}

/** NSS deployments that do not echo the ID token `nonce`. */
export function expectedNonce(issuer: string, nonce: string, quirks = true): string | typeof oauth.expectNoNonce {
    if (quirks && NSS_WITHOUT_NONCE.has(originOf(issuer) ?? "")) {
        return oauth.expectNoNonce
    }
    return nonce
}
