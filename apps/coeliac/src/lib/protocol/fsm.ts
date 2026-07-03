// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * The elimination-protocol state machine (coeliac-app DESIGN §3, RESEARCH §2.4,
 * Brief 2B) — a PURE reducer over `@jeswr/solid-health-diary`'s
 * {@link ProtocolData}. No I/O, no React, no RDF: a protocol + an event + `now`
 * in, a new protocol (and, on conclusion, the observed {@link Verdict}) out.
 *
 * The FSM (model phases `baseline`/`eliminate`/`washout`/`reintroduce`/`observe`/
 * `concluded`):
 *
 * ```
 * baseline    ──advance-phase──────────────────────────▶ eliminate
 * eliminate   ──advance-phase{symptomsImproved:true}───▶ washout
 * eliminate   ──advance-phase{symptomsImproved:false}──▶ concluded[tolerated]   (trigger not implicated)
 * washout     ──advance-phase──────────────────────────▶ reintroduce (challengeStep 0)   ‡ one-active-challenge guard
 * reintroduce ──advance-phase (take the dose)──────────▶ observe
 * observe     ──record-outcome{reacted:true}───────────▶ concluded[reacts | dose-dependent]
 * observe     ──record-outcome{reacted:false}──────────▶ reintroduce (next dose)  OR  concluded[tolerated]
 * <any non-concluded> ──abort──────────────────────────▶ concluded[inconclusive]
 * ```
 *
 * **HEALTH-SAFETY RAILS (hard-coded, non-negotiable — RESEARCH §4, DESIGN §4.4).**
 * These live at protocol CREATION ({@link startProtocol}) AND, defence-in-depth, at
 * the `washout → reintroduce` transition (the moment a challenge becomes an active
 * reintroduction — the only genuinely risky edge). A rail is a REFUSAL, never a
 * silent no-op:
 *
 * 1. **Gluten is never elimination-reintroduction-challenged.** Pre-diagnosis →
 *    "get tested first" (going gluten-free invalidates serology + biopsy). For a
 *    CONFIRMED coeliac → gluten exclusion is LIFELONG; reintroducing gluten is
 *    dangerous, so it is refused outright. There is no path by which this reducer
 *    reintroduces gluten.
 * 2. **A trigger with an emergency (anaphylaxis / breathing) history is never
 *    auto-challenged.** The caller supplies the emergency-trigger set (derived from
 *    the emergency-rail symptoms the diary model marks); such a trigger is refused —
 *    a reaction there is an emergency-rail matter for medically-supervised testing,
 *    never a self-run challenge.
 * 3. **One active challenge at a time.** Starting a second protocol while any other
 *    is still in progress (non-`concluded`) is refused — concurrent challenges
 *    destroy attribution (the model's stricter invariant is over `reintroduce`/
 *    `observe`; we refuse earlier, at any in-progress protocol, to match the
 *    one-variable rule).
 *
 * Every challenge is **time-boxed** (each phase carries a `phasePlannedEnd`) and
 * **abortable** (the `abort` event concludes it `inconclusive` from any live phase).
 * It is a SUGGESTION: the surface always shows "discuss with your clinician or
 * dietitian." The reducer **fails closed** on malformed input (an unknown phase, a
 * mismatched event, an already-concluded protocol) — it returns the protocol
 * unchanged with a typed rejection rather than inventing a transition.
 */

import {
  isActiveChallengePhase,
  type ProtocolData,
  type ProtocolPhase,
  PROTOCOL_PHASES,
  type TriggerClassData,
  type TriggerSlug,
  type Verdict,
} from "@jeswr/solid-health-diary";
import { HOUR_MS, resolveLag } from "../inference/lag";
import { DEFAULT_PHASE_SCHEDULE } from "../inference/propose";
import { REINTRODUCTION_DEFAULTS } from "../inference/reintroduction";
import type { PhaseSchedule } from "../inference/types";

