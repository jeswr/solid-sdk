// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * Confirmation — the ONLY path to a `confirmed` ("confirmed-by-your-own-test")
 * verdict (DESIGN §4.2). Correlation only ever *proposes* (see `./correlate` — its
 * output cannot even represent `confirmed`); a conclusion reaches `confirmed`
 * confidence ONLY here, and ONLY from a protocol that has actually reached the
 * `concluded` phase. This is the scientific spine: correlation suggests, a completed
 * elimination protocol confirms.
 *
 * The engine is BIASED TOWARD EXPANSION (orthorexia guard, DESIGN §4.3, RESEARCH
 * §2.8): a "reacts" / "dose-dependent" conclusion for a SECONDARY (gut-healing)
 * intolerance is TIME-BOXED with a `reviewAfter` re-challenge date, so the avoid-list
 * is revisited and can shrink as the gut heals (RESEARCH §2.2 — dairy tolerance
 * typically returns after ≥6 months). Gluten (coeliac) is lifelong and is never
 * time-boxed.
 */

import type { ProtocolData, ToleranceConclusionData, TriggerSlug, Verdict } from "@jeswr/solid-health-diary";

/**
 * SECONDARY intolerances that can resolve as the gut heals, so their "reacts"
 * conclusions are TIME-BOXED for re-challenge (RESEARCH §2.2 secondary lactose
 * intolerance + the FODMAP subgroups that ride the same villous-healing timeline).
 * Gluten is deliberately absent — coeliac gluten avoidance is lifelong.
 */
export const TIME_BOXED_TRIGGERS: readonly TriggerSlug[] = [
  "lactose",
  "fructose",
  "fructan",
  "galactan",
  "polyol",
];

/** Default re-challenge interval for a time-boxed conclusion: 6 months (RESEARCH §2.2). */
export const DEFAULT_REVIEW_AFTER_DAYS = 182;

/** Options for {@link deriveConfirmedConclusion}. */
export interface ConcludeOptions {
  /** When the protocol concluded (defaults to `now`). */
  now?: Date;
  /** Re-challenge interval (days) for a time-boxed conclusion. */
  reviewAfterDays?: number;
  /** The pod-owner Patient/Person WebID to stamp on the conclusion. */
  patient?: string;
  /** Extra evidence IRIs (exposures/symptoms) the conclusion rests on. */
  derivedFrom?: readonly string[];
  /** Override the time-boxed-trigger set (defaults to {@link TIME_BOXED_TRIGGERS}). */
  timeBoxedTriggers?: readonly TriggerSlug[];
}

/**
 * Derive a CONFIRMED tolerance conclusion from a COMPLETED protocol and its observed
 * verdict. Returns `undefined` if the protocol has NOT reached the `concluded` phase
 * — the hard guard that `confirmed` never comes from anything but a finished test.
 * The observed `verdict` is supplied by the caller (the protocol reducer, Brief 2B,
 * records the reaction outcome the FSM reached); this function does not itself judge
 * reaction — it stamps confirmation onto a genuinely completed protocol.
 */
export function deriveConfirmedConclusion(
  protocol: ProtocolData,
  verdict: Verdict,
  options: ConcludeOptions = {},
): ToleranceConclusionData | undefined {
  if (protocol.phase !== "concluded") return undefined; // HARD GUARD (DESIGN §4.2).
  const now = options.now ?? new Date();
  const trigger = protocol.targetTrigger;
  const timeBoxed = options.timeBoxedTriggers ?? TIME_BOXED_TRIGGERS;
  const isTimeBoxed =
    (verdict === "reacts" || verdict === "dose-dependent") && timeBoxed.includes(trigger);

  const conclusion: ToleranceConclusionData = {
    aboutTrigger: trigger,
    verdict,
    confidence: "confirmed",
    note: confirmedNote(trigger, verdict),
    derivedFrom: dedupe([
      ...(protocol.id ? [protocol.id] : []),
      ...(options.derivedFrom ?? []),
    ]),
  };
  if (options.patient) conclusion.patient = options.patient;
  if (isTimeBoxed) {
    const days = options.reviewAfterDays ?? DEFAULT_REVIEW_AFTER_DAYS;
    conclusion.reviewAfter = addDaysUtc(now, days);
  }
  return conclusion;
}

// --- helpers -----------------------------------------------------------------

function confirmedNote(trigger: TriggerSlug, verdict: Verdict): string {
  const base = `Confirmed by your own elimination challenge for ${trigger}.`;
  switch (verdict) {
    case "tolerated":
      return `${base} You tolerated it through the full reintroduction — no need to avoid it on this evidence.`;
    case "reacts":
      return `${base} A reaction was reproduced on reintroduction.`;
    case "dose-dependent":
      return `${base} You reacted at higher doses but not smaller ones — it may be dose-dependent.`;
    case "inconclusive":
      return `${base} The challenge was inconclusive — a repeat test may help.`;
    default:
      return base;
  }
}

/** Add whole days to a UTC calendar date (matches the model's UTC-anchored xsd:date). */
function addDaysUtc(from: Date, days: number): Date {
  const d = new Date(
    Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate() + days),
  );
  return d;
}

function dedupe(items: readonly string[]): string[] {
  return [...new Set(items)];
}
