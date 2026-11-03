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
  /** Explicit grants plus WebID-profile roots loaded on login/restore; server hints never grant access. */
  boundary?: { roots?: string[]; automatic?: boolean; eligible?: (url: URL) => boolean };
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
  webId: string | null;
  issuer: string;
  subject: string;
  clientId: string | null;
  protocol: "solid-oidc" | "lws";
  storages: readonly string[];
}

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

/** Suite authentication and credential-free session lifecycle. */
export interface PodAuth {
  fetch: typeof fetch;
  login(hint?: LoginHint): Promise<Identity>;
  /** Restore the remembered account; never requests interactive authorization. */
  restore(): Promise<Identity | null>;
  /** Revoke when advertised, purge local credentials, and emit logout even if revocation fails. */
  logout(): Promise<void>;
  /** Read only the credential-free remembered pointer, without discovery or credential access. */
  remembered(): Promise<{ webId: string; issuer: string; displayName?: string; avatar?: string }[]>;
  /** Reports current claims without discovery, refresh or UI interaction. */
  identity(): Promise<Identity | null>;
  on(event: AuthEventType, handler: (event: AuthEvent) => void): () => void;
}
