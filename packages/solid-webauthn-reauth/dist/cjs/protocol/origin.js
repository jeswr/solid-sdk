"use strict";
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Samu Lang
// Copyright (c) 2026 Jesse Wright
// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate; see docs/MODEL-PROVENANCE.md
Object.defineProperty(exports, "__esModule", { value: true });
exports.normaliseOrigin = normaliseOrigin;
exports.allowedOriginsFor = allowedOriginsFor;
exports.isAllowedOrigin = isAllowedOrigin;
/**
 * Origin helpers — the phishing-resistance gate.
 *
 * `clientDataJSON.origin` (an origin tuple) is checked against the origins
 * allowed for a `client_id` (a Client ID Document URI). They are different kinds
 * of value and must never be string-compared directly. These helpers are the
 * server/IdP side of the contract; the client never performs the check (the
 * browser enforces the RP-ID/origin binding), but they are shipped in this
 * shared layer so the verifier reuses the identical normalisation.
 */
const DEFAULT_PORTS = {
    "http:": "80",
    "https:": "443",
};
/**
 * Normalise an origin string to `scheme://host[:port]` — lowercased scheme +
 * host, default port elided, no path/query/fragment, no trailing slash.
 *
 * @throws if `origin` is not a parseable absolute URL.
 */
function normaliseOrigin(origin) {
    const url = new URL(origin);
    const scheme = url.protocol.toLowerCase();
    const host = url.hostname.toLowerCase();
    const defaultPort = DEFAULT_PORTS[scheme];
    const port = url.port && url.port !== defaultPort ? `:${url.port}` : "";
    return `${scheme}//${host}${port}`;
}
/**
 * The allowed-origin set for a `client_id`.
 *
 * **v1 rule:** exactly the single normalised origin of the `client_id` URI.
 * Origins declared inside the Client ID Document are out of scope for v1 (they
 * need a proof-of-control mechanism — deferred to v2).
 *
 * @throws if `clientId` is not a parseable absolute URL.
 */
function allowedOriginsFor(clientId) {
    return [normaliseOrigin(new URL(clientId).origin)];
}
/**
 * Whether `origin` (a WebAuthn `clientDataJSON.origin` tuple) is in the
 * allowed-origin set for `clientId`. Both sides are normalised before the
 * comparison, so this is the correct phishing-resistance check — never a raw
 * `origin === clientId` string compare.
 *
 * Fail-closed: a malformed `origin` or `clientId` returns `false` rather than
 * throwing, so a verifier can treat any parse failure as "not allowed".
 */
function isAllowedOrigin(origin, clientId) {
    let normalised;
    try {
        normalised = normaliseOrigin(origin);
    }
    catch {
        return false;
    }
    let allowed;
    try {
        allowed = allowedOriginsFor(clientId);
    }
    catch {
        return false;
    }
    return allowed.includes(normalised);
}
//# sourceMappingURL=origin.js.map