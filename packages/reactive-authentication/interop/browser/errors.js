// Error facts that may leave a browser-SDK page: an allowlisted class name and an allowlisted error code, nothing
// else. Provider SDKs put server-supplied strings into `name`, `code`, `errorCode` and `error`; a plausible-looking
// value can still carry an account name or a credential, so only the explicit constants below are ever reported.
// Unknown values become a bare "Error" without a code. No imports: bundled into the pages and used by the runner.

/** Error class names that carry no data (the library's, the platform's, and MSAL's). */
export const safeErrorNames = new Set([
    "Error", "TypeError", "AbortError", "TimeoutError", "AggregateError",
    // @solid/reactive-authentication
    "ReactiveAuthenticationError", "InteractionRequiredError", "AuthorizationFailedError", "SessionSupersededError",
    // @azure/msal-browser / msal-common
    "AuthError", "BrowserAuthError", "BrowserConfigurationAuthError", "ClientAuthError", "ClientConfigurationError",
    "InteractionRequiredAuthError", "ServerError", "NetworkError", "CacheError",
])

/** Registered OAuth 2.0 / OpenID Connect / RFC 6750 error codes. */
const oauthCodes = [
    "invalid_request", "invalid_client", "invalid_grant", "unauthorized_client", "unsupported_grant_type", "invalid_scope",
    "access_denied", "unsupported_response_type", "server_error", "temporarily_unavailable", "interaction_required",
    "login_required", "account_selection_required", "consent_required", "invalid_token", "insufficient_scope",
]

/** Google Identity Services `error_callback` types, and the library's own AuthorizationFailedError codes. */
const gisAndLibraryCodes = [
    "popup_failed_to_open", "popup_closed", "unknown",
    "interaction_in_progress", "partial_grant", "sdk_error", "invalid_token_response",
    "revocation_timeout", "revocation_failed", "revocation_unavailable",
]

/** MSAL error codes the adapters can meet (msal-browser BrowserAuthErrorCodes, msal-common Client/InteractionRequired codes). */
const msalCodes = [
    "user_cancelled", "user_canceled", "popup_window_error", "empty_window_error", "timed_out", "empty_response",
    "interaction_in_progress_cancelled", "block_nested_popups", "redirect_bridge_empty_response", "hash_empty_error",
    "no_state_in_hash", "hash_does_not_contain_known_properties", "unable_to_parse_state", "state_interaction_type_mismatch",
    "no_account_error", "silent_prompt_value_error", "no_network_connectivity", "post_request_failed", "get_request_failed",
    "failed_to_parse_response", "uninitialized_public_client_application", "endpoints_resolution_error", "network_error",
    "openid_config_error", "state_mismatch", "state_not_found", "nonce_mismatch", "no_account_in_silent_request",
    "no_account_found", "token_refresh_required", "no_tokens_found", "native_account_unavailable", "refresh_token_expired",
    "ui_not_allowed", "bad_token", "interrupted_user", "unexpected_error",
]

/** The harness's own codes. */
const harnessCodes = ["no_token_sent"]

export const safeErrorCodes = new Set([...oauthCodes, ...gisAndLibraryCodes, ...msalCodes, ...harnessCodes])

/** An error reduced to an allowlisted class name and, when it has one, an allowlisted code. */
export function errorFacts(error) {
    const name = typeof error?.name === "string" && safeErrorNames.has(error.name) ? error.name : "Error"
    const code = [error?.code, error?.errorCode, error?.error].find(c => typeof c === "string" && safeErrorCodes.has(c))
    return code === undefined ? {name} : {name, code}
}

/** Authorization header schemes that may be reported (anything else is "other"). */
const safeSchemes = new Set(["Bearer", "DPoP", "Basic"])
export const schemeFact = scheme => scheme === undefined ? undefined : safeSchemes.has(scheme) ? scheme : "other"

/** Codes meaning the provider needs the user (used to fail closed in session mode). */
export const interactionCodes = new Set(["interaction_required", "login_required", "consent_required", "account_selection_required", "no_tokens_found", "ui_not_allowed", "native_account_unavailable", "refresh_token_expired", "bad_token"])
