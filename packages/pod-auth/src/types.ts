// AUTHORED-BY Codex GPT-6.1-Sol
/** Structural key-value seam; values must support structured cloning, including CryptoKeys. */
export interface KvStore<T extends {} = {}> {
  getItem(key: string): Promise<T | null>;
  setItem(key: string, value: T): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export interface PodAuthOptions {
  clientId: string | { dynamicRegistration: true };
  redirectUri: string;
  boundary?: { roots?: string[]; automatic?: boolean; eligible?: (url: URL) => boolean };
  storage?: { sessions: KvStore; caches: KvStore };
  ui: {
    getWebId(): Promise<string>;
    chooseIssuer?(issuers: string[]): Promise<string>;
    /** Return the complete callback URL, including state, code and issuer parameters. */
    getCode(authorizationUrl: URL, signal: AbortSignal): Promise<string>;
  };
  lws?: { subject: "oidc-id-token" | { cid: { documentUrl: string; keyId: string } } };
  allowInsecureLoopback?: boolean;
  clock?: () => number;
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

/** T-031 core. Persistence lifecycle, React and agent entry points are implemented by later tasks. */
export interface PodAuth {
  fetch: typeof fetch;
  login(hint?: LoginHint): Promise<Identity>;
  /** Reports current claims without discovery, refresh or UI interaction. */
  identity(): Promise<Identity | null>;
  on(event: AuthEventType, handler: (event: AuthEvent) => void): () => void;
}