const DAY_MS = 86_400_000;

/** The clinician caveat carried on every proposal/prompt (never a bare instruction). */
export const CLINICIAN_CAVEAT =
  "This is a suggestion, not medical advice — discuss any elimination or reintroduction " +
  "challenge with your clinician or dietitian before you start, and stop if you feel unwell.";

/** The ordered dose ladder for a reintroduction (small → moderate → full; RESEARCH §2.4). */
export const DOSE_LADDER = REINTRODUCTION_DEFAULTS.doses;

/** An event applied to a protocol by {@link advanceProtocol}. Discriminated union. */
export type ProtocolEvent =
  /**
   * Progress the deterministic phases. `symptomsImproved` is read ONLY on the
   * `eliminate` phase: `true` ⇒ proceed to `washout` (the trigger looks implicated,
   * go on to confirm by reintroduction); `false`/absent-on-eliminate ⇒ conclude
   * `tolerated` (eliminating it changed nothing — it is not your trigger, keep
   * eating it: the expansion bias). On `reintroduce` this event means "I have taken
   * this dose" and moves to `observe`.
   */
  | { type: "advance-phase"; symptomsImproved?: boolean }
  /** Record the outcome of the dose under observation. Valid ONLY in `observe`. */
  | { type: "record-outcome"; reacted: boolean }
  /** Abort the challenge from any live phase → `concluded` with verdict `inconclusive`. */
  | { type: "abort"; reason?: string };

/** Why an event was refused (protocol returned unchanged). */
export type ProtocolRejectionKind =
  /** The event does not apply to the current phase. */
  | "invalid-transition"
  /** The protocol has already `concluded` — no further events apply. */
  | "already-concluded"
  /** `record-outcome` used outside `observe`. */
  | "outcome-outside-observe"
  /** Entering an active reintroduction blocked by a health-safety rail. */
  | "safety-blocked";

/** A refused event: the protocol is unchanged and this explains why. */
export interface ProtocolRejection {
  kind: ProtocolRejectionKind;
  message: string;
  /** Present when the rejection is a health-safety rail (kind `safety-blocked`). */
  safety?: SafetyRefusal;
}

/** A supportive, non-gamified prompt scheduled when a phase begins. */
export interface ProtocolPrompt {
  phase: ProtocolPhase;
  /** Plain-language, encouraging-not-restrictive guidance for this phase. */
  message: string;
  /** When this phase is planned to end (the time-box); absent for act-now phases. */
  dueAt?: Date;
}

/** The result of applying an event: a new protocol, plus verdict/prompt or a rejection. */
export interface AdvanceResult {
  /** The protocol after the event (UNCHANGED when `rejection` is set). */
  protocol: ProtocolData;
  /**
   * Set ONLY when the protocol reached `concluded` on THIS event — the observed
   * verdict to hand to `deriveConfirmedConclusion` (the sole `confirmed` path). The
   * reducer does not mint the conclusion itself; it surfaces the verdict.
   */
  verdict?: Verdict;
  /** The supportive prompt for the phase just entered (absent on a rejection). */
  prompt?: ProtocolPrompt;
  /** Set when the event was refused — the protocol is returned unchanged. */
  rejection?: ProtocolRejection;
}

/** Options controlling durations + the observe window. */
export interface ProtocolOptions {
  /** Per-phase durations (RESEARCH §2.4). Defaults to {@link DEFAULT_PHASE_SCHEDULE}. */
  schedule?: PhaseSchedule;
  /** Per-user lag profiles (for the observe window); falls back to evidence priors. */
  triggerClasses?: readonly TriggerClassData[];
  /**
   * Number of reintroduction dose steps (default + max {@link DOSE_LADDER}.length =
   * 3). Clamped to `[1, DOSE_LADDER.length]` — the ladder only names 3 doses, so a
   * larger value would produce steps whose labels collapse to a repeated "full".
   */
  doseSteps?: number;
  /**
   * The OTHER protocols in the pod (excluding this one). The one-active-challenge
   * invariant is re-checked against these at the `washout → reintroduce` edge — a
   * second protocol can never be advanced into an active reintroduction while
   * another is already active (imported / raced / duplicated protocols included).
   */
  otherProtocols?: readonly ProtocolData[];
}

