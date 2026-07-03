// AUTHORED-BY Claude Fable 5
/**
 * The current working exclusion set (DESIGN §2.2 entity 9, `diet:DietPlan`) — the
 * "what am I currently avoiding, and why" view. A PURE derivation over the diary's
 * grounded state:
 *
 *  - **Confirmed reactions** — a {@link StoredConclusion} with an exclusion verdict
 *    (`reacts` / `dose-dependent`) from a completed protocol (the sole `confirmed`
 *    path). This is the durable "why": your own test found it.
 *  - **Active eliminations** — a {@link StoredProtocol} currently in `eliminate` or
 *    `washout`, where the target is being left out AS PART OF a running test (not yet
 *    a conclusion). During `reintroduce`/`observe` the food is being eaten again, so
 *    it is NOT an exclusion; `baseline` and `concluded` are likewise not avoidance.
 *
 * The engine is biased toward EXPANSION (orthorexia guard): every time-boxed
 * exclusion whose `reviewAfter` date has passed is flagged `reviewDue` so the view
 * can proactively offer a re-challenge — the plan's job is to SHRINK where evidence
 * allows. Gluten (coeliac) is lifelong and is NEVER flagged for review (it is not in
 * {@link TIME_BOXED_TRIGGERS}; we fail closed on the trigger set here too, exactly as
 * {@link surfaceReviews} does, so stray/legacy `reviewAfter` data can never produce a
 * "re-test gluten" flag).
 *
 * No I/O; fully unit-testable.
 */

import type { TriggerSlug, Verdict } from "@jeswr/solid-health-diary";
import type { StoredConclusion, StoredProtocol } from "../cache/diary-store";
import { TIME_BOXED_TRIGGERS } from "./conclude";

/** Why a trigger is on the current avoid-list. */
export type ExclusionReason =
  /** A completed elimination test found you react to it. */
  | "confirmed-reaction"
  /** You are currently leaving it out as part of a running test. */
  | "active-elimination";

/** One entry on the current exclusion set. */
export interface PlanExclusion {
  trigger: TriggerSlug;
  reason: ExclusionReason;
  /** The verdict of the confirmed reaction (for `confirmed-reaction`). */
  verdict?: Verdict;
  /** The conclusion IRI the exclusion rests on (`diet:restsOn`, tap-through). */
  conclusionId?: string;
  /** The protocol driving an `active-elimination` exclusion. */
  protocolUlid?: string;
  /** `diet:reviewAfter` — when to re-test a time-boxed secondary intolerance. */
  reviewAfter?: Date;
  /** True when a time-boxed exclusion's review date has passed (offer a re-challenge). */
  reviewDue: boolean;
  /** True when this exclusion is time-boxed at all (secondary intolerance, can ease). */
  timeBoxed: boolean;
  /** Free-text note carried from the conclusion (why, in the user's own words). */
  note?: string;
}

/** The derived current plan (DESIGN §2.2 entity 9). */
export interface CurrentPlan {
  /** The current avoid-list, most-actionable (review-due) first. */
  exclusions: PlanExclusion[];
  /** Convenience: how many exclusions are due for a re-challenge (expansion bias). */
  reviewDueCount: number;
}

function parseDate(iso: string | undefined): Date | undefined {
  if (!iso) return undefined;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function isExclusionVerdict(v: Verdict): boolean {
  return v === "reacts" || v === "dose-dependent";
}

/** Protocol phases in which the target trigger is actively being AVOIDED. */
const AVOIDING_PHASES = new Set(["eliminate", "washout"]);

/**
 * Derive the current exclusion set from cached conclusions + protocols. Confirmed
 * reactions win over active-elimination for the same trigger (a completed test is a
 * stronger "why" than a running one). Pure; `now` injectable for tests.
 */
export function deriveCurrentPlan(
  conclusions: readonly StoredConclusion[],
  protocols: readonly StoredProtocol[] = [],
  now: Date = new Date(),
  timeBoxedTriggers: readonly TriggerSlug[] = TIME_BOXED_TRIGGERS,
): CurrentPlan {
  const byTrigger = new Map<TriggerSlug, PlanExclusion>();

  // 1. Confirmed reactions (durable "why") — the strongest source.
  for (const c of conclusions) {
    if (c.confidence !== "confirmed") continue;
    if (!isExclusionVerdict(c.verdict)) continue;
    const timeBoxed = timeBoxedTriggers.includes(c.aboutTrigger);
    const reviewAfter = parseDate(c.reviewAfter);
    // Fail closed on the trigger set: a lifelong exclusion (e.g. gluten) is never
    // review-due, even if untrusted/legacy data stamped a `reviewAfter` on it.
    const reviewDue = timeBoxed && !!reviewAfter && reviewAfter.getTime() <= now.getTime();
    byTrigger.set(c.aboutTrigger, {
      trigger: c.aboutTrigger,
      reason: "confirmed-reaction",
      verdict: c.verdict,
      conclusionId: c.url,
      reviewAfter,
      reviewDue,
      timeBoxed,
      note: c.note,
    });
  }

  // 2. Active eliminations — only for a trigger not already explained by a conclusion.
  for (const p of protocols) {
    if (!AVOIDING_PHASES.has(p.phase)) continue;
    if (byTrigger.has(p.targetTrigger)) continue;
    byTrigger.set(p.targetTrigger, {
      trigger: p.targetTrigger,
      reason: "active-elimination",
      protocolUlid: p.ulid,
      reviewDue: false,
      timeBoxed: timeBoxedTriggers.includes(p.targetTrigger),
    });
  }

  const exclusions = [...byTrigger.values()].sort(
    (a, b) =>
      Number(b.reviewDue) - Number(a.reviewDue) ||
      cmp(a.trigger, b.trigger),
  );
  return { exclusions, reviewDueCount: exclusions.filter((e) => e.reviewDue).length };
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
