// AUTHORED-BY Codex GPT-6.1-Sol
import type { StorageClient } from "@jeswr/storage-client";

/** Solid access modes. Control concerns the access document, not resource content. */
export type AccessMode = "read" | "write" | "append" | "control";

/** A simple grant; purpose and expiry constraints are unsupported on Solid. */
export interface Grant {
  agent: string | { public: true } | { authenticated: true } | { group: string };
  modes: readonly AccessMode[];
  purpose?: string;
  expires?: Date;
  /** Authorization/policy IRI. Anonymous rules have no stable id. */
  id?: string;
}

/** Sharing operations over a discovered storage client. LWS operations follow in T-051. */
export interface AccessClient {
  model(): "wac" | "acp" | "odrl-grants" | "none";
  /** Public is empty: StorageClient.head exposes only the caller's WAC-Allow modes. */
  effective(url: string): Promise<{ me: AccessMode[]; public: AccessMode[] } | null>;
  grants(url: string): Promise<readonly Grant[]>;
  share(url: string, grant: Grant, opts: { inherit?: boolean }): Promise<Grant>;
  revoke(url: string, grantIdOrAgent: string): Promise<void>;
}

/** Use the public storage interface; authentication and transport stay in storage-client. */
export interface AccessClientOptions {
  storage: StorageClient;
}