// --- health-safety rails -----------------------------------------------------

/** A health-safety refusal (RESEARCH §4). */
export interface SafetyRefusal {
  kind:
    | "gluten-pre-diagnosis"
    | "gluten-lifelong-exclusion"
    | "emergency-trigger"
    | "active-challenge-exists";
  message: string;
}

/** Safety signals the diary model cannot itself represent (DESIGN §4.4, RESEARCH §4). */
export interface ProtocolSafetyContext {
  /**
   * Whether the user has a CONFIRMED coeliac diagnosis (serology + biopsy).
   * `undefined`/`false` ⇒ NOT diagnosed ⇒ gluten elimination is blocked
   * ("get tested first"). `true` ⇒ gluten exclusion is LIFELONG ⇒ a gluten
   * reintroduction challenge is refused as dangerous. Either way gluten is never
   * challenged — only the message differs.
   */
  coeliacDiagnosed?: boolean;
  /**
   * Triggers that have produced an emergency (anaphylaxis / breathing-difficulty)
   * symptom in this user's diary. Such a trigger is NEVER auto-challenged — a
   * reaction is an emergency-rail, medically-supervised matter (RESEARCH §2.7 —
   * sulphite asthma/anaphylactoid responses; true IgE allergy ≠ intolerance).
   */
  emergencyTriggers?: readonly TriggerSlug[];
}

/**
 * The single chokepoint for the "never enter an active gluten / emergency-trigger
 * reintroduction" rails. Returns a {@link SafetyRefusal} when the trigger must NOT
 * be challenged, else `undefined`. Called by BOTH {@link startProtocol} (creation)
 * and {@link advanceProtocol} at `washout → reintroduce` (defence-in-depth), so
 * there is no code path that reintroduces a blocked trigger.
 */
export function challengeSafetyRefusal(
  trigger: TriggerSlug,
  safety: ProtocolSafetyContext = {},
): SafetyRefusal | undefined {
  // RAIL 1 — gluten is never elimination-reintroduction-challenged.
  if (trigger === "gluten") {
    return safety.coeliacDiagnosed === true
      ? {
          kind: "gluten-lifelong-exclusion",
          message:
            "Gluten can't be reintroduced. For coeliac disease, a strict gluten-free diet is " +
            "lifelong — reintroducing gluten to 'test' it would restart the autoimmune damage " +
            "and is dangerous. There is no safe self-run gluten challenge; speak to your " +
            "specialist about any gluten question.",
        }
      : {
          kind: "gluten-pre-diagnosis",
          message:
            "Don't run a gluten challenge yet. Coeliac disease is diagnosed by a blood test and a " +
            "biopsy taken WHILE you are still eating gluten — going gluten-free first can make the " +
            "tests come back falsely negative. Get tested first, then this app can help you manage it.",
        };
  }
  // RAIL 2 — a trigger with an emergency (anaphylaxis / breathing) history.
  if (safety.emergencyTriggers?.includes(trigger)) {
    return {
      kind: "emergency-trigger",
      message:
        `You've logged a breathing-difficulty or anaphylaxis-type reaction involving ${trigger}. ` +
        "That is an emergency-level reaction, not a food intolerance to self-test — deliberately " +
        "re-exposing yourself could be life-threatening. Any challenge must be done under medical " +
        "supervision (e.g. a supervised food challenge), never in this app.",
    };
  }
  return undefined;
}

// --- start -------------------------------------------------------------------

/** Inputs for {@link startProtocol}. */
export interface StartProtocolInput {
  /** The trigger to test. */
  trigger: TriggerSlug;
  /** The pod-owner Patient/Person WebID to stamp on the protocol. */
  patient?: string;
  /** Other protocols already in the pod — the one-active-challenge guard reads these. */
  existingProtocols?: readonly ProtocolData[];
}

/** The result of a start attempt: an `ok` protocol at `baseline`, or a refusal. */
export type StartResult =
  | { ok: true; protocol: ProtocolData; prompt: ProtocolPrompt }
  | { ok: false; refusal: SafetyRefusal };

/**
 * Instantiate a new protocol at the `baseline` phase for `trigger` — the one-tap
 * "start an elimination challenge for X" (DESIGN §3, §4.3). Refuses (never creates)
 * when a health-safety rail fires or another challenge is in progress. The created
 * protocol carries a planned `baseline` end (time-boxed) and a supportive prompt.
 */
export function startProtocol(
  input: StartProtocolInput,
  safety: ProtocolSafetyContext = {},
  now: Date = new Date(),
  options: ProtocolOptions = {},
): StartResult {
  // One-variable-at-a-time: refuse while ANY other protocol is still in progress.
  const inProgress = (input.existingProtocols ?? []).find((p) => p.phase !== "concluded");
  if (inProgress) {
    return {
      ok: false,
      refusal: {
        kind: "active-challenge-exists",
        message:
          `A challenge for ${inProgress.targetTrigger} is already in progress (its ` +
          `${inProgress.phase} phase). Finish or abort it first — testing one trigger at a time ` +
          "is the only way to know which one is responsible.",
      },
    };
  }
  // Health-safety rails (gluten / emergency trigger) — refuse at creation.
  const refusal = challengeSafetyRefusal(input.trigger, safety);
  if (refusal) return { ok: false, refusal };

  const schedule = options.schedule ?? DEFAULT_PHASE_SCHEDULE;
  const protocol: ProtocolData = {
    targetTrigger: input.trigger,
    phase: "baseline",
    phaseStarted: now,
    phasePlannedEnd: addDays(now, schedule.baselineDays),
    created: now,
  };
  if (input.patient) protocol.patient = input.patient;
  return { ok: true, protocol, prompt: promptFor(protocol) };
}

// --- reducer -----------------------------------------------------------------

/**
 * Apply `event` to `protocol` at time `now`. PURE — returns a fresh protocol (the
 * input is never mutated). On a rejected event the protocol is returned UNCHANGED
 * with a typed {@link ProtocolRejection} (fail-closed: no invented transitions).
 */
