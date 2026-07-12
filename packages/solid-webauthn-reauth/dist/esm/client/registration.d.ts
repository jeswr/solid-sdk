import type { RegistrationResponseJSON } from "../protocol/index.js";
/**
 * A `fetch`-shaped function that carries the user's **authenticated account
 * session** (the credential obtained from a normal Solid-OIDC login). Passkey
 * registration binds a new credential to the account, so both OP endpoints
 * (`register-options`, `register`) are authenticated — the caller supplies this
 * seam so the library never touches the login credential itself.
 */
export type AuthenticatedFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
/** Options for {@link registerPasskey}. */
export interface RegisterPasskeyOptions {
    /**
     * The OP's authenticated **register-options** endpoint — returns the WebAuthn
     * `PublicKeyCredentialCreationOptionsJSON` for `navigator.credentials.create`.
     */
    registerOptionsUrl: string | URL;
    /**
     * The OP's authenticated **register** endpoint — stores the created
     * credential's public key against ⟨WebID, ClientID⟩.
     */
    registerUrl: string | URL;
    /**
     * The application's Solid-OIDC **Client ID Document URI** — the `client_id`
     * the passkey binds to. It is sent to both endpoints so the OP records the
     * credential under this client and derives its allowed origin. Required: the
     * origin binding is the phishing-resistance property, so it is never inferred.
     */
    clientId: string | URL;
    /**
     * The **authenticated** fetch carrying the post-login account session.
     * Required — see {@link AuthenticatedFetch}.
     */
    fetch: AuthenticatedFetch;
    /**
     * The account WebID being registered. Optional — omit to let the OP derive it
     * from the authenticated session; supply it when the account has several.
     */
    webId?: string | URL;
    /**
     * Force a **resident / discoverable** credential (default `true`). The
     * redirect-free re-auth flow is discoverable — the assertion-options endpoint
     * sends an empty `allowCredentials`, so the authenticator must find the
     * passkey with no hint. A resident key is therefore required for re-auth to
     * work; only set this to `false` for a deployment that always sends
     * `allowCredentials`.
     */
    requireResidentKey?: boolean;
    /** Abort signal forwarded to both HTTP requests. */
    signal?: AbortSignal;
}
/** The outcome of a successful {@link registerPasskey}. */
export interface RegisterPasskeyResult {
    /** The WebAuthn registration response the authenticator produced. */
    credential: RegistrationResponseJSON;
    /** The parsed OP register-endpoint response body, or `undefined` if empty. */
    registration: unknown;
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
export declare function registerPasskey(options: RegisterPasskeyOptions): Promise<RegisterPasskeyResult>;
//# sourceMappingURL=registration.d.ts.map