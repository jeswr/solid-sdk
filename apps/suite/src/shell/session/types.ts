// AUTHORED-BY Codex GPT-6.1-Sol
export interface SuiteAccount {
  id: string;
  webId: string;
  name: string;
  photoUrl?: string;
  storageUrl: string;
  issuer?: string;
  /** "extension": the session comes from the Solid browser extension (window.solid). */
  kind: "demo" | "solid" | "extension";
}
export type SessionStatus = "loading" | "signed-out" | "ready" | "expired";
export type SignInHint = { issuer: string } | { webId: string };
export interface SessionBackend {
  kind: SuiteAccount["kind"];
  restore(): Promise<SuiteAccount | null>;
  signIn(hint: SignInHint): Promise<SuiteAccount>;
  signOut(account: SuiteAccount): Promise<void>;
  fetchFor(account: SuiteAccount): typeof fetch;
  onExpired(cb: () => void): () => void;
}
export class SignInError extends Error {
  readonly code: "invalid-url" | "unavailable";
  constructor(code: "invalid-url" | "unavailable") {
    super(
      code === "invalid-url"
        ? "We couldn't find a sign-in service at that address"
        : "Signing in with a Solid provider isn't switched on in this preview yet.",
    );
    this.name = "SignInError";
    this.code = code;
  }
}
