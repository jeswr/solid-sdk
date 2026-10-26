/**
 * `@jeswr/personal-agent/pilot` — the Agentic Web pilot profile 0.1: a transport-neutral
 * interaction core, one concrete mechanism configuration family (JWS + pinned keys + owner
 * mandate over an ODRL subset), direct and email bindings, and executable domain adapters.
 * See docs/PILOT-PROFILE.md. Experimental; synthetic test use only.
 *
 * @packageDocumentation
 */

export {
  A2A_BINDING,
  A2A_SDK,
  A2aDispatcher,
  type A2aPeer,
  localAgentCard,
  loopbackEndpoint,
  sendEnvelope,
  startA2aServer,
} from "./bindings/a2a.js";
export { DirectBus, type Interceptor, type TraceEntry } from "./bindings/direct.js";
export {
  buildEmail,
  EMAIL_BINDING,
  emailMessageIdFor,
  gmailSendPayload,
  parseInboundEmail,
  rawFromGmailMessage,
  renderHuman,
  summaryLines,
  validateOutboundEmail,
  verifyProviderCopy,
} from "./bindings/email.js";
export {
  createGmailRestTransport,
  GMAIL_SETUP_REQUIRED,
  GmailProviderAdapter,
  type GmailSearchResult,
  type GmailTransport,
  listCandidates,
  ProviderRejectedError,
} from "./bindings/gmail.js";
export { parseMime, shapeOf } from "./bindings/mime.js";
export {
  ASSESSMENT_TARGET,
  CDMC_BASELINE,
  CDMC_KEY_CONTROLS,
  EVIDENCE_LAYERS,
  type KeyControlMapping,
} from "./cdmc.js";
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
export {
  ConventionalBookingAdapter,
  SlotsClient,
  validateApiBase,
} from "./domains/conventional/adapter.js";
export { AssociationStore, associationDigest } from "./domains/conventional/associations.js";
export {
  CONVENTIONAL_BOOK_OP,
  classifyLink,
  extractLinks,
  REGISTRY,
} from "./domains/conventional/registry.js";
export { type BookingOutcome, ConventionalScheduler } from "./domains/conventional/scheduler.js";
export { SlotsService, SYNTHETIC_NOTICE } from "./domains/conventional/slots-service.js";
export { auditAgentDirectory, governanceManifest, RESOURCE_REGISTER } from "./governance.js";
export { AgentHost } from "./host.js";
export { mandateWithUnsupportedTerm, personalMandate, schedulingMandate } from "./mandates.js";
export { COMPETENCY, type MatrixRow, PARTS, REQUIREMENTS } from "./matrix.js";
export {
  MAX_INBOUND_BYTES,
  MAX_MCP_LINE_BYTES,
  MCP_BINDING,
  type McpServerOptions,
  runMcpServer,
} from "./mcp/server.js";
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
export { POLICY_CASES, type PolicyCase } from "./policy-cases.js";
export {
  choosePolicyEngine,
  currentStatus,
  type PolicyEngineRecord,
  pinnedSparqEngine,
  policyEngineForAgent,
  probeSparqBinary,
  type ResolvedPolicyEngine,
} from "./policy-config.js";
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
  COMPETENCY_QUERIES,
  collectRuntimeEvidence,
  evidenceGraph,
  FORBIDDEN,
} from "./rdf/competency.js";
export { descriptionToRdf, ledgerToRdf } from "./rdf/evidence.js";
export { parseTurtle, runQuery, toJsonLd, toSparql, toTurtle } from "./rdf/serialise.js";
export {
  type OperationContext,
  type OperatorOperation,
  ROLES,
  type RoleDefinition,
  type RoleInstance,
  roleById,
} from "./roles/index.js";
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
export {
  type EmailSettings,
  type InputFormat,
  type ProcessedOutbound,
  type ProcessReport,
  prepareOutbound,
  processInput,
  ThreadStore,
} from "./service.js";
export { type IntroductionCard, introduce, provisionAgent, readAgent, saveAgent } from "./setup.js";
export { FileLedger, MemoryLedger, verifyLedger } from "./store/ledger.js";
export { FileStateStore, MemoryStateStore, type WireMessage } from "./store/state.js";
