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
import { latestByTrigger } from "./latest-conclusion";

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
 *
 * Conclusions are FIRST collapsed to the single LATEST confirmed one per trigger
 * ({@link latestByTrigger}, deterministic tie-break) so stale guidance can never
 * surface: a newer `tolerated` supersedes an older `reacts`. How the latest is used
 * depends on whether the trigger can genuinely resolve:
 *
 *  - **Time-boxed (secondary intolerance — lactose, the FODMAP subgroups):** the
 *    LATEST conclusion decides. A newer `tolerated` CLEARS it from the avoid-list
 *    (the expansion / orthorexia guard — shrink where evidence allows).
 *  - **Lifelong (gluten/coeliac + other non-time-boxed exclusions):** STICKY. Once a
 *    confirmed reaction exists it stays excluded; a later `tolerated` conclusion can
 *    NEVER clear it and it is never review-flagged. This is the lifelong-exclusion
 *    rail — gluten avoidance is permanent regardless of any conclusion ordering.
 */
export function deriveCurrentPlan(
  conclusions: readonly StoredConclusion[],
  protocols: readonly StoredProtocol[] = [],
  now: Date = new Date(),
  timeBoxedTriggers: readonly TriggerSlug[] = TIME_BOXED_TRIGGERS,
): CurrentPlan {
  const byTrigger = new Map<TriggerSlug, PlanExclusion>();

  // 1. Confirmed reactions (durable "why"), collapsed to the current one per trigger.
  const confirmed = conclusions.filter((c) => c.confidence === "confirmed");
  const accessors = {
    triggerOf: (c: StoredConclusion) => c.aboutTrigger,
    createdMsOf: (c: StoredConclusion) => Date.parse(c.createdAt),
    idOf: (c: StoredConclusion) => c.url,
  };
  // The current confirmed conclusion per trigger (ANY verdict — so a latest
  // `tolerated` is visible), and the current confirmed EXCLUSION conclusion per
  // trigger (for the lifelong-sticky path).
  const latest = latestByTrigger(confirmed, accessors);
  const latestExclusion = latestByTrigger(
    confirmed.filter((c) => isExclusionVerdict(c.verdict)),
    accessors,
  );

  for (const [trigger, current] of latest) {
    const timeBoxed = timeBoxedTriggers.includes(trigger);
    // Time-boxed → the latest verdict decides (a newer `tolerated` clears it).
    // Lifelong → any confirmed exclusion sticks, never cleared by a later `tolerated`.
    const source = timeBoxed
      ? isExclusionVerdict(current.verdict)
        ? current
        : undefined
      : latestExclusion.get(trigger);
    if (!source) continue; // cleared (time-boxed latest tolerated) or never a reaction
    const reviewAfter = parseDate(source.reviewAfter);
    // Fail closed on the trigger set: a lifelong exclusion (e.g. gluten) is never
    // review-due, even if untrusted/legacy data stamped a `reviewAfter` on it.
    const reviewDue = timeBoxed && !!reviewAfter && reviewAfter.getTime() <= now.getTime();
    byTrigger.set(trigger, {
      trigger,
      reason: "confirmed-reaction",
      verdict: source.verdict,
      conclusionId: source.url,
      reviewAfter,
      reviewDue,
      timeBoxed,
      note: source.note,
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