export function advanceProtocol(
  protocol: ProtocolData,
  event: ProtocolEvent,
  now: Date = new Date(),
  safety: ProtocolSafetyContext = {},
  options: ProtocolOptions = {},
): AdvanceResult {
  // Fail-closed on an unknown/malformed phase BEFORE handling any event (including
  // abort) — malformed data must never be transitioned to `concluded`.
  if (!(PROTOCOL_PHASES as readonly string[]).includes(protocol.phase)) {
    return reject(protocol, {
      kind: "invalid-transition",
      message: `Unknown protocol phase '${String(protocol.phase)}'.`,
    });
  }
  // Fail-closed on a non-object / typeless event (e.g. null / undefined) — never
  // read `.type` off malformed input.
  if (event == null || typeof event !== "object" || typeof (event as { type?: unknown }).type !== "string") {
    return reject(protocol, {
      kind: "invalid-transition",
      message: "Malformed protocol event (expected an object with a string `type`).",
    });
  }
  // Terminal + abort handled uniformly first.
  if (protocol.phase === "concluded") {
    return reject(protocol, {
      kind: "already-concluded",
      message: "This challenge is already concluded — it accepts no further steps.",
    });
  }
  if (event.type === "abort") {
    // Abort is ALWAYS available (the escape hatch) — even from a malformed active
    // state — so a stuck / bad-data protocol can always be safely concluded.
    const concluded = conclude(protocol, now);
    return {
      protocol: concluded,
      verdict: "inconclusive",
      prompt: promptFor(concluded, "inconclusive"),
    };
  }
  // HEALTH-SAFETY TOP GUARD: for a safety-blocked trigger (gluten always; a trigger
  // with an emergency history) the ONLY permitted event is `abort` (handled above).
  // Every other event — including an `eliminate → concluded[tolerated]` that would
  // otherwise become a `confirmed` "gluten is tolerated" conclusion — is refused, so
  // no fabricated / stale / mid-challenge-escalated blocked protocol can advance or
  // conclude. This single chokepoint covers every non-abort transition.
  const topRefusal = challengeSafetyRefusal(protocol.targetTrigger, safety);
  if (topRefusal) {
    return reject(protocol, { kind: "safety-blocked", message: topRefusal.message, safety: topRefusal });
  }
  // Within an active challenge, `challengeStep` MUST be a valid ladder index — a
  // fabricated / out-of-range step must not skip doses or conclude early (fail-closed).
  if (isActiveChallengePhase(protocol.phase)) {
    const step = protocol.challengeStep;
    const maxStep = doseCount(options) - 1;
    if (step === undefined || !Number.isInteger(step) || step < 0 || step > maxStep) {
      return reject(protocol, {
        kind: "invalid-transition",
        message: `Reintroduction step '${String(step)}' is out of range (expected 0–${maxStep}).`,
      });
    }
  }
  if (event.type === "record-outcome") {
    if (protocol.phase !== "observe") {
      return reject(protocol, {
        kind: "outcome-outside-observe",
        message: "A reaction outcome can only be recorded while observing a reintroduction dose.",
      });
    }
    // Fail-closed on a non-boolean `reacted` — a missing/truthy-string value must
    // never be coerced into a react / no-react decision that concludes a protocol.
    if (typeof event.reacted !== "boolean") {
      return reject(protocol, {
        kind: "invalid-transition",
        message: "A dose outcome needs an explicit react / no-react (boolean `reacted`).",
      });
    }
    return recordOutcome(protocol, event.reacted, now, options);
  }
  // Fail-closed on any other (malformed / unknown) event type — never treat it as an
  // implicit advance-phase.
  if (event.type !== "advance-phase") {
    return reject(protocol, {
      kind: "invalid-transition",
      message: `Unknown protocol event '${String((event as { type?: unknown }).type)}'.`,
    });
  }
  switch (protocol.phase) {
    case "baseline":
      return toPhase(protocol, "eliminate", now, options);
    case "eliminate": {
      // Improved ⇒ go on to reintroduction (confirm). Not improved ⇒ the trigger is
      // not implicated — conclude `tolerated` (keep eating it; expansion bias).
      if (event.symptomsImproved === true) return toPhase(protocol, "washout", now, options);
      const concluded = conclude(protocol, now);
      return {
        protocol: concluded,
        verdict: "tolerated",
        prompt: promptFor(concluded, "tolerated"),
      };
    }
    case "washout": {
      // (Health-safety rails already enforced by the top guard.) One-variable-at-a-
      // time, re-enforced at the edge into an active reintroduction
      // — matching the stricter start-time rule: refuse if ANY other protocol is
      // still in progress (not `concluded`). Two challenges in flight destroy
      // attribution.
      const blocked = activeConflictReject(protocol, options);
      if (blocked) return blocked;
      return toPhase(protocol, "reintroduce", now, options, 0);
    }
    case "reintroduce": {
      // "I have taken this dose" → observe. (Health-safety rails already enforced by
      // the top guard.) Re-check only the one-active-challenge conflict.
      const blocked = activeConflictReject(protocol, options);
      if (blocked) return blocked;
      return toPhase(protocol, "observe", now, options, protocol.challengeStep ?? 0);
    }
    case "observe":
      return reject(protocol, {
        kind: "invalid-transition",
        message: "Record whether you reacted to this dose (react / no-react), not advance-phase.",
      });
    default:
      // Unreachable — an unknown phase is rejected at the top (fail-closed). Kept as
      // a defensive belt-and-braces so a future phase addition can't silently fall
      // through to an invented transition.
      return reject(protocol, {
        kind: "invalid-transition",
        message: `No advance-phase transition defined for '${String(protocol.phase)}'.`,
      });
  }
}

