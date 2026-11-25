// AUTHORED-BY Claude Sonnet 5.5
/**
 * How the page understands a feedback API answer. Permanent failures (the request can never
 * succeed as sent), failures that provably never reached storage, and uncertain ones (the
 * record may already be stored) need different advice and different state.
 */
export type FailureKind =
  | "retry-later" // Storage busy or in cooldown, possibly mid-save: retry the same record.
  | "rate-limited" // The limiter refused it before storage was touched.
  | "unavailable" // Storage is not switched on; nothing was written.
  | "receipts" // Recording receipts are invalid or expired.
  | "conflict" // The submission ID was used for different feedback.
  | "too-large"
  | "unsupported"
  | "invalid"
  | "unknown"; // Network failure, timeout, 5xx, unreadable answer.

export class FeedbackFailure extends Error {
  constructor(
    readonly kind: FailureKind,
    /** True when the request may have reached storage, so the record may already be saved. */
    readonly mayHaveStored: boolean,
  ) {
    super(kind);
  }
}
const codes: Record<string, FailureKind> = {
  receipts_invalid: "receipts",
  rate_limited: "rate-limited",
  storage_busy: "retry-later",
  unavailable: "unavailable",
  conflict: "conflict",
  too_large: "too-large",
  unsupported: "unsupported",
  invalid: "invalid",
};
const definite: FailureKind[] = [
  "rate-limited",
  "unavailable",
  "receipts",
  "conflict",
  "too-large",
  "unsupported",
  "invalid",
];
const fromStatus = (status: number, retryAfter: boolean): FailureKind =>
  status === 400 || status === 422
    ? "invalid"
    : status === 409
      ? "conflict"
      : status === 413
        ? "too-large"
        : status === 415
          ? "unsupported"
          : retryAfter && (status === 429 || status === 503)
            ? "retry-later"
            : "unknown";
/** Classify a non-OK response from its machine-readable `code`, then its status. */
export function classifyFailure(status: number, retryAfter: boolean, code?: unknown) {
  const kind =
    (typeof code === "string" ? codes[code] : undefined) ?? fromStatus(status, retryAfter);
  return new FeedbackFailure(kind, !definite.includes(kind));
}

/** Platform errors may be HTML or plain text; never display upstream error bodies. */
export async function feedbackResponse(response: Response) {
  if (!response.ok) {
    const body = response.headers.get("content-type")?.includes("application/json")
      ? await response.json().catch(() => undefined)
      : undefined;
    throw classifyFailure(response.status, response.headers.has("Retry-After"), body?.code);
  }
  if (!response.headers.get("content-type")?.includes("application/json"))
    throw new Error("Feedback request failed.");
  const value = await response.json().catch(() => undefined);
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Feedback response is unavailable.");
  return value;
}
export const asFailure = (error: unknown): FeedbackFailure =>
  error instanceof FeedbackFailure ? error : new FeedbackFailure("unknown", true);

const keep = "Use Download my feedback to keep a copy.";
export function failureMessage(
  kind: FailureKind,
  {
    recordingsHere,
    stage,
    frozen = false,
  }: { recordingsHere: boolean; stage: "upload" | "submit"; frozen?: boolean },
): string {
  const kept = recordingsHere
    ? "Your answers and recordings are still here."
    : "Your answers are still here.";
  switch (kind) {
    case "retry-later":
      return `Feedback storage is busy. Please try again later. ${kept} ${keep}`;
    case "rate-limited":
      return `You've reached the feedback allowance for now. Please try again later. ${kept} ${keep}`;
    case "unavailable":
      return `Feedback storage isn't available, so this can't be submitted. ${kept} ${keep}`;
    case "receipts":
      return recordingsHere
        ? "Your saved recordings are no longer valid. Press Submit to upload them again."
        : "Your saved recordings are no longer valid.";
    case "conflict":
      return `This submission ID was already used for different feedback, so it can't be sent again. ${keep} Then choose Start a new submission.`;
    case "too-large":
      return `This feedback is too large to send. ${keep}`;
    case "unsupported":
      return `We couldn't send this ${stage === "upload" ? "recording" : "feedback"} in a format the server accepts. ${keep}`;
    case "invalid":
      // A record that may already be stored cannot be edited, so "check your answers" is wrong.
      if (frozen && stage === "submit")
        return `We couldn't accept this feedback, and it can't be changed here because an earlier attempt may already have reached the team. ${keep} Then choose Start a new submission.`;
      return stage === "upload"
        ? `A recording was rejected. It may be too large or in an unsupported format. ${keep}`
        : `We couldn't accept this feedback. Check your answers and contact details (for example, the email address) and submit again. ${keep}`;
    default:
      return stage === "upload"
        ? `We couldn't save that recording. ${recordingsHere ? "Your audio is still here. " : ""}Try submitting again. ${keep}`
        : `We couldn't submit your feedback. ${kept} Try again. ${keep}`;
  }
}
