// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * Output types for the pure inference core (coeliac-app DESIGN §4, Brief 2A).
 *
 * These types encode the product's HARD SAFETY RULES structurally, so a misuse is
 * a compile error rather than a runtime footgun:
 *
 * - **`confirmed` is unrepresentable in a correlation result.** Correlation only
 *   ever *proposes*; a `confirmed-by-your-own-test` verdict is reachable ONLY from
 *   a completed elimination protocol (DESIGN §4.2). {@link SuspicionConfidence}
 *   therefore excludes `confirmed`, so no correlation output can claim it.
 * - **No diagnosis type exists.** The engine never emits "you have X" — only
 *   ordinal, evidence-carrying *suspicions* and *proposals*. Every score carries
 *   its {@link EvidencePairing} list so the UI can show WHY (DESIGN §4.1).
 * - **Emergency symptoms are never correlation fodder.** They surface only as a
 *   {@link SafetyRail} (DESIGN §4.4); the correlation code excludes them entirely.
 *
 * Pure data — no I/O, no React, no RDF. Imports only *types* + a few load-bearing
 * *constants* from `@jeswr/solid-health-diary` (never hard-coding what the model
 * defines — lag priors, the emergency set, the phase/confidence enums).
 */

import type {
  Confidence,
  ProtocolData,
  SymptomType,
  ToleranceConclusionData,
  TriggerSlug,
  Verdict,
} from "@jeswr/solid-health-diary";

/**
 * The confidence a CORRELATION result may carry — the model's {@link Confidence}
 * ordinal MINUS `confirmed`. `confirmed` ("confirmed by your own test") is reachable
 * only through a completed protocol (DESIGN §4.2), so making it unrepresentable here
 * is the type-level guard against a correlation ever masquerading as a confirmation.
 */
export type SuspicionConfidence = Exclude<Confidence, "confirmed">;

/** The confidence ordinals a suspicion may hold, weakest→strongest (no `confirmed`). */
export const SUSPICION_CONFIDENCE_ORDER: readonly SuspicionConfidence[] = [
  "emerging",
  "suspected",
  "likely",
];

/**
 * One exposure→symptom pairing behind a suspicion — the tap-through evidence
 * (`prov:wasDerivedFrom`, DESIGN §4.1). The UI shows these so a user can inspect
 * the actual events, never a black-box score.
 */
export interface EvidencePairing {
  /** The meal (intake event) whose exposure could have caused the symptom. */
  mealId: string | undefined;
  /** Ingestion time of that meal (the lag anchor). */
  ingestedAt: Date;
  /** The strength of the exposure to this trigger in that meal. */
  exposureLevel: "present" | "trace" | "possible-undeclared";
  /** The FoodItem IRIs the exposure was derived from (`diet:derivedFrom`). */
  derivedFrom: readonly string[];
  /** The symptom(s) that followed within the lag window. */
  symptoms: readonly EvidenceSymptom[];
  /**
   * Other triggers ALSO present in the paired symptom's candidate window — the
   * confounders that dilute attribution for this pairing (DESIGN §4.1).
   */
  coPresentTriggers: readonly TriggerSlug[];
}

/** A symptom as it appears in an evidence pairing. */
export interface EvidenceSymptom {
  /** The symptom resource IRI. */
  symptomId: string | undefined;
  /** The coded symptom type. */
  symptomType: SymptomType;
  /** Onset time. */
  onset: Date;
  /** Ordinal 0–10 severity, if recorded. */
  severity: number | undefined;
  /** Hours between ingestion and this onset (within the trigger's lag window). */
  lagHours: number;
}

/**
 * A per-trigger suspicion — the interpretable, count-based association between a
 * trigger's exposures and the user's symptoms, lagged by the trigger's own window
 * (DESIGN §4.1). Every field is transparent; nothing is a hidden coefficient.
 */