// --- observe outcome ---------------------------------------------------------

function recordOutcome(
  protocol: ProtocolData,
  reacted: boolean,
  now: Date,
  options: ProtocolOptions,
): AdvanceResult {
  // (Health-safety rails already enforced by the top guard — a safety-blocked trigger
  // never reaches here on a non-abort event.) One-variable-at-a-time is enforced for
  // EVERY outcome, including the ones that CONCLUDE: if another protocol is in
  // progress, a conclusion produced now would have muddied attribution — refuse until
  // the conflict is resolved (abort still works).
  const blocked = activeConflictReject(protocol, options);
  if (blocked) return blocked;
  const step = protocol.challengeStep ?? 0;
  const lastStep = doseCount(options) - 1;
  if (reacted) {
    // Reacted at the smallest dose ⇒ `reacts`; reacted only after tolerating smaller
    // doses ⇒ `dose-dependent` (RESEARCH §2.4 conclude tolerate/react/dose-dependent).
    const verdict: Verdict = step <= 0 ? "reacts" : "dose-dependent";
    const concluded = conclude(protocol, now);
    return {
      protocol: concluded,
      verdict,
      prompt: promptFor(concluded, verdict),
    };
  }
  // No reaction: more doses left ⇒ next reintroduction dose; otherwise ⇒ `tolerated`.
  if (step < lastStep) {
    return toPhase(protocol, "reintroduce", now, options, step + 1);
  }
  const concluded = conclude(protocol, now);
  return {
    protocol: concluded,
    verdict: "tolerated",
    prompt: promptFor(concluded, "tolerated"),
  };
}

// --- transition helpers ------------------------------------------------------

function toPhase(
  protocol: ProtocolData,
  phase: ProtocolPhase,
  now: Date,
  options: ProtocolOptions,
  challengeStep?: number,
): AdvanceResult {
  const next: ProtocolData = {
    ...protocol,
    phase,
    phaseStarted: now,
    phasePlannedEnd: plannedEnd(phase, protocol.targetTrigger, now, options),
  };
  // `challengeStep` is meaningful only within the reintroduce/observe loop.
  if (challengeStep !== undefined) {
    next.challengeStep = challengeStep;
  } else if (!isActiveChallengePhase(phase)) {
    delete next.challengeStep;
  }
  return { protocol: next, prompt: promptFor(next) };
}

/** Move to `concluded`, clearing the (now-meaningless) planned end + challenge step. */
function conclude(protocol: ProtocolData, now: Date): ProtocolData {
  const next: ProtocolData = { ...protocol, phase: "concluded", phaseStarted: now };
  delete next.phasePlannedEnd;
  delete next.challengeStep;
  return next;
}

function reject(protocol: ProtocolData, rejection: ProtocolRejection): AdvanceResult {
  return { protocol, rejection };
}

/**
 * The one-variable-at-a-time guard, applied at EVERY transition into or within an
 * active challenge phase: if ANY OTHER protocol is still in progress (not
 * `concluded`), refuse — two challenges in flight at once destroy attribution. Abort
 * bypasses this (it is always allowed, so a conflict is resolvable). Returns the
 * rejection, or `undefined` when clear.
 */
function activeConflictReject(
  protocol: ProtocolData,
  options: ProtocolOptions,
): AdvanceResult | undefined {
  const blocking = (options.otherProtocols ?? []).find((p) => p.phase !== "concluded");
  if (!blocking) return undefined;
  return reject(protocol, {
    kind: "safety-blocked",
    message:
      `Another challenge (for ${blocking.targetTrigger}, in its ${blocking.phase} phase) is still ` +
      "in progress. Finish or stop it before continuing this one — running two challenges at once " +
      "makes it impossible to tell which trigger caused a reaction.",
    safety: {
      kind: "active-challenge-exists",
      message: `Another challenge for ${blocking.targetTrigger} is still in progress.`,
    },
  });
}

/** Number of reintroduction dose steps, clamped to `[1, DOSE_LADDER.length]`. */
function doseCount(options: ProtocolOptions): number {
  const n = options.doseSteps ?? DOSE_LADDER.length;
  if (!Number.isFinite(n)) return DOSE_LADDER.length;
  return Math.min(Math.max(Math.trunc(n), 1), DOSE_LADDER.length);
}

/** The planned end of a phase (the time-box); `undefined` for act-now phases. */
function plannedEnd(
  phase: ProtocolPhase,
  trigger: TriggerSlug,
  now: Date,
  options: ProtocolOptions,
): Date | undefined {
  const schedule = options.schedule ?? DEFAULT_PHASE_SCHEDULE;
  switch (phase) {
    case "baseline":
      return addDays(now, schedule.baselineDays);
    case "eliminate":
      return addDays(now, schedule.eliminateDays);
    case "washout":
      return addDays(now, schedule.washoutDays);
    case "observe": {
      // Observe each dose over the trigger's OWN lag window (gluten runs to ~72 h).
      const lag = resolveLag(trigger, options.triggerClasses);
      return new Date(now.getTime() + lag.lagWindowMax * HOUR_MS);
    }
    case "reintroduce":
    case "concluded":
      return undefined; // act now / terminal.
  }
}

/** Add whole days to an instant (millisecond-exact; the FSM reasons in instants). */
function addDays(from: Date, days: number): Date {
  return new Date(from.getTime() + days * DAY_MS);
}

// --- prompts -----------------------------------------------------------------

/** The dose label for the current reintroduction step (clamped to the ladder). */
function doseLabel(step: number): string {
  const idx = Math.min(Math.max(step, 0), DOSE_LADDER.length - 1);
  return DOSE_LADDER[idx]!;
}

/**
 * The supportive prompt for a phase (DESIGN §3 — "supportive, never restrictive-
 * gamified", RESEARCH §2.8 orthorexia guard). No streaks, points, or "don't break
 * the chain" framing; encouraging and clinician-anchored.
 */
export function promptFor(protocol: ProtocolData, verdict?: Verdict): ProtocolPrompt {
  const trigger = protocol.targetTrigger;
  const phase = protocol.phase;
  // The time-box is the protocol's STORED planned end — never recomputed from a fresh
  // `now` (recomputing would silently push the deadline forward each render).
  const dueAt = protocol.phasePlannedEnd;
  switch (phase) {
    case "baseline":
      return {
        phase,
        dueAt,
        message:
          `Baseline for your ${trigger} test: eat as you normally do for now and log how you feel, ` +
          `so there's something to compare against. ${CLINICIAN_CAVEAT}`,
      };
    case "eliminate":
      return {
        phase,
        dueAt,
        message:
          `Elimination: leave out ${trigger} and keep logging meals and symptoms. Give it the full ` +
          "window before judging — some things settle slowly. When it's done, tell the app whether " +
          `you felt better. ${CLINICIAN_CAVEAT}`,
      };
    case "washout":
      return {
        phase,
        dueAt,
        message:
          `Nice work finishing the ${trigger}-free stretch. A short washout keeps things clean before ` +
          `the reintroduction — carry on with your usual otherwise-settled diet for a few days. ${CLINICIAN_CAVEAT}`,
      };
    case "reintroduce":
      return {
        phase,
        dueAt,
        message:
          `Time to reintroduce ${trigger}, a ${doseLabel(protocol.challengeStep ?? 0)} amount. Have it, ` +
          `then log anything you notice over the next while. ${CLINICIAN_CAVEAT}`,
      };
    case "observe": {
      return {
        phase,
        dueAt,
        message:
          `Observing your ${doseLabel(protocol.challengeStep ?? 0)} ${trigger} dose. Log any symptoms ` +
          `and how strong they are — there's no right answer here, we're just watching what your body does. ${CLINICIAN_CAVEAT}`,
      };
    }
    case "concluded":
      return { phase, message: concludedMessage(trigger, verdict) };
  }
}

