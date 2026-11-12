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

export { type AnalysisResult, analyze } from "./analyze.js";
export type { ConcludeOptions } from "./conclude.js";
export {
  DEFAULT_REVIEW_AFTER_DAYS,
  deriveConfirmedConclusion,
  TIME_BOXED_TRIGGERS,
} from "./conclude.js";
export {
  analyzeContextCluster,
  CLUSTER_LIFT,
  CLUSTER_RATE_FLOOR,
  CONTEXT_WINDOW_HOURS,
  type ContextClusterSurfacing,
  type ContextReactionRate,
  MIN_MEALS_PER_CONTEXT,
} from "./context-cluster.js";
export { type CorrelateOptions, correlate } from "./correlate.js";
export {
  type CurrentPlan,
  deriveCurrentPlan,
  type ExclusionReason,
  type PlanConclusion,
  type PlanExclusion,
  type PlanProtocol,
} from "./diet-plan.js";
export {
  HOUR_MS,
  lagHours,
  onsetWithinLag,
  type ResolvedLag,
  resolveAllLags,
  resolveLag,
} from "./lag.js";
export { type LatestAccessors, latestByTrigger, latestByTriggerList } from "./latest-conclusion.js";
export {
  type LearnedTriggerClass,
  learnTriggerClasses,
  MIN_SAMPLE_SIZE,
  MIN_WINDOW_WIDTH_HOURS,
} from "./learn-lag-profile.js";
export {
  DEFAULT_PHASE_SCHEDULE,
  hasInProgressProtocol,
  type ProposeOptions,
  proposeNext,
} from "./propose.js";
export { rankedSuspects, rankSuspicions } from "./rank.js";
export {
  REINTRODUCTION_DEFAULTS,
  type ReintroductionOptions,
  scheduleReintroduction,
} from "./reintroduction.js";
export { surfaceReviews } from "./review.js";
export {
  EMERGENCY_SYMPTOM_TYPES,
  evaluateSafetyRails,
  isEmergencySymptom,
  isEmergencySymptomType,
  partitionEmergencySymptoms,
  preDiagnosisGlutenBlock,
} from "./safety.js";
export {
  DEFAULT_THRESHOLDS,
  type DiaryData,
  type EliminationProposal,
  type EngineThresholds,
  type EvidencePairing,
  type EvidenceSymptom,
  PATTERN_NOT_DIAGNOSIS,
  type PhaseSchedule,
  type ProposalKind,
  type ReintroductionSchedule,
  type ReintroductionStep,
  type ReviewSurfacing,
  type SafetyContext,
  type SafetyRail,
  type SafetyRailKind,
  type SafetyRailSeverity,
  SUSPICION_CONFIDENCE_ORDER,
  type SuspicionConfidence,
  type SuspicionScore,
} from "./types.js";