export interface SuspicionScore {
  /** The trigger class this suspicion is about. */
  trigger: TriggerSlug;
  /** The resolved lag window used (hours) — shown so the window is never hidden. */
  lagWindowMin: number;
  lagWindowMax: number;
  /** Total exposure events to this trigger in the log. */
  exposureCount: number;
  /** Of those, how many were FOLLOWED by ≥1 (non-emergency) symptom in-window. */
  followedCount: number;
  /**
   * The forward conditional rate = `followedCount / exposureCount` — the headline,
   * parameter-free statistic ("symptoms followed 7 of your 9 gluten exposures").
   */
  followedRate: number;
  /**
   * The chance an exposure window would catch ≥1 symptom by coincidence alone
   * (uniform-symptom null model over the observation span) — the honest baseline
   * the rate is compared against.
   */
  expectedRate: number;
  /**
   * `followedRate / expectedRate` — enrichment over chance. `undefined` when the
   * baseline is undefined (too little time span / no symptoms). NOT a probability;
   * a transparent enrichment factor shown WITH its counts, never alone.
   */
  lift: number | undefined;
  /** Qualifying (non-emergency) symptoms with an exposure to this trigger in-window. */
  attributedSymptomCount: number;
  /**
   * Confounding-diluted attribution weight: a symptom shared by N co-present
   * triggers contributes 1/N here (equal split). `attributedWeight ≤
   * attributedSymptomCount`; the gap is the confounding. (DESIGN §4.1.)
   */
  attributedWeight: number;
  /**
   * `1 − attributedWeight / attributedSymptomCount` ∈ [0,1] — how much of this
   * trigger's apparent signal is shared with other triggers (0 = clean, →1 =
   * always confounded). `0` when there is nothing attributed.
   */
  confoundedFraction: number;
  /** True when the signal is materially confounded (needs a test to separate). */
  confounded: boolean;
  /** The other triggers this one co-occurs with (the confounders). */
  confounders: readonly TriggerSlug[];
  /** The ordinal confidence — NEVER `confirmed` (that needs a protocol). */
  confidence: SuspicionConfidence;
  /**
   * An opaque, monotone RANKING heuristic (higher = rank sooner). Documented as a
   * sort key ONLY — it is not a probability and is never shown as certainty.
   */
  rankScore: number;
  /** The tap-through evidence (DESIGN §4.1). */
  evidence: readonly EvidencePairing[];
  /**
   * The always-attached honesty caveat (DESIGN §4.2): "a pattern in your data, not
   * a diagnosis." Carried on the datum so a surface can never drop it.
   */
  disclaimer: string;
}

/** Severity of a safety rail — governs the UI framing (DESIGN §4.4). */
export type SafetyRailSeverity = "emergency" | "urgent" | "advisory";

/**
 * The hard-coded, NON-correlated safety rails (DESIGN §4.4). These are rules, not
 * inferences — they are never "correlated away" and never suppressed.
 */
export type SafetyRailKind =
  /** Breathing-difficulty / anaphylaxis symptom → emergency framing. */
  | "emergency-anaphylaxis"
  /** Alarm symptoms (weight loss, GI bleeding, vomiting, dysphagia, anaemia). */
  | "alarm-symptoms"
  /** Persistent symptoms despite strict adherence → gastroenterology referral. */
  | "persistent-despite-adherence"
  /** Restriction-anxiety / rapidly-shrinking diet → dietitian (orthorexia guard). */
  | "restriction-anxiety"
  /** Pre-diagnosis gluten elimination → "get tested first" hard block. */
  | "pre-diagnosis-gluten";

/** A surfaced safety rail (DESIGN §4.4). Rules, non-suppressible, evidence-carrying. */
export interface SafetyRail {
  kind: SafetyRailKind;
  severity: SafetyRailSeverity;
  /** The plain-language message the UI must show. */
  message: string;
  /** IRIs of the diary resources that triggered the rail (tap-through). */
  evidence: readonly string[];
}

/** The kind of thing the engine proposes next (DESIGN §4.3). */
export type ProposalKind =
  /** Start an elimination protocol for a suspected trigger. */
  | "eliminate"
  /** Re-challenge a resolved / time-boxed exclusion (expansion — orthorexia guard). */
  | "re-challenge"
  /** Wait — a challenge is already active (one-active-challenge invariant). */
  | "wait-active-challenge"
  /** Nothing to propose (insufficient data). */
  | "none";

/** A proposed next step (DESIGN §4.3). Correlation *proposes*; the user confirms. */
export interface EliminationProposal {
  kind: ProposalKind;
  /** The trigger the proposal concerns (absent for `none`). */
  trigger?: TriggerSlug;
  /** Human-readable rationale (counts + the caveat). */
  rationale: string;
  /** The suspicion the proposal rests on (for `eliminate`). */
  basedOn?: SuspicionScore;
  /** For `wait-active-challenge` / `re-challenge`: the protocol/conclusion IRI. */
  relatedResource?: string;
  /** A suggested phase schedule (defaults from RESEARCH §2.4) — the user adjusts. */
  suggestedSchedule?: PhaseSchedule;
}

/** A suggested per-phase schedule for a proposed protocol (defaults; user-adjustable). */
export interface PhaseSchedule {
  baselineDays: number;
  eliminateDays: number;
  washoutDays: number;
  /** Reintroduction dose-step dates, computed by the reintroduction scheduler. */
  reintroductionSteps?: readonly ReintroductionStep[];
}

