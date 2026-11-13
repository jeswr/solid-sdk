// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
/**
 * `@jeswr/agent-reference` — the reference agent runtime, lifted out of
 * `@jeswr/personal-agent/pilot` (which re-exports it). Every module is also reachable by its
 * path, e.g. `@jeswr/agent-reference/runtime/agent`. Experimental; synthetic test use only.
 *
 * @packageDocumentation
 */

export { DirectBus, type Interceptor, type TraceEntry } from "./bindings/direct.js";
export { canonicalJson, digestOf, isIri, scopedUrn } from "./core/canonical.js";
export {
  type ConversationState,
  openConversation,
  type Phase,
  transition,
} from "./core/conversation.js";
export {
  DEFAULT_LIMITS,
  type PilotLimits,
  parseBoundedJson,
  resolveLimits,
} from "./core/limits.js";
export { validateMessage } from "./core/schema.js";
export type * from "./core/types.js";
export { CORE_REASON_CODES } from "./core/types.js";
export { availableAdapters } from "./derive/adapters/index.js";
export { ProofCache, proofRequestDigest } from "./derive/cache.js";
export {
  type DerivationRule,
  evaluateRule,
  queryFor,
  ruleSchema,
  validateRules,
  verifyDerivation,
} from "./derive/rules.js";
export {
  type Adapter,
  type DerivedRequest,
  type FixedJointSession,
  type JointOutcome,
  type JointProtocol,
  type ProofBinds,
  type ProofSystem,
  type SessionParams,
  type VerifierRegistry,
  verifierRegistry,
} from "./derive/verifiers.js";
export {
  CONVENTIONAL_BOOK_OP,
  classifyLink,
  extractLinks,
  REGISTRY,
} from "./domains/conventional/registry.js";
export { loadCase, loadProfile, loadScenario } from "./engine/load.js";
export { type PathResult, runScenario } from "./engine/run.js";
export {
  type DomainProfile,
  domainProfileSchema,
  type Scenario,
  scenarioSchema,
} from "./engine/schema.js";
export { mandateWithUnsupportedTerm, personalMandate, schedulingMandate } from "./mandates.js";
export { JOINT_OPERATIONS, JointParty } from "./mechanisms/joint.js";
export {
  generateSigningKey,
  type KeyAlg,
  loadSigningKey,
  type SigningKey,
  signCompact,
  verifyCompact,
} from "./mechanisms/jws.js";
export {
  evaluateGrantPolicy,
  evaluateIntent,
  loadMandate,
  type OwnerMandate,
  PILOT_ODRL_SUBSET,
  POLICY_EVALUATOR_ID,
  signApproval,
  signMandate,
  verifyApproval,
} from "./mechanisms/mandate.js";
export {
  type EngineRequest,
  type EngineVerdict,
  type ModuleAvailability,
  type PolicyEngine,
  type PolicyModuleInfo,
  SOLID_ODRL_MODULE,
  solidOdrlEngine,
} from "./mechanisms/policy-engine.js";
export { odrlPolicyToTurtle, sparqPolicyEngine } from "./mechanisms/sparq-policy.js";
export { signStatement, TYP, verifyStatement } from "./mechanisms/statements.js";
export {
  type PinnedKey,
  type SourceAuthorityRule,
  TrustStore,
  type TrustStoreData,
} from "./mechanisms/trust.js";
export {
  CONFIG_ED25519,
  CONFIG_P256,
  CONFIG_PUBLIC,
  CONFIG_SD_CANDIDATE,
  CONFIGURATIONS,
  type ConfigurationDefinition,
  POLICY_PROFILE,
  POLICY_PROFILE_SUMMARY,
} from "./profile/configurations.js";
export { type ContentType, type ContentVocabulary, freeStrings } from "./profile/content.js";
export {
  buildDescription,
  type DescribedPolicyModule,
  type ImplementationDescription,
  type OperationDescription,
  selectConfiguration,
} from "./profile/description.js";
export {
  AWP,
  DPV_VALIDATION,
  PILOT_PROFILE,
  PILOT_PROFILE_VERSION,
  PURPOSE,
  TERM_REGISTER,
} from "./profile/vocabulary.js";
export {
  AgentRuntime,
  type AgentRuntimeOptions,
  type OutboundMessage,
  RejectError,
  type StepResult,
} from "./runtime/agent.js";
export type {
  EffectAdapter,
  EffectPlan,
  HandlerContext,
  HandlerReply,
  OperationHandler,
} from "./runtime/operations.js";
export { compactState, DEFAULT_RETENTION, type RetentionPolicy } from "./runtime/retention.js";
export {
  MAX_TRANSMISSION_ATTEMPTS,
  type ProviderLookupResult,
  type ProviderSendResult,
  providerLookupResultOf,
  providerSendResultOf,
  type TransmissionIo,
  type TransmissionRecord,
  type TransmitRequest,
  type TransmitResult,
} from "./runtime/transmission.js";
export { type IntroductionCard, introduce, provisionAgent, readAgent, saveAgent } from "./setup.js";
export { FileLedger, MemoryLedger, verifyLedger } from "./store/ledger.js";
export { FileStateStore, MemoryStateStore, type WireMessage } from "./store/state.js";
