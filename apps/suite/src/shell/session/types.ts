// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY Codex GPT-6
import type { FetchForOptions } from "@jeswr/pod-auth";
import { en } from "@jeswr/suite-i18n";
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
  fetchFor(account: SuiteAccount, options?: FetchForOptions): typeof fetch;
  onExpired(cb: () => void): () => void;
}
/** English text for logs and errors; the sign-in page translates by code (`signin.errors`). */
const signInMessages = en.signin.errors;
export class SignInError extends Error {
  readonly code: keyof typeof signInMessages;
  constructor(code: keyof typeof signInMessages) {
    super(signInMessages[code]);
    this.name = "SignInError";
    this.code = code;
  }
}