/** One dose-escalation step in a reintroduction plan (DESIGN §3, RESEARCH §2.4). */
export interface ReintroductionStep {
  /** 0-based dose step (`diet:challengeStep`). */
  step: number;
  /** When to take this dose. */
  scheduledFor: Date;
  /** End of the observation window for this dose (dose time + trigger lag max). */
  observeUntil: Date;
  /** Qualitative dose label. */
  dose: "small" | "moderate" | "full";
}

/** A computed reintroduction schedule for a single active protocol. */
export interface ReintroductionSchedule {
  /** The protocol this schedule is for. */
  protocolId: string | undefined;
  trigger: TriggerSlug;
  /** The scheduled dose steps, washout-respecting. */
  steps: readonly ReintroductionStep[];
  /** The washout (days) enforced before the first dose. */
  washoutDays: number;
}

/**
 * A surfaced re-challenge of a time-boxed conclusion (DESIGN §4.3, RESEARCH §2.2).
 * The engine is biased toward EXPANSION: a due exclusion is proactively offered for
 * re-test, so the avoid-list shrinks where evidence allows.
 */
export interface ReviewSurfacing {
  conclusionId: string | undefined;
  trigger: TriggerSlug;
  verdict: Verdict;
  /** The `diet:reviewAfter` date that has now passed. */
  reviewAfter: Date;
  /** Days overdue for re-challenge (≥ 0). */
  overdueDays: number;
  message: string;
}

/**
 * The complete diary snapshot the engine reasons over — parsed model data, no I/O.
 * The engine NEVER fetches; a caller supplies already-parsed records.
 */
export interface DiaryData {
  meals: readonly import("@jeswr/solid-health-diary").MealData[];
  symptoms: readonly import("@jeswr/solid-health-diary").SymptomData[];
  /**
   * Per-user trigger classes (with lag profiles). Optional — a trigger with no
   * entry falls back to the model's evidence prior, so the engine never hard-codes
   * a lag window.
   */
  triggerClasses?: readonly import("@jeswr/solid-health-diary").TriggerClassData[];
  protocols?: readonly ProtocolData[];
  conclusions?: readonly ToleranceConclusionData[];
  plan?: import("@jeswr/solid-health-diary").DietPlanData;
}

/** Caller-supplied safety signals the diary model cannot itself represent (DESIGN §4.4). */
export interface SafetyContext {
  /**
   * Whether the user has a CONFIRMED coeliac diagnosis (serology + biopsy). Governs
   * the pre-diagnosis gluten-elimination hard block (DESIGN §4.3, RESEARCH §4).
   * `undefined`/`false` ⇒ NOT confirmed ⇒ gluten elimination is blocked.
   */
  coeliacDiagnosed?: boolean;
  /**
   * Alarm symptoms the {@link SymptomType} enum cannot express — collected by the
   * UI (a short checklist). Any true flag raises the alarm rail (DESIGN §4.4).
   */
  alarmFlags?: {
    unintendedWeightLoss?: boolean;
    giBleeding?: boolean;
    persistentVomiting?: boolean;
    dysphagia?: boolean;
    anaemia?: boolean;
  };
  /** The user reports strict dietary adherence (drives the persistence rail). */
  strictAdherence?: boolean;
}

/** Tunable thresholds — defaulted; exposed so behaviour is inspectable, not magic. */
export interface EngineThresholds {
  /** Min exposure events before a suspicion can exceed `emerging`. */
  minEventsForSuspected: number;
  /** Min exposure events before a suspicion can reach `likely`. */
  minEventsForLikely: number;
  /** Forward-rate floor for `suspected`. */
  rateForSuspected: number;
  /** Forward-rate floor for `likely`. */
  rateForLikely: number;
  /** Lift floor for `likely`. */
  liftForLikely: number;
  /** Confounded-fraction at/above which a signal is flagged `confounded`. */
  confoundedFractionFlag: number;
  /** Co-occurrence fraction at/above which another trigger is named a confounder. */
  confounderCoOccurrence: number;
  /** DietPlan exclusion count at/above which the restriction-anxiety rail fires. */
  exclusionCountForAnxiety: number;
}

/** The engine's default thresholds (documented; a caller may override). */
export const DEFAULT_THRESHOLDS: EngineThresholds = {
  minEventsForSuspected: 3,
  minEventsForLikely: 5,
  rateForSuspected: 0.4,
  rateForLikely: 0.6,
  liftForLikely: 1.5,
  confoundedFractionFlag: 0.34,
  confounderCoOccurrence: 0.6,
  exclusionCountForAnxiety: 6,
};

/** The always-attached honesty caveat (DESIGN §4.2). */
export const PATTERN_NOT_DIAGNOSIS =
  "This is a pattern in your data, not a diagnosis. Correlation can only suggest a " +
  "trigger to test — a supervised elimination challenge is what confirms it.";
