// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * Reintroduction scheduling (DESIGN §3, RESEARCH §2.4) — compute the dose-escalation
 * ladder for a SINGLE active protocol, respecting the washout period and observing
 * each dose over the trigger's own lag window.
 *
 * Defaults (RESEARCH §2.4, user-adjustable): washout ≥3 days before the first dose;
 * dose steps ~3 days apart (small → moderate → full); each dose observed for its
 * trigger's `lagWindowMax` hours (so a late reaction is not missed — gluten's window
 * runs to 72 h). The one-active-challenge invariant means a caller only ever
 * schedules the ONE protocol in an active phase (see `./propose`).
 */

import type { ProtocolData, TriggerClassData, TriggerSlug } from "@jeswr/solid-health-diary";
import { HOUR_MS, resolveLag } from "./lag";
import type { ReintroductionSchedule, ReintroductionStep } from "./types";

const DAY_MS = 86_400_000;

/** Default reintroduction parameters (RESEARCH §2.4). */
export const REINTRODUCTION_DEFAULTS = {
  washoutDays: 3,
  stepIntervalDays: 3,
  doses: ["small", "moderate", "full"] as const,
} satisfies { washoutDays: number; stepIntervalDays: number; doses: readonly ("small" | "moderate" | "full")[] };

/** Options for {@link scheduleReintroduction}. */
export interface ReintroductionOptions {
  /** "Now" — the schedule anchor (defaults to `new Date()`). */
  now?: Date;
  /** Washout (days) before the first dose. */
  washoutDays?: number;
  /** Days between successive dose steps. */
  stepIntervalDays?: number;
  /** Per-user lag profiles (for the observe window); falls back to evidence priors. */
  triggerClasses?: readonly TriggerClassData[];
}

/**
 * Compute the reintroduction schedule for a protocol. Doses begin AFTER the washout
 * (`now + washoutDays`) and step at `stepIntervalDays` intervals; each dose is
 * observed until `dose time + lagWindowMax` (the trigger's own window). Deterministic
 * from the inputs.
 */
export function scheduleReintroduction(
  protocol: ProtocolData,
  options: ReintroductionOptions = {},
): ReintroductionSchedule {
  const now = options.now ?? new Date();
  const washoutDays = options.washoutDays ?? REINTRODUCTION_DEFAULTS.washoutDays;
  const stepIntervalDays = options.stepIntervalDays ?? REINTRODUCTION_DEFAULTS.stepIntervalDays;
  const trigger: TriggerSlug = protocol.targetTrigger;
  const lag = resolveLag(trigger, options.triggerClasses);
  const observeMs = lag.lagWindowMax * HOUR_MS;

  const firstDose = new Date(now.getTime() + washoutDays * DAY_MS);
  // `challengeStep` is an INDEX into the fixed dose ladder, not a numeric offset:
  // resuming at step 2 schedules the REMAINING doses (`full`), keeping each label
  // aligned with its real ladder index — never inventing steps past `full`.
  const ladder = REINTRODUCTION_DEFAULTS.doses;
  const startStep = clamp(protocol.challengeStep ?? 0, 0, ladder.length);
  const remaining = ladder.slice(startStep);

  const steps: ReintroductionStep[] = remaining.map((dose, i) => {
    const scheduledFor = new Date(firstDose.getTime() + i * stepIntervalDays * DAY_MS);
    return {
      step: startStep + i,
      scheduledFor,
      observeUntil: new Date(scheduledFor.getTime() + observeMs),
      dose,
    };
  });

  return {
    protocolId: protocol.id,
    trigger,
    steps,
    washoutDays,
  };
}

/** Clamp `n` to `[lo, hi]`; a non-finite value clamps to `lo`. */
function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.min(Math.max(Math.trunc(n), lo), hi);
}
