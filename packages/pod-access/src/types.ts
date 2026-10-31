// AUTHORED-BY Codex GPT-6.1-Sol
import type { StorageClient } from "@jeswr/storage-client";

/** Access modes. Delete is LWS-only; Control concerns Solid access documents. */
export type AccessMode = "read" | "write" | "append" | "control" | "delete";

/** A simple grant; purpose and expiry constraints are unsupported on Solid. */
export interface Grant {
  agent: string | { public: true } | { authenticated: true } | { group: string };
  modes: readonly AccessMode[];
  purpose?: string;
  expires?: Date;
  /** Solid authorization/policy IRI or LWS grant resource URL. Anonymous rules have no stable id. */
  id?: string;
}

/** A grant id, agent/group IRI, or explicit public/authenticated selector. */
export type RevocationKey = string | { public: true } | { authenticated: true };

/** A request for a single resource, using the same modes and constraints as a grant. */
export interface AccessRequest extends Grant {
  target: string;
  inbox?: string;
}

/** Sharing operations over a discovered storage client. */
export interface AccessClient {
  model(): "wac" | "acp" | "odrl-grants" | "none";
  /** Solid public modes are unknown ([]); LWS derives active caller and public grants. */
  effective(url: string): Promise<{ me: AccessMode[]; public: AccessMode[] } | null>;
  grants(url: string): Promise<readonly Grant[]>;
  share(url: string, grant: Grant, opts: { inherit?: boolean }): Promise<Grant>;
  revoke(url: string, key: RevocationKey): Promise<void>;
  requests(): Promise<readonly AccessRequest[]>;
  request(req: AccessRequest): Promise<{ url: string }>;
}

/** Use the public storage interface; authentication and transport stay in storage-client. */
export interface AccessClientOptions {
  storage: StorageClient;
  /** Canonical description.id, required on LWS; it can differ from storage.root. */
  storageId?: string;
  /** Current caller identifier (adapt pod-auth.identity); absent/anonymous means unknown. */
  identity?: () => string | null;
}
