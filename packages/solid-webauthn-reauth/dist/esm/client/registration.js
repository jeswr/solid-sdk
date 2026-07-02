// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Samu Lang
// Copyright (c) 2026 Jesse Wright
// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate; see docs/MODEL-PROVENANCE.md
import { startRegistration } from "@simplewebauthn/browser";
import { BUNDLE_VERSION } from "../protocol/index.js";
/** Coerce a `string | URL` to an absolute-URL `href`, failing closed. */
function requireAbsoluteUrl(value, field) {
    try {
        return new URL(value).href;
    }
    catch {
        throw new Error(`registerPasskey: \`${field}\` must be an absolute URL`);
    }
}
/**
 * Register an app-origin-bound passkey with the user's OpenID Provider, so the
 * app can later {@link WebAuthnTokenProvider re-authenticate without a redirect}.
 *
 * Run this **once per app+device, after a normal Solid-OIDC login** (the caller's
 * `fetch` carries that session). The app is the WebAuthn Relying Party: the
 * `navigator.credentials.create` ceremony runs here, so the created credential is
 * bound to this app's origin, and the OP stores its public key against
 * ⟨WebID, ClientID⟩.
 *
 * Fail-closed: any non-2xx OP response, or a non-object options payload, throws
 * before/around the ceremony rather than proceeding with partial state.
 *
 * @throws {Error} on invalid URLs, a failed OP request, or a malformed
 *   options payload. The `navigator.credentials.create` ceremony may also throw
 *   (`NotAllowedError`, user cancellation, etc.) — that propagates unchanged.
 */
export async function registerPasskey(options) {
    const registerOptionsUrl = requireAbsoluteUrl(options.registerOptionsUrl, "registerOptionsUrl");
    const registerUrl = requireAbsoluteUrl(options.registerUrl, "registerUrl");
    const clientId = requireAbsoluteUrl(options.clientId, "clientId");
    const webId = options.webId !== undefined ? requireAbsoluteUrl(options.webId, "webId") : undefined;
    const requireResidentKey = options.requireResidentKey ?? true;
    const { fetch: authFetch, signal } = options;
    // (1) Fetch the OP's WebAuthn creation options (authenticated).
    const optionsResponse = await authFetch(registerOptionsUrl, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ clientId, ...(webId ? { webId } : {}) }),
        ...(signal ? { signal } : {}),
    });
    if (!optionsResponse.ok) {
        throw new Error(`registerPasskey: register-options request failed: ${optionsResponse.status} ${optionsResponse.statusText}`);
    }
    const rawOptions = (await optionsResponse.json());
    if (typeof rawOptions !== "object" || rawOptions === null) {
        throw new Error("registerPasskey: register-options response was not an object");
    }
    const optionsJSON = rawOptions;
    // Force a resident/discoverable credential without mutating the OP's payload:
    // the discoverable re-auth flow needs it (empty `allowCredentials`).
    const creationOptions = requireResidentKey
        ? {
            ...optionsJSON,
            authenticatorSelection: {
                ...optionsJSON.authenticatorSelection,
                residentKey: "required",
                requireResidentKey: true,
            },
        }
        : optionsJSON;
    // (2) Run the WebAuthn creation ceremony — the app is the Relying Party.
    const credential = await startRegistration({ optionsJSON: creationOptions });
    // (3) Send the attestation to the OP to store (authenticated).
    const registerResponse = await authFetch(registerUrl, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
            version: BUNDLE_VERSION,
            credential,
            clientId,
            ...(webId ? { webId } : {}),
        }),
        ...(signal ? { signal } : {}),
    });
    if (!registerResponse.ok) {
        throw new Error(`registerPasskey: register request failed: ${registerResponse.status} ${registerResponse.statusText}`);
    }
    const registration = await parseJsonBody(registerResponse);
    return { credential, registration };
}
/** Parse a JSON body if present; tolerate an empty body (e.g. `201` no content). */
async function parseJsonBody(response) {
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("json")) {
        return undefined;
    }
    try {
        return (await response.json());
    }
    catch {
        return undefined;
    }
}
//# sourceMappingURL=registration.js.map