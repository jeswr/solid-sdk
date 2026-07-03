// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * The coeliac-app inference engine (DESIGN §4, Brief 2A) — a PURE functional core
 * over `@jeswr/solid-health-diary` entities. No I/O, no React, no RDF: typed
 * functions in, typed suspicions / proposals / rails / schedules out.
 *
 * Hard safety rules baked into the API:
 * - Correlation only ever PROPOSES; `confirmed` is unrepresentable in a
 *   {@link SuspicionScore} and comes only from {@link deriveConfirmedConclusion} on a
 *   completed protocol.
 * - Emergency symptoms (anaphylaxis / breathing) are excluded from correlation and
 *   surface only as a {@link SafetyRail}.
 * - The engine is biased toward reintroduction / expansion (orthorexia guard).
 *
 * @packageDocumentation
 */

export { analyze, type AnalysisResult } from "./analyze";
export {
  analyzeContextCluster,
  CLUSTER_LIFT,
  CLUSTER_RATE_FLOOR,
  CONTEXT_WINDOW_HOURS,
  MIN_MEALS_PER_CONTEXT,
  type ContextClusterSurfacing,
  type ContextReactionRate,
} from "./context-cluster";
export { deriveConfirmedConclusion, DEFAULT_REVIEW_AFTER_DAYS, TIME_BOXED_TRIGGERS } from "./conclude";
export {
  deriveCurrentPlan,
  type CurrentPlan,
  type ExclusionReason,
  type PlanExclusion,
} from "./diet-plan";
export type { ConcludeOptions } from "./conclude";
export { correlate, type CorrelateOptions } from "./correlate";
export { HOUR_MS, lagHours, onsetWithinLag, resolveAllLags, resolveLag, type ResolvedLag } from "./lag";
export {
  DEFAULT_PHASE_SCHEDULE,
  hasInProgressProtocol,
  proposeNext,
  type ProposeOptions,
} from "./propose";
export { rankSuspicions, rankedSuspects } from "./rank";
export {
  REINTRODUCTION_DEFAULTS,
  scheduleReintroduction,
  type ReintroductionOptions,
} from "./reintroduction";
export { surfaceReviews } from "./review";
export {
  EMERGENCY_SYMPTOM_TYPES,
  evaluateSafetyRails,
  isEmergencySymptom,
  isEmergencySymptomType,
  partitionEmergencySymptoms,
  preDiagnosisGlutenBlock,
} from "./safety";
export {
  DEFAULT_THRESHOLDS,
  PATTERN_NOT_DIAGNOSIS,
  SUSPICION_CONFIDENCE_ORDER,
  type DiaryData,
  type EliminationProposal,
  type EngineThresholds,
  type EvidencePairing,
  type EvidenceSymptom,
  type PhaseSchedule,
  type ProposalKind,
  type ReintroductionSchedule,
  type ReintroductionStep,
  type ReviewSurfacing,
  type SafetyContext,
  type SafetyRail,
  type SafetyRailKind,
  type SafetyRailSeverity,
  type SuspicionConfidence,
  type SuspicionScore,
} from "./types";
