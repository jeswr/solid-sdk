// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Codex GPT-6.1-Sol
import type { SolidExtensionState } from "./extension-session";

interface SessionAccount {
  readonly webId: string;
  readonly displayName: string;
  readonly storageUrl: string;
  readonly fetch: typeof globalThis.fetch;
  /** Change events or focus-driven revalidation for resources in the storage. */
  subscribe(listener: (url: string) => void): () => void;
}

export interface DemoPodSession extends SessionAccount {
  readonly mode: "demo";
  reset(): Promise<void>;
}

export interface ExtensionPodSession extends SessionAccount {
  readonly mode: "extension";
  /** Page reads of public profiles/indexes, always without credentials. */
  readonly publicFetch: typeof globalThis.fetch;
  disconnect(): Promise<void>;
}

export type PodSession = DemoPodSession | ExtensionPodSession;

export type SessionResult =
  | { status: "loading" }
  | { status: "signed-out" }
  | { status: "ready"; session: PodSession }
  | { status: "error"; mode: PodSession["mode"]; error: unknown };

export type SessionState = SessionResult & {
  extension: SolidExtensionState;
  connectExtension(): Promise<void>;
  extensionError?: unknown;
};
