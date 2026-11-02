// AUTHORED-BY Claude Opus 5.5
/**
 * Onboarding (02-suite-shell §8.3): three skippable steps shown once per
 * account. Completion lives in the account's preferences under `onboarding`.
 */

export const ONBOARDING_STATES = ["not-started", "complete", "skipped"] as const;
export type OnboardingState = (typeof ONBOARDING_STATES)[number];

export const ONBOARDING_STEPS = [
  { id: "pod", title: "This is your pod" },
  { id: "yours", title: "Make it yours" },
  { id: "data", title: "Bring your data" },
] as const;
export type OnboardingStepIndex = 0 | 1 | 2;

/** Once complete or skipped, the suite never shows onboarding to that account again. */
export function onboardingFinished(state: OnboardingState): boolean {
  return state !== "not-started";
}

/** Moves stay within the three steps. */
export function moveStep(current: OnboardingStepIndex, by: -1 | 1): OnboardingStepIndex {
  return Math.min(2, Math.max(0, current + by)) as OnboardingStepIndex;
}

export function stepCounter(index: OnboardingStepIndex): string {
  return `Step ${index + 1} of ${ONBOARDING_STEPS.length}`;
}

/** "https://sam.example.org/" → "sam.example.org"; anything unparsable is shown as given. */
export function storageHost(storageUrl: string): string {
  try {
    return new URL(storageUrl).host;
  } catch {
    return storageUrl;
  }
}
