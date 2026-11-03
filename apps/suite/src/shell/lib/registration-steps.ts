// AUTHORED-BY Claude Opus 5.5
/**
 * The three-step registration progress (02-suite-shell §8.2): Creating your
 * pod → Creating your account ID → Signing you in. A failed step keeps the
 * steps before it done, and Retry resumes from the failed step only.
 */

export const REGISTRATION_STEPS = [
  { id: "pod", label: "Creating your pod" },
  { id: "account-id", label: "Creating your account ID" },
  { id: "sign-in", label: "Signing you in" },
] as const;
export type RegistrationStepId = (typeof REGISTRATION_STEPS)[number]["id"];
export const REGISTRATION_STEP_IDS: readonly RegistrationStepId[] = REGISTRATION_STEPS.map(
  (step) => step.id,
);
export type StepStatus = "pending" | "active" | "done" | "failed";

export interface RegistrationProgress {
  phase: "idle" | "running" | "failed" | "done";
  steps: Record<RegistrationStepId, StepStatus>;
  error: { step: RegistrationStepId; message: string } | null;
}
export type ProgressAction =
  | { type: "start" }
  | { type: "succeeded"; step: RegistrationStepId }
  | { type: "failed"; step: RegistrationStepId; message: string }
  | { type: "retry" }
  | { type: "reset" };

export const initialProgress: RegistrationProgress = {
  phase: "idle",
  steps: { pod: "pending", "account-id": "pending", "sign-in": "pending" },
  error: null,
};

/** Every step finished: what the panel shows while the browser moves on to onboarding. */
export const completedProgress: RegistrationProgress = {
  phase: "done",
  steps: { pod: "done", "account-id": "done", "sign-in": "done" },
  error: null,
};

/** The step that is running now, if any. */
export function activeStep(progress: RegistrationProgress): RegistrationStepId | null {
  return REGISTRATION_STEP_IDS.find((id) => progress.steps[id] === "active") ?? null;
}

/** Actions that do not fit the current phase leave the state unchanged. */
export function progressReducer(
  progress: RegistrationProgress,
  action: ProgressAction,
): RegistrationProgress {
  switch (action.type) {
    case "start":
      if (progress.phase !== "idle") return progress;
      return { phase: "running", steps: { ...initialProgress.steps, pod: "active" }, error: null };
    case "succeeded": {
      if (progress.phase !== "running" || progress.steps[action.step] !== "active") return progress;
      const next = REGISTRATION_STEP_IDS[REGISTRATION_STEP_IDS.indexOf(action.step) + 1];
      const steps = { ...progress.steps, [action.step]: "done" as const };
      if (!next) return { phase: "done", steps, error: null };
      return { phase: "running", steps: { ...steps, [next]: "active" }, error: null };
    }
    case "failed":
      if (progress.phase !== "running" || progress.steps[action.step] !== "active") return progress;
      return {
        phase: "failed",
        steps: { ...progress.steps, [action.step]: "failed" },
        error: { step: action.step, message: action.message },
      };
    case "retry": {
      if (progress.phase !== "failed" || !progress.error) return progress;
      return {
        phase: "running",
        steps: { ...progress.steps, [progress.error.step]: "active" },
        error: null,
      };
    }
    case "reset":
      return initialProgress;
  }
}

const LABELS = Object.fromEntries(
  REGISTRATION_STEPS.map((step) => [step.id, step.label]),
) as Record<RegistrationStepId, string>;
export function stepLabel(id: RegistrationStepId): string {
  return LABELS[id];
}

/** The polite live-region text for the progress panel. */
export function progressAnnouncement(progress: RegistrationProgress): string {
  const step = activeStep(progress);
  if (step) return `${stepLabel(step)}…`;
  if (progress.phase === "done") return "Your account is ready.";
  if (progress.phase === "failed" && progress.error)
    return `${stepLabel(progress.error.step)} didn't finish.`;
  return "";
}

/** Screen-reader suffix for each step row. */
export function stepStatusText(status: StepStatus): string {
  switch (status) {
    case "pending":
      return "Not started";
    case "active":
      return "In progress";
    case "done":
      return "Done";
    case "failed":
      return "Didn't finish";
  }
}

/** Plain-language fallback when a backend failure carries no message of its own. */
export function stepFailureMessage(id: RegistrationStepId): string {
  switch (id) {
    case "pod":
      return "We couldn't create your pod. Please try again.";
    case "account-id":
      return "We couldn't create your account ID. Please try again.";
    case "sign-in":
      return "Your account is ready, but we couldn't sign you in. Please try again.";
  }
}
