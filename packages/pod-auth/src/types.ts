// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
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
   * Largest request body `auth.fetch` buffers so it can replay a request after a 401 challenge
   * (default 16 MiB). Raise it for apps that upload large files; larger bodies reject.
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
  /** Opaque grant identifier. Stable across refresh rotation; a new sign-in gets a new value. */
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
export type AuthEventType = "login" | "logout" | "restore" | "expired" | "challenge";
export interface AuthEvent {
  type: AuthEventType;
  identity: Identity | null;
  timestamp: number;
  /** Challenged resource; supplied for challenge events. */
  url?: string;
}

/** Options for one {@link PodAuth.login} call. */
export interface LoginOptions {
  /** Abandons the attempt; see {@link PodAuth.login}. */
  signal?: AbortSignal;
}

/** Suite authentication and credential-free session lifecycle. */
export interface PodAuth {
  fetch: typeof fetch;
  /**
   * Interactive login. `options.signal` abandons this attempt: its requests and the authorization popup are
   * cancelled and the promise rejects with the abort reason once the attempt has wound down, leaving stored
   * sessions alone. If a grant had already been obtained when the abort was seen, it is discarded with a full
   * {@link PodAuth.logout} first. `ui.getWebId` and `ui.chooseIssuer` are raced against the signal, and their
   * late answers are dropped. A stored session that the attempt only renewed is kept, as it existed before.
   * Agents ignore the signal once started.
   */
  login(hint?: LoginHint, options?: LoginOptions): Promise<Identity>;
  /** Restore the remembered account; never requests interactive authorization. */
  restore(): Promise<Identity | null>;
  /** Revoke when advertised, purge local credentials, and emit logout even if revocation fails. */
  logout(): Promise<void>;
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
}
