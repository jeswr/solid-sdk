// Redaction for everything the harness prints or writes. Reports keep result metadata only; this is the last
// line of defence for error messages, which can quote URLs, headers or response bodies.
import { CheckError } from "./checkError.js";

/** Values registered at run time (secrets, passwords, account names, WebIDs of live accounts). */
const sensitive = new Set();

/** Registers a value that must never appear in output. Short values are ignored (they would redact noise). */
export function registerSensitive(value) {
  if (typeof value === "string" && value.length >= 4) sensitive.add(value);
}

const patterns = [
  // JWTs (access, ID and DPoP proofs) and JWE-like strings.
  [/\beyJ[\w-]{4,}\.[\w-]{4,}\.[\w-]*(?:\.[\w-]*){0,2}/g, "[jwt]"],
  // Authorization header values of any scheme.
  [/\b(Bearer|DPoP|Basic|Token)\s+[\w~+/.=-]{6,}/gi, "$1 [credential]"],
  // OAuth parameters in URLs, forms and JSON.
  [
    /\b(code|state|nonce|code_verifier|code_challenge|access_token|refresh_token|id_token|client_secret|password|session_state|assertion|subject_token)(["']?\s*[=:]\s*["']?)[^&"'\s,}]+/gi,
    "$1$2[redacted]",
  ],
  // Cookies.
  [/\b(set-cookie|cookie)(["']?\s*:\s*["']?)[^\n"']+/gi, "$1$2[redacted]"],
  // Email addresses.
  [/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, "[email]"],
];

/** Returns `text` with credentials, registered sensitive values and PII-shaped strings removed. */
export function redact(text) {
  let result = String(text);
  // Longest first, so a value containing another is removed whole.
  for (const value of [...sensitive].sort((a, b) => b.length - a.length))
    result = result.split(value).join("[sensitive]");
  for (const [pattern, replacement] of patterns) result = result.replace(pattern, replacement);
  return result;
}

/** A one-line, redacted description of an error and its causes (no stacks: they can quote request data). */
export function describeError(error) {
  const parts = [];
  for (let e = error, depth = 0; e !== undefined && e !== null && depth < 4; e = e.cause, depth++) {
    const name = typeof e === "object" && typeof e.name === "string" ? e.name : typeof e;
    const message = typeof e === "object" && "message" in e ? e.message : String(e);
    const code = typeof e === "object" && typeof e.code === "string" ? ` [${e.code}]` : "";
    parts.push(`${name}${code}: ${message}`);
    if (e instanceof AggregateError)
      parts.push(...e.errors.slice(0, 3).map((inner) => describeError(inner)));
  }
  return redact(parts.join(" <- ")).slice(0, 600);
}

/** OAuth 2.0 / OpenID Connect / RFC 6750 / RFC 9449 error codes (registered values, safe to report). */
const oauthErrors = new Set([
  "invalid_request",
  "invalid_client",
  "invalid_grant",
  "unauthorized_client",
  "unsupported_grant_type",
  "invalid_scope",
  "access_denied",
  "unsupported_response_type",
  "server_error",
  "temporarily_unavailable",
  "interaction_required",
  "login_required",
  "account_selection_required",
  "consent_required",
  "invalid_request_uri",
  "invalid_request_object",
  "request_not_supported",
  "request_uri_not_supported",
  "registration_not_supported",
  "invalid_token",
  "insufficient_scope",
  "invalid_dpop_proof",
  "use_dpop_nonce",
  "invalid_redirect_uri",
  "invalid_client_metadata",
  "interaction_in_progress",
  "partial_grant",
  "popup_closed",
  "popup_failed_to_open",
  "revocation_timeout",
]);

/** Node.js / undici network error codes worth reporting (no data in them). */
const nodeErrors = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EPIPE",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_SOCKET",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "CERT_HAS_EXPIRED",
  "ABORT_ERR",
]);

/** Error classes whose names carry no data. */
const safeNames = new Set([
  "AbortError",
  "TimeoutError",
  "TypeError",
  "ReactiveAuthenticationError",
  "SessionSupersededError",
  "InteractionRequiredError",
  "AuthorizationFailedError",
  "CodeRequestCancelledError",
  "IssuerRequestCancelledError",
  "WebIdRequestCancelledError",
  "UnrecognizedRequestUri",
  "OperationProcessingError",
  "ResponseBodyError",
  "AuthorizationResponseError",
  "WWWAuthenticateChallengeError",
  "AggregateError",
  "Error",
]);

/**
 * For live targets: a description built only from allowlisted parts — messages of the harness's own
 * {@link CheckError}s (which never embed sensitive values; see ScenarioContext.same), allowlisted error class
 * names, and error codes from explicit sets (registered OAuth codes, Node network codes). Provider messages,
 * URLs, response bodies and unknown codes are dropped entirely.
 */
export function safeDescription(error) {
  const parts = [];
  for (let e = error, depth = 0; e !== undefined && e !== null && depth < 4; e = e.cause, depth++) {
    if (e instanceof CheckError) {
      parts.push(`CheckError: ${redact(e.message)}`);
      continue;
    }
    if (typeof e !== "object") {
      parts.push(typeof e);
      continue;
    }
    const name = safeNames.has(e.name) ? e.name : "Error";
    const code = [e.error, e.code].find(
      (c) => typeof c === "string" && (oauthErrors.has(c) || nodeErrors.has(c)),
    );
    const status =
      Number.isInteger(e.status) && e.status >= 100 && e.status < 600 ? ` HTTP ${e.status}` : "";
    parts.push(`${name}${code ? ` [${code}]` : ""}${status}`);
  }
  return parts.join(" <- ") || "unknown error";
}
