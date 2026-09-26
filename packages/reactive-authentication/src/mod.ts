/**
 * Reactive authentication: upgrade `fetch` requests with credentials when a server answers 401.
 *
 * This entry point has no DOM dependencies. Custom elements live in `@solid/reactive-authentication/elements`
 * (define them with `@solid/reactive-authentication/registerElements`), service-worker helpers in
 * `@solid/reactive-authentication/service-worker`.
 *
 * @module
 */

// Core
export * from "./challenge.js"
export * from "./CredentialBoundary.js"
export * from "./AutomaticCredentialBoundary.js"
export * from "./ReactiveAuthenticationClient.js"
export * from "./ReactiveFetchManager.js"
export * from "./ReactiveFetchWorkerManager.js"
export * from "./SessionFence.js"
export * from "./FencedCache.js"
export * from "./TokenProvider.js"
export * from "./transport.js"
export { contextKey, withLock } from "./locks.js"
export { isWithin } from "./url.js"

// Errors
export * from "./ReactiveAuthenticationError.js"
export * from "./CodeRequestCancelledError.js"
export * from "./IssuerRequestCancelledError.js"
export * from "./WebIdRequestCancelledError.js"
export * from "./SessionSupersededError.js"
export * from "./UnrecognizedRequestUri.js"

// Context and caching
export * from "./ContextKey.js"
export * from "./StorageContext.js"
export * from "./CachingIssuerProvider.js"
export * from "./CachingAuthorizationServerProvider.js"
export * from "./CachingClientProvider.js"
export * from "./createBrowserCaches.js"

// OAuth / OpenID Connect / Solid-OIDC
export * from "./AuthorizationServerProvider.js"
export * from "./ClientProvider.js"
export * from "./CodeProvider.js"
export * from "./IssuerProvider.js"
export * from "./XASProvider.js"
export * from "./PatternIssuerProvider.js"
export * from "./IssuerHint.js"
export * from "./WebIdIssuerProvider.js"
export * from "./DynamicRegistrationClientProvider.js"
export * from "./ClientIdClientProvider.js"
export * from "./supportsOfflineAccess.js"
export * from "./authorizationCodeGrant.js"
export * from "./OidcSession.js"
export * from "./Identity.js"
export * from "./DPoPTokenProvider.js"
export * from "./SolidUmaTokenProvider.js"
export * from "./ClientCredentialsTokenProvider.js"
export { issuersFromWebId, webIdTrustsIssuer, sameIssuer } from "./webId.js"

// LWS
export * from "./lws/constants.js"
export * from "./lws/LwsTokenProvider.js"
export * from "./lws/tokenExchange.js"
export * from "./credentials/CredentialSource.js"
export * from "./credentials/OidcIdTokenSource.js"
export * from "./credentials/SelfIssuedJwtSource.js"
export * from "./credentials/didKey.js"
export * from "./credentials/SamlAssertionSource.js"
