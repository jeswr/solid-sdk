// AUTHORED-BY Claude Opus 5.5
/**
 * In-memory registration for the demo: fictional example.org hosts, a few
 * reserved usernames, short delays so the progress panel is visible, and a
 * test-only "fail this step once" switch for exercising Retry. Signing in
 * opens the demo pod through the existing demo session backend; nothing is
 * created anywhere real.
 */

import type { RegistrationStepId } from "../lib/registration-steps";
import { stepFailureMessage } from "../lib/registration-steps";
import {
  type RegistrationBackend,
  RegistrationError,
  type RegistrationPreview,
  type RegistrationProgressData,
  type RegistrationRequest,
  type RegistrationSignIn,
  type UsernameAvailability,
} from "./types";

export const DEMO_REGISTRATION_HOST = "demo.example.org";
/** Fictional names already in use, so "taken" can be tried. */
export const DEMO_RESERVED_USERNAMES: readonly string[] = [
  "admin",
  "alice",
  "bob",
  "demo",
  "support",
];
export const DEMO_REGISTRATION_NOTICE =
  "This is a preview: no real account is created. You'll explore with a demo pod kept in this browser.";

export interface DemoRegistrationOptions {
  /** Steps whose first attempt fails (test fixtures only). */
  failOnce?: readonly RegistrationStepId[];
  /** Delay per step in milliseconds; the username check takes half. */
  delayMs?: number;
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

export class DemoRegistrationBackend implements RegistrationBackend {
  readonly methods = ["password"] as const;
  readonly notice = DEMO_REGISTRATION_NOTICE;
  private readonly failures: Set<RegistrationStepId>;
  private readonly delay: number;
  private readonly pods = new Map<string, string>();

  constructor(options: DemoRegistrationOptions = {}) {
    this.failures = new Set(options.failOnce ?? []);
    this.delay = options.delayMs ?? 300;
  }

  previewUrls(username: string): RegistrationPreview {
    const pod = `https://${username}.${DEMO_REGISTRATION_HOST}/`;
    return { pod, accountId: `${pod}profile/card#me` };
  }

  async checkUsername(username: string, signal: AbortSignal): Promise<UsernameAvailability> {
    await wait(this.delay / 2, signal);
    return DEMO_RESERVED_USERNAMES.includes(username) || this.pods.has(username)
      ? "taken"
      : "available";
  }

  private async step(id: RegistrationStepId, signal: AbortSignal): Promise<void> {
    await wait(this.delay, signal);
    if (this.failures.delete(id)) throw new RegistrationError(id, stepFailureMessage(id));
  }

  async createPod(request: RegistrationRequest, signal: AbortSignal): Promise<{ podUrl: string }> {
    await this.step("pod", signal);
    const existing = this.pods.get(request.username);
    if (existing) return { podUrl: existing };
    if (DEMO_RESERVED_USERNAMES.includes(request.username))
      throw new RegistrationError(
        "pod",
        "That username was taken a moment ago. Change your details and choose another.",
      );
    const { pod } = this.previewUrls(request.username);
    this.pods.set(request.username, pod);
    return { podUrl: pod };
  }

  async createAccountId(
    request: RegistrationRequest,
    created: RegistrationProgressData,
    signal: AbortSignal,
  ): Promise<{ accountId: string }> {
    await this.step("account-id", signal);
    if (!created.podUrl)
      throw new RegistrationError("account-id", stepFailureMessage("account-id"));
    return { accountId: this.previewUrls(request.username).accountId };
  }

  async signIn(
    _request: RegistrationRequest,
    created: RegistrationProgressData,
    signal: AbortSignal,
  ): Promise<RegistrationSignIn> {
    await this.step("sign-in", signal);
    if (!created.accountId) throw new RegistrationError("sign-in", stepFailureMessage("sign-in"));
    // The demo session backend opens the shared demo pod whatever the hint says.
    return { kind: "demo", hint: { webId: created.accountId } };
  }
}
