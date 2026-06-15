import { type AuthCodeSession, type ClientRegistration, type LoopbackListener, type OidcProviderMetadata } from "./authCode.js";
/** What a consumer's globalSetup must hand the driver: a logged-in account cookie + the linked WebID. */
export interface HeadlessOidcContext {
    /** CSS base URL, e.g. `http://localhost:3096/`. */
    readonly base: string;
    /** The `_session=…` (or similar) account cookie captured after a password login. */
    readonly cookie: string;
    /** The WebID linked to that account. */
    readonly webId: string;
}
/**
 * Drive the in-flight CSS OIDC interaction headlessly as the logged-in user, returning the
 * authorization `code` + `state` delivered to the loopback listener. Mirrors the CSS v8 `.account`
 * prompt API: `login`/`select_account` → POST `controls.oidc.webId`; `consent` → POST
 * `controls.oidc.consent`; follow each step's `location` until the loopback redirect fires.
 */
export declare function driveHeadlessOidc(ctx: HeadlessOidcContext, authUrl: string, listener: Pick<LoopbackListener, "redirectUri" | "waitForCode">): Promise<{
    code: string;
    state: string;
}>;
/**
 * Run one full headless user-delegated login and return the resulting DPoP-bound {@link AuthCodeSession}.
 * Defaults `prompt=consent` because CSS only issues a refresh token (`offline_access`) when consent
 * is explicitly requested (discovered live in the SDK spec).
 */
export declare function headlessLogin(ctx: HeadlessOidcContext, meta: OidcProviderMetadata, client: ClientRegistration, listener: LoopbackListener, opts?: {
    prompt?: "consent" | "login";
}): Promise<AuthCodeSession>;
//# sourceMappingURL=testing.d.ts.map