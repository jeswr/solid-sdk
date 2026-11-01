// AUTHORED-BY Claude Opus 5.5
/**
 * The registration seam (02-suite-shell §8.2). The SDK has no
 * `useRegistration` yet (sdk-core SDK-APP-05), so the suite defines the
 * contract a provider's account API must meet and ships only an in-memory demo
 * backend. A real backend (for example a Community Solid Server account API
 * client) implements `RegistrationBackend` and is returned by
 * `selectRegistrationBackend` in ./use-registration.ts; nothing else changes.
 */
import type { RegistrationStepId } from "../lib/registration-steps";
import type { SignInHint, SuiteAccount } from "../session/types";

export type RegistrationMethod = "password" | "passkey";
export type UsernameAvailability = "available" | "taken";

export interface RegistrationRequest {
  username: string;
  displayName: string;
  method: RegistrationMethod;
  /** Present when `method` is "password". */
  password?: string;
}

/** Provider-derived addresses shown under the username before anything is created. */
export interface RegistrationPreview {
  pod: string;
  accountId: string;
}

/** What earlier steps produced, handed to later ones. */
export interface RegistrationProgressData {
  podUrl?: string;
  accountId?: string;
}

/** How the shell signs the new account in: through an existing session backend. */
export interface RegistrationSignIn {
  kind: SuiteAccount["kind"];
  hint: SignInHint;
}

export interface RegistrationBackend {
  /** Sign-in methods the provider can set up; "passkey" adds the recommended radio. */
  readonly methods: readonly RegistrationMethod[];
  /** Optional plain-language note shown above the form (the demo says it is a demo). */
  readonly notice?: string;
  /** Pure: the addresses a valid username would get. */
  previewUrls(username: string): RegistrationPreview;
  checkUsername(username: string, signal: AbortSignal): Promise<UsernameAvailability>;
  /**
   * Each step is retried on its own after a failure, so it must be safe to call
   * again with the same request (a provider that already finished it resolves).
   */
  createPod(request: RegistrationRequest, signal: AbortSignal): Promise<{ podUrl: string }>;
  createAccountId(
    request: RegistrationRequest,
    created: RegistrationProgressData,
    signal: AbortSignal,
  ): Promise<{ accountId: string }>;
  signIn(
    request: RegistrationRequest,
    created: RegistrationProgressData,
    signal: AbortSignal,
  ): Promise<RegistrationSignIn>;
}

/** A failure whose message is already plain language and safe to show. */
export class RegistrationError extends Error {
  readonly step: RegistrationStepId | "check";
  constructor(step: RegistrationStepId | "check", message: string) {
    super(message);
    this.name = "RegistrationError";
    this.step = step;
  }
}
