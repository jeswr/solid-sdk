/**
 * Normalise an origin string to `scheme://host[:port]` — lowercased scheme +
 * host, default port elided, no path/query/fragment, no trailing slash.
 *
 * @throws if `origin` is not a parseable absolute URL.
 */
export declare function normaliseOrigin(origin: string): string;
/**
 * The allowed-origin set for a `client_id`.
 *
 * **v1 rule:** exactly the single normalised origin of the `client_id` URI.
 * Origins declared inside the Client ID Document are out of scope for v1 (they
 * need a proof-of-control mechanism — deferred to v2).
 *
 * @throws if `clientId` is not a parseable absolute URL.
 */
export declare function allowedOriginsFor(clientId: string): string[];
/**
 * Whether `origin` (a WebAuthn `clientDataJSON.origin` tuple) is in the
 * allowed-origin set for `clientId`. Both sides are normalised before the
 * comparison, so this is the correct phishing-resistance check — never a raw
 * `origin === clientId` string compare.
 *
 * Fail-closed: a malformed `origin` or `clientId` returns `false` rather than
 * throwing, so a verifier can treat any parse failure as "not allowed".
 */
export declare function isAllowedOrigin(origin: string, clientId: string): boolean;
//# sourceMappingURL=origin.d.ts.map