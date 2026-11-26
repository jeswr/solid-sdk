// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
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
export interface SignInOptions {
  signal?: AbortSignal;
}
/** Local sign-out completed, but a shared session may remain in another tab. */
export interface SignOutNotice {
  notice: string;
}
// biome-ignore lint/suspicious/noConfusingVoidType: Existing backends return Promise<void> when no notice is needed.
export type SignOutResult = void | SignOutNotice;
export interface SessionBackend {
  kind: SuiteAccount["kind"];
  restore(): Promise<SuiteAccount | null>;
  signIn(hint: SignInHint, options?: SignInOptions): Promise<SuiteAccount>;
  signOut(account: SuiteAccount): Promise<SignOutResult>;
  fetchFor(account: SuiteAccount): typeof fetch;
  onExpired(cb: () => void): () => void;
}
const signInMessages = {
  "invalid-url": "We couldn't find a sign-in service at that address",
  unavailable: "Sign-in isn't available here. Please try again.",
  "issuer-not-authorized":
    "That account doesn't trust this provider. Try your own provider or your WebID.",
  "ambiguous-issuer":
    "Your WebID lists several providers. Enter your provider's address to continue.",
  cancelled: "Sign-in was cancelled.",
  "popup-blocked": "Allow popups for Solid Suite, then try signing in again.",
  "account-active": "Sign out of your current Solid account before signing in to another account.",
  "session-elsewhere":
    "A remembered Solid session is still active in this browser. Sign in with that account's WebID, or sign out of it in the tab that uses it.",
  "in-progress": "A sign-in is already in progress.",
  "invalid-identity": "This account needs a WebID and one pod storage to use Solid Suite.",
  failed: "We couldn't sign you in. Please try again.",
} as const;
export class SignInError extends Error {
  readonly code: keyof typeof signInMessages;
  constructor(code: keyof typeof signInMessages) {
    super(signInMessages[code]);
    this.name = "SignInError";
    this.code = code;
  }
}
