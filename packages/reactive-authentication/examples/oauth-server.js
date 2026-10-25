// Server-side (Node.js) confidential client, e.g. a Google "Web application" client or a backend-for-frontend.
// The client secret stays on the server. Tokens belong to one user, so create one client per application
// session — never a process-wide singleton, which would hand the first user's tokens to everyone.
import { CredentialBoundary, OAuthBearerTokenProvider, OAuthCodeSource, ReactiveFetchManager } from "@solid/reactive-authentication"

const drive = new CredentialBoundary(["https://www.googleapis.com/drive/"])

/**
 * One OAuth client per application session.
 *
 * @param {string} sessionId your framework's authenticated session identifier (also the cache `account`)
 * @param {{getCode(url: URL, signal: AbortSignal): Promise<Disposable & {value: string}>}} codeProvider
 *   your framework's bridge: sends this session's user to `url` (e.g. a redirect response) and resolves with
 *   the full callback URL that *the same authenticated application session* received on your redirect route.
 *   It must reject at once if `signal` is already aborted and when it aborts later, and remove any pending
 *   state on success, error and timeout. The library still checks state, PKCE, issuer and the redirect URI.
 */
export function createGoogleClient(sessionId, codeProvider) {
    const source = new OAuthCodeSource({
        issuer: "https://accounts.google.com",
        clientId: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET, // refused in browsers and workers
        redirectUri: "https://app.example/oauth/callback",
        scopes: ["openid", "email", "https://www.googleapis.com/auth/drive.readonly"],
        parameters: {access_type: "offline"},          // Google issues refresh tokens this way
        account: sessionId,
        codeProvider,
    })
    const manager = new ReactiveFetchManager({providers: [new OAuthBearerTokenProvider(source, {resources: drive})], boundary: drive})
    return {manager, source, logout: () => manager.logout()}
}
