// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
/** Private credential storage, explicit OAuth login and channel token supply. */

/** Dependencies and safe summaries for explicit OAuth operations. */
export type { Deps, IssuedToken, LoginResult, ProfileStatus } from "./operations.js";
/** Obtain a bound token, run explicit consent/logout, or inspect safe status. */
export { accessToken, helperExchange, login, logout, status } from "./operations.js";
/** Host-injected provider transport; tests supply an in-process fake. */
export type { Transport } from "./providers.js";
/** Fixed provider metadata, separated scope requests and the refusing default transport. */
export { GOOGLE, MICROSOFT, noTransport, requestedScopes, requiredScopes } from "./providers.js";
/** Validated private store records; grants and token files carry an explicit purpose. */
export type {
  GoogleClient,
  Grant,
  MicrosoftClient,
  Profile,
  TokenFile,
  TokenFileProvider,
} from "./store.js";
/** Open an owner-only store, compute its platform path, or handle typed failures. */
export { CredentialStore, defaultStoreDir, HelperError, tokenFileProviders } from "./store.js";
/** Shared helper deadline, persistence reserve and parent kill timeout. */
export {
  CALL_TIMEOUT_MS,
  HELPER_DEADLINE_MS,
  HELPER_KILL_TIMEOUT_MS,
  HELPER_PERSIST_RESERVE_MS,
  LOCK_WAIT_MS,
} from "./timeouts.js";
/** Structural read/send token seam consumed by channel bindings. */
export type { TokenProvider } from "./token-provider.js";
/** Supply credentials for exactly one provider/account/resource/purpose. */
export { StoreTokenProvider } from "./token-provider.js";
