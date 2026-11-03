// AUTHORED-BY Claude Opus 5.5
"use client";
/**
 * `useRegistration()`: the suite-side stand-in for the SDK hook of the same
 * name (02-suite-shell §8.2). It decides availability, picks the backend and
 * runs the three steps, handing the last one to the shell's session layer.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSuiteEnvironment } from "../environment";
import {
  parseRegistrationFixture,
  REGISTRATION_FIXTURE_KEY,
  type RegistrationFixture,
  registrationAvailable,
} from "../lib/registration-fixture";
import { type RegistrationStepId, stepFailureMessage } from "../lib/registration-steps";
import { useAccounts } from "../session/accounts-provider";
import { DemoRegistrationBackend } from "./demo-backend";
import {
  type RegistrationBackend,
  RegistrationError,
  type RegistrationMethod,
  type RegistrationPreview,
  type RegistrationProgressData,
  type RegistrationRequest,
  type UsernameAvailability,
} from "./types";

/** Shown on /signin when /signup is visited without registration. */
export const SIGNUP_UNAVAILABLE_NOTE =
  "Account creation isn't offered here yet — sign in with an existing account.";
export const SIGNUP_UNAVAILABLE_PARAM = "signup";

const NO_FIXTURE: RegistrationFixture = { available: false, failOnce: [] };

function readFixture(): RegistrationFixture {
  // Literal reference: Next inlines it, so production builds never read the override.
  if (process.env.NEXT_PUBLIC_DEV_FIXTURES !== "1") return NO_FIXTURE;
  try {
    return parseRegistrationFixture(localStorage.getItem(REGISTRATION_FIXTURE_KEY));
  } catch {
    return NO_FIXTURE;
  }
}

/**
 * The one place a provider's account API plugs in. Only the in-memory demo
 * exists today; a real provider client is a separate piece of work.
 */
/**
 * Signing the new account in makes it the active account, and the shell
 * remounts the page tree for a new account (per-account providers are keyed by
 * account). This module-level flag survives that remount so the fresh /signup
 * instance finishes the hand-off to /onboarding instead of showing an empty form.
 */
let signedInFromRegistration = false;
export function registrationJustFinished(): boolean {
  return signedInFromRegistration;
}
export function clearRegistrationFinished(): void {
  signedInFromRegistration = false;
}

export function selectRegistrationBackend(fixture: RegistrationFixture): RegistrationBackend {
  return new DemoRegistrationBackend({ failOnce: fixture.failOnce });
}

export interface Registration {
  /** False until browser-only inputs have been read after hydration. */
  ready: boolean;
  available: boolean;
  methods: readonly RegistrationMethod[];
  notice: string | undefined;
  previewUrls(username: string): RegistrationPreview;
  checkUsername(username: string, signal: AbortSignal): Promise<UsernameAvailability>;
  /** Run one step; resolves when it finished, rejects with a RegistrationError. */
  runStep(
    step: RegistrationStepId,
    request: RegistrationRequest,
    signal: AbortSignal,
  ): Promise<void>;
}

const unavailable = () => Promise.reject(new RegistrationError("check", SIGNUP_UNAVAILABLE_NOTE));

export function useRegistration(): Registration {
  const env = useSuiteEnvironment();
  const { signInWith } = useAccounts();
  const [fixture, setFixture] = useState<RegistrationFixture | null>(null);
  useEffect(() => setFixture(readFixture()), []);
  const available = registrationAvailable({
    selfRegistration: env.SUITE_TEST_CAPS.selfRegistration,
    fixture: fixture ?? NO_FIXTURE,
    demo: env.NEXT_PUBLIC_SUITE_DEMO,
  });
  const backend = useMemo(
    () => (available ? selectRegistrationBackend(fixture ?? NO_FIXTURE) : null),
    [available, fixture],
  );
  // The pod step starts a fresh record, so a retry or a second signup never reuses old results.
  const created = useRef<RegistrationProgressData>({});

  const runStep = useCallback<Registration["runStep"]>(
    async (step, request, signal) => {
      if (!backend) return unavailable();
      try {
        if (step === "pod") {
          created.current = { podUrl: (await backend.createPod(request, signal)).podUrl };
        } else if (step === "account-id") {
          const { accountId } = await backend.createAccountId(request, created.current, signal);
          created.current = { ...created.current, accountId };
        } else {
          const target = await backend.signIn(request, created.current, signal);
          signedInFromRegistration = true;
          try {
            await signInWith(target.kind, target.hint);
          } catch (cause) {
            signedInFromRegistration = false;
            throw cause;
          }
        }
      } catch (cause) {
        if (signal.aborted) throw cause;
        throw cause instanceof RegistrationError
          ? cause
          : new RegistrationError(step, stepFailureMessage(step));
      }
    },
    [backend, signInWith],
  );

  return {
    ready: fixture !== null,
    available: backend !== null,
    methods: backend?.methods ?? [],
    notice: backend?.notice,
    previewUrls: (username) => backend?.previewUrls(username) ?? { pod: "", accountId: "" },
    checkUsername: (username, signal) =>
      backend ? backend.checkUsername(username, signal) : unavailable(),
    runStep,
  };
}
