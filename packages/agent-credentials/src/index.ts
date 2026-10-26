// AUTHORED-BY Codex GPT-6.1-Sol
/** Private credential storage, explicit OAuth login and channel token supply. */

export type { Deps, IssuedToken, LoginResult, ProfileStatus } from "./operations.js";
export { accessToken, helperExchange, login, logout, status } from "./operations.js";
export type { Transport } from "./providers.js";
export { GOOGLE, MICROSOFT, noTransport, requestedScopes, requiredScopes } from "./providers.js";
export type {
  GoogleClient,
  Grant,
  MicrosoftClient,
  Profile,
  TokenFile,
  TokenFileProvider,
} from "./store.js";
export { CredentialStore, defaultStoreDir, HelperError, tokenFileProviders } from "./store.js";
export type { TokenProvider } from "./token-provider.js";
export { StoreTokenProvider } from "./token-provider.js";
