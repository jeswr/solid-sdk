// AUTHORED-BY Claude Fable 5
//
// @jeswr/solid-auth-core — public surface.
//
// The ONE shared, framework-free Solid login/auth library for the @jeswr suite
// (shared-logic upstreaming review, P0.3). Apps call `createSolidAuth(config)`
// and stop hand-rolling token providers / session glue; the login-stall deadlock
// class (suite-tracker-8575) is unrepresentable by construction — see
// ./controller.ts and ./pristine.ts. React apps additionally mount the
// `@jeswr/solid-auth-core/react` SessionProvider.

// ── The keystone factory + the engine's exported pieces ─────────────────────
export {
  type AllowedOriginsInputs,
  AmbiguousIssuerError,
  type ChooseIssuerCallback,
  computeAllowedOrigins,
  createSolidAuth,
  htuOf,
  InvalidWebIdError,
  isOriginAllowed,
  isUseDpopNonceChallenge,
  type LiveSession,
  MissingAuthFlowError,
  NoSolidIssuerError,
  parseWwwAuthenticate,
  type SolidAuthConfig,
  type TokenProvider,
  validateWebId,
  WebIdDPoPTokenProvider,
} from "./controller.js";
// ── The pristine-fetch anchor (the login-stall unrepresentability mechanism) ─
export { brandFetchWrapper, PRISTINE_BASE, resolvePristineFetch } from "./pristine.js";
// ── The proactive authenticated-fetch wrapper (moved here from solid-elements) ─
export {
  __resetProactiveFetchForTests,
  deriveProactiveAllowedOrigins,
  type InstallProactiveAuthFetchOptions,
  installProactiveAuthFetch,
  isProviderOAuthRequest,
  isReactiveAuthResetError,
  type ProactiveAllowedOriginsInputs,
  type ProactiveFetchConfig,
  type ProactiveFetchInstall,
  type ProactiveFetchState,
  type ProactiveTokenProvider,
  proactiveAuthenticatedFetch,
} from "./proactive-fetch.js";
// ── The full-page-redirect (autologin) login primitives ─────────────────────
export {
  AUTOLOGIN_FRAGMENT_PREFIX,
  authErrorFrom,
  cleanedUrl,
  clearPersistedRedirectFlow,
  ES256_JWK_IMPORT_ALG,
  hasAuthCodeParams,
  hasAuthErrorParams,
  type OAuthClientRecord,
  type PersistedRedirectFlow,
  parseAutologinFragment,
  planRedirect,
  type RedirectFlowStorage,
  type RedirectPlan,
  type RedirectPlanInputs,
  readPersistedRedirectFlow,
  stripAuthCallbackParams,
  writePersistedRedirectFlow,
} from "./redirect.js";
// ── The session-store seam (local structural mirror — see src/session-store.ts) ─
export type {
  PersistedSession,
  SessionStore,
  TokenEndpointAuthMethod,
} from "./session-store.js";
// ── The seam types ──────────────────────────────────────────────────────────
export {
  type BeginRedirectLoginOptions,
  type GetCodeCallback,
  type LoginResult,
  type RecentLoginAccount,
  type RedirectOutcome,
  type RestoreOutcome,
  type SolidAuth,
  type SolidAuthController,
  sameWebId,
} from "./types.js";