function concludedMessage(trigger: TriggerSlug, verdict?: Verdict): string {
  switch (verdict) {
    case "tolerated":
      return `Challenge complete: you tolerated ${trigger}. No need to avoid it on this evidence — one more food you can eat freely.`;
    case "reacts":
      return `Challenge complete: ${trigger} reproduced your symptoms. If you choose to avoid it, this app can help — and can offer a re-test later, since some sensitivities ease over time.`;
    case "dose-dependent":
      return `Challenge complete: ${trigger} seems dose-dependent — fine in small amounts, not larger ones. You may not need to cut it out entirely.`;
    case "inconclusive":
      return `Challenge stopped early, so it's inconclusive. That's completely fine — you can run it again whenever it suits you.`;
    default:
      return `Challenge complete for ${trigger}.`;
  }
}

// --- read-only helpers (for the UI) ------------------------------------------

/** Whether this protocol's current phase time-box has elapsed (guidance, not a gate). */
export function isPhaseElapsed(protocol: ProtocolData, now: Date = new Date()): boolean {
  return protocol.phasePlannedEnd ? now.getTime() >= protocol.phasePlannedEnd.getTime() : true;
}

/** A "what to do next" descriptor for a live protocol (drives the Protocols/Insights UI). */
export interface NextAction {
  /** A short button label. */
  label: string;
  /** A one-line description of the step. */
  detail: string;
  /** The event this action would apply (absent for `concluded`). */
  event?: ProtocolEvent;
  /** Whether the phase's planned time-box has elapsed (UI may nudge, never blocks). */
  ready: boolean;
}

/**
 * Describe the next step for a live protocol — PURE, derived from phase + step. The
 * UI uses this to render the primary action; `eliminate` yields TWO possible events
 * (improved / not), so its `event` is left undefined and the surface offers both.
 */
export function nextAction(protocol: ProtocolData, now: Date = new Date()): NextAction {
  const ready = isPhaseElapsed(protocol, now);
  const t = protocol.targetTrigger;
  switch (protocol.phase) {
    case "baseline":
      return {
        label: "Start eliminating",
        detail: `Begin the ${t}-free elimination phase.`,
        event: { type: "advance-phase" },
        ready,
      };
    case "eliminate":
      return {
        label: "Finish elimination",
        detail: `Did leaving out ${t} make you feel better?`,
        // Two outcomes — the surface asks improved? and supplies symptomsImproved.
        ready,
      };
    case "washout":
      return {
        label: "Start reintroducing",
        detail: `Washout done — begin the ${t} reintroduction.`,
        event: { type: "advance-phase" },
        ready,
      };
    case "reintroduce":
      return {
        label: `Take the ${doseLabel(protocol.challengeStep ?? 0)} dose`,
        detail: `Reintroduce a ${doseLabel(protocol.challengeStep ?? 0)} amount of ${t}, then observe.`,
        event: { type: "advance-phase" },
        ready,
      };
    case "observe":
      return {
        label: "Record outcome",
        detail: `Did you react to this ${t} dose?`,
        // Two outcomes — the surface asks reacted? and supplies record-outcome.
        ready,
      };
    case "concluded":
      return { label: "Concluded", detail: "This challenge is complete.", ready: true };
    default:
      return { label: "—", detail: "Unknown phase.", ready: false };
  }
}
