// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
import type { ResourceGrant } from "./grants.js";

/** Structural key-value seam; values must support structured cloning, including CryptoKeys. */
export interface KvStore<T extends {} = {}> {
  getItem(key: string): Promise<T | null>;
  setItem(key: string, value: T): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export interface PodAuthOptions {
  clientId: string | { dynamicRegistration: true };
  redirectUri: string;
  /**
   * Opt into a native application's private-use scheme callback (RFC 8252 §7.1), e.g.
   * `org.jeswr.suite:/oauth/callback`. Requires a lowercase reverse-domain scheme and an
   * absolute path, with no authority, credentials, query, fragment or URL normalization.
   * Only scheme callbacks are allowed in this mode; `clientId` must be an HTTPS Client ID
   * Document URL (with `application_type: native` and this exact redirect registered), and
   * `allowInsecureLoopback` must not be true. The callback may differ from the WebView's origin.
   * `ui.getCode` must return the complete callback URL, including code, state and iss.
   * The callback never grants resource access or supplies a resource/storage context.
   */
  nativeRedirect?: true;
  /** Explicit grants plus WebID-profile roots loaded on login/restore; server hints never grant access. */
  boundary?: {
    roots?: string[];
    automatic?: boolean;
    eligible?: (url: URL) => boolean;
    /**
     * Absolute paths (e.g. "/account/domains") on the origin of each storage discovered from the
     * WebID profile that receive that storage's credentials and share its credential context, for
     * server APIs outside the pod folder. A path ending in "/" covers its descendants; any other
     * path matches exactly. Applies only to automatic (profile) roots.
     */
    storageEndpoints?: string[];
  };
  storage?: { sessions: KvStore; caches: KvStore };
  /** Independent session/key/fence namespace. Keep this public identifier stable across restores. */
  sessionScope?: string;
  ui: {
    getWebId(): Promise<string>;
    chooseIssuer?(issuers: string[]): Promise<string>;
    /** Return the complete callback URL, including state, code and issuer parameters. */
    getCode(authorizationUrl: URL, signal: AbortSignal): Promise<string>;
  };
  lws?: { subject: "oidc-id-token" | { cid: CidSubject } };
  allowInsecureLoopback?: boolean;
  clock?: () => number;
  /**
   * Largest body `auth.fetch` or `auth.fetchFor` buffers for replay after a 401 (default 16 MiB).
   * Larger buffered bodies reject. Blob/File bodies supplied in init replay without buffering or this cap.
   */
  maxReplayBodyBytes?: number;
}

/** Existing CID identity and its caller-owned signing key; no key is generated implicitly. */
export interface CidSubject {
  documentUrl: string;
  /** Absolute verification method URL in documentUrl. */
  keyId: string;
  /** Required for CID mode. Non-extractable ES256 private key, retained only in memory. */
  privateKey?: CryptoKey;
}

export interface Identity {
  /** Public ownership tag, not a secret/capability. Stable across refresh; new sign-ins change it. */
  grantId?: string;
  webId: string | null;
  issuer: string;
  subject: string;
  clientId: string | null;
  protocol: "solid-oidc" | "lws";
  storages: readonly string[];
}

/** Credential-free ownership snapshot from a pod-auth Identity. Missing identifiers fail closed. */
export type GrantOwner = Pick<Identity, "webId" | "issuer" | "grantId">;

/** A skipped retirement never revokes, clears credentials, advances the fence or emits logout. */
export type GrantRetirementResult =
  | { retired: true }
  | {
      retired: false;
      reason: "missing-grant" | "no-grant" | "owner-changed" | "grant-changed";
    };

export interface LoginHint {
  webId?: string;
  issuer?: string;
}
export type AuthEventType = "login" | "logout" | "restore" | "expired" | "challenge" | "grants";
export interface AuthEvent {
  type: AuthEventType;
  identity: Identity | null;
  timestamp: number;
  /** Challenged resource; supplied for challenge events. */
  url?: string;
  /** The account's resource grants after the change; supplied for grants events. */
  grants?: readonly ResourceGrant[];
}

/** Options for one {@link PodAuth.grantResource} call. */
export interface GrantResourceOptions {
  signal?: AbortSignal;
}

/** Options for one {@link PodAuth.login} call. */
export interface LoginOptions {
  /** Abandons the attempt; see {@link PodAuth.login}. */
  signal?: AbortSignal;
  /**
   * The `remembered()` result the caller saw when it decided to sign in. Login rejects with
   * `OwnershipChangedError` before authorization if the remembered pointer differs. Under the
   * namespace mutation lock, immediately before publishing this attempt's grant owner and the pointer,
   * pod-auth checks again that the pointer and the stored grant owner are unchanged since the attempt
   * began; on a mismatch it discards only this attempt's new grant and rejects the same way.
   * Ownership-guarded attempts are never shared with concurrent logins.
   */
  expectRemembered?: readonly { webId: string; issuer: string }[];
  /**
   * Requires a WebID hint. Authorizes interactively without redeeming any stored refresh credential,
   * for a grant of that account that persistently fails refresh (for example `invalid_client`). The
   * new grant replaces it for that context; the old one stays catalogued for logout. Rejects with
   * `OwnershipChangedError` if the pointer or stored owner names another account, and guards
   * publication like `expectRemembered`.
   */
  reauthorize?: boolean;
}

/** Public identity selector; no credentials cross this surface. */
export interface FetchAccount {
  webId: string | null;
  issuer: string;
}

export interface FetchForOptions {
  /**
   * Explicit canonical HTTPS origins (no wildcards), trusted by the application rather than pod data.
   * OIDC token/registration endpoints are excluded even on admitted origins.
   */
  extraResourceOrigins?: readonly string[];
}

/** Suite authentication and credential-free session lifecycle. */
export interface PodAuth {
  fetch: typeof fetch;
  /**
   * Pin a fetch to the current account/session. Extra resource origins receive only this session's
   * Solid-OIDC DPoP credentials; they never broaden `fetch`, grant storage access, run LWS/UMA
   * exchange or start sign-in. LWS sessions and agents reject extra origins. Redirects from extra
   * resources are refused. Handles expire on logout or a transition from Solid-OIDC to LWS.
   */
  fetchFor(account: FetchAccount, options?: FetchForOptions): typeof fetch;
  /**
   * Interactive login. `options.signal` abandons this attempt: its requests and the authorization popup are
   * cancelled and the promise rejects with the abort reason once the attempt has wound down, leaving stored
   * sessions alone. If a grant had already been obtained when the abort was seen, it is discarded with a full
   * {@link PodAuth.logout} first. `ui.getWebId` and `ui.chooseIssuer` are raced against the signal, and their
   * late answers are dropped. A stored session that the attempt only renewed is kept, as it existed before.
   * Agents ignore the signal once started.
   */
  login(hint?: LoginHint, options?: LoginOptions): Promise<Identity>;
  /**
   * Restore the remembered account; never requests interactive authorization. Concurrent calls share
   * one restore. A caller's signal cancels only its own wait; the shared restore stops once every
   * cancellable waiter has left, and a cancelled restore publishes no identity and emits no event.
   */
  restore(options?: { signal?: AbortSignal }): Promise<Identity | null>;
  /**
   * Revoke when advertised, purge local credentials, and emit logout even if revocation fails.
   * `scope: "session"` requires an explicit sessionScope and purges only that scope's sessions/keys.
   * Without a sessionScope, ordinary logout purges every stored session for this client configuration.
   */
  logout(options?: { scope: "session" }): Promise<void>;
  /** Release this instance and cancel its work without deleting remembered credentials. */
  dispose?(): void;
  /**
   * Retire only the namespace grant matching this identity snapshot, including its grantId.
   * Ownership comparison and logout cleanup share a namespace lock with credential commits.
   * Web Locks coordinate tabs/workers sharing storage; Node's fallback covers only this realm.
   * Browsers without Web Locks fail closed. Cleanup failures reject after attempted cleanup.
   */
  retireIfOwnedBy(expected: GrantOwner): Promise<GrantRetirementResult>;
  /** Read only the credential-free remembered pointer, without discovery or credential access. */
  remembered(): Promise<{ webId: string; issuer: string; displayName?: string; avatar?: string }[]>;
  /** Reports current claims without discovery, refresh or UI interaction. */
  identity(): Promise<Identity | null>;
  on(event: AuthEventType, handler: (event: AuthEvent) => void): () => void;
  /**
   * Let the signed-in account open one resource or container on someone else's storage, which
   * the user has chosen on a screen naming its origin. Call it only from that user gesture: where
   * the browser reports user activation, a call without one is refused. The grant receives this
   * account's credentials for reads and writes alike, and nothing else changes: it never becomes
   * a storage, an authorization-server trust anchor or a login context, and redirects out of it
   * get no credentials. Grants stay in memory for this account and end at logout, expiry or
   * session change. Refusals reject with `ResourceGrantError`; granting a covered URL again
   * returns the covering grant. Interactive cores only; agents and test doubles may omit it.
   */
  grantResource?(url: string, options?: GrantResourceOptions): Promise<ResourceGrant>;
  /** Remove a grant by grant or exact root. Returns true on removal. Each credentialed send checks the current boundary. */
  revokeResource?(grant: ResourceGrant | string): boolean;
  /** This account's current resource grants, in the order they were made. */
  grants?(): readonly ResourceGrant[];
  /** Whether `url` is inside one of this account's resource grants. Synchronous. */
  isWithinGrantedScope?(url: string | URL): boolean;
}
