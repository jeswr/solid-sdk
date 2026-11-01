// AUTHORED-BY Codex GPT-6
export interface PodSession {
  readonly mode: "demo";
  readonly webId: string;
  readonly displayName: string;
  readonly storageUrl: string;
  readonly fetch: typeof globalThis.fetch;
  subscribe(listener: (url: string) => void): () => void;
  reset(): Promise<void>;
}

export type SessionState =
  | { status: "loading" }
  | { status: "signed-out" }
  | { status: "ready"; session: PodSession }
  | { status: "error"; error: unknown };
