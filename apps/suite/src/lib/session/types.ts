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

export interface SolidPodSession extends SessionAccount {
  readonly mode: "solid";
  readonly publicFetch: typeof globalThis.fetch;
  /**
   * Let `fetch` use this account for one resource or container on another person's storage,
   * until sign-out. Call only from the click on a consent screen that names the address.
   */
  readonly grantResource?: (url: string) => Promise<void>;
}

export type PodSession = DemoPodSession | ExtensionPodSession | SolidPodSession;

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
