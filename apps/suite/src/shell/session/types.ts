// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
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
export interface SessionBackend {
  kind: SuiteAccount["kind"];
  restore(): Promise<SuiteAccount | null>;
  signIn(hint: SignInHint, options?: SignInOptions): Promise<SuiteAccount>;
  signOut(account: SuiteAccount): Promise<void>;
  fetchFor(account: SuiteAccount): typeof fetch;
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
