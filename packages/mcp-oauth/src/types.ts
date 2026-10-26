// AUTHORED-BY Codex GPT-6.1-Sol
import type { KeyObject } from "node:crypto";

/** Server-side pod identity. Pod credentials are owned exclusively by the provider. */
export interface PodSession {
  id: string;
  webId: string;
}

/** Injected MCP-10 broker; never returns pod tokens through the MCP protocol. */
export interface PodSessionProvider {
  begin(webIdOrIssuer: string, redirect: string): Promise<{ authorizeUrl: string; state: string }>;
  complete(callbackUrl: string, state: string): Promise<PodSession>;
  fetchFor(sessionId: string): Promise<typeof fetch>;
  revoke(sessionId: string): Promise<void>;
}

/** The supported public-client registration metadata. */
export interface Client {
  client_id: string;
  client_id_issued_at: number;
  client_name?: string;
  redirect_uris: string[];
  grant_types: string[];
  response_types: ["code"];
  token_endpoint_auth_method: "none";
}

/** Validated authorization parameters, retained across upstream login. */
export interface Authorization {
  clientId: string;
  redirectUri: string;
  resource: string;
  state: string;
  scope: string;
  challenge: string;
}

/** A short-lived upstream login transaction, keyed by a hash of the broker state. */
export interface PendingLogin {
  authorization: Authorization;
  expiresAt: number;
}

/** Server-side grant and refresh-token family. */
export interface Grant {
  id: string;
  clientId: string;
  session: PodSession;
  resource: string;
  scope: string;
  expiresAt: number;
  revoked: boolean;
  refreshAllowed: boolean;
}

/** One-time authorization code record; the raw code is never stored. */
export interface AuthorizationCode {
  authorization: Authorization;
  grantId: string;
  expiresAt: number;
}

/** One-time refresh-token record, keyed by the token's SHA-256 hash. */
export interface RefreshToken {
  grantId: string;
  clientId: string;
  expiresAt: number;
}

/** Store operations return independent snapshots; writes must be durable before resolving. */
export interface RecordStore<T> {
  get(id: string): Promise<T | undefined>;
  put(id: string, value: T): Promise<void>;
}

/** Atomic consumption with retained tombstones for replay detection. */
export interface OneTimeStore<T> extends RecordStore<T> {
  consume(id: string): Promise<{ value: T; firstUse: boolean } | undefined>;
}

/** Revocation must be atomic and irreversible; never overwrite an existing grant with put. */
export interface GrantStore extends RecordStore<Grant> {
  revoke(id: string): Promise<void>;
}

/** Pluggable stores. Shared durable implementations are required for multiple workers. */
export interface OAuthStores {
  clients: RecordStore<Client>;
  pending: OneTimeStore<PendingLogin>;
  codes: OneTimeStore<AuthorizationCode>;
  refreshTokens: OneTimeStore<RefreshToken>;
  grants: GrantStore;
}

/** ES256 signing key; persist and inject the same key across restarts/workers. */
export interface SigningKey {
  privateKey: KeyObject;
  kid: string;
}

/** Consent receives only the MCP request and a server-side pod identity. */
export interface ConsentContext {
  request: Request;
  client: Client;
  authorization: Authorization;
  session: PodSession;
}

/** Server configuration. Lifetimes and clock values use seconds. */
export interface AuthorizationServerOptions {
  issuer: string;
  resource: string;
  podSessions: PodSessionProvider;
  consent(context: ConsentContext): Promise<boolean>;
  stores?: OAuthStores;
  signingKey?: SigningKey;
  scopes?: readonly string[];
  now?: () => number;
  /** Trusted, already SSRF/DNS-pinning-guarded fetch; defaults to guarded-fetch/node. */
  metadataFetch?: typeof fetch;
}

/** Verified MCP identity, resolved from the grant rather than upstream credentials. */
export interface AccessPrincipal {
  clientId: string;
  webId: string;
  sessionId: string;
  resource: string;
  scope: string;
  grantId: string;
}
