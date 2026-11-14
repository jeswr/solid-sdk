// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY Codex GPT-6
// @jeswr/site-executor: run a planner's RDF action request against a site's own
// HTTP calls, as described by a @jeswr/site-model SiteModel.

export {
  applyCsrfToken,
  type CompiledBody,
  type CompiledRequest,
  compileOperation,
  fillJsonTemplate,
  requestFingerprint,
} from "./compile.js";
export {
  type CookieSecretContext,
  isLoginCredentialCookie,
  isSessionCredentialCookie,
  registerCookieSecrets,
  type SecretCookie,
} from "./cookie-secrets.js";
export {
  applySetCookies,
  type Cookie,
  cookieHeader,
  cookiesFor,
  domainMatches,
  InMemorySessions,
  parseSetCookie,
  pathMatches,
  type SessionBundle,
  type SessionProvider,
  type SessionUpdate,
  type SessionUpdateResult,
} from "./cookies.js";
export { jsonPointer } from "./dom.js";
export {
  effectValueEquals,
  emptyEffectCollection,
  formatEffectValue,
  learnEffectValueFormat,
} from "./effect-verification.js";
export {
  type CommittedWrite,
  createExecutor,
  type ErrorKind,
  type ExecuteOptions,
  type ExecutionOutcome,
  type ExecutionResult,
  type ExecutionStatus,
  type Executor,
  type ExecutorOptions,
  type Plan,
  type PlannedRequest,
  planToRequests,
} from "./executor.js";
export {
  type ExtractedItem,
  ExtractionError,
  type ExtractOptions,
  type ExtractOutput,
  extract,
} from "./extract.js";
export {
  type ApprovalGate,
  type ApprovalRequest,
  approvalDigest,
  approvalFor,
  createApprovalGate,
  type Gate,
  type GateDecision,
  type GateRequest,
  moneyFields,
  summarise,
} from "./gate.js";
export {
  asciiLowerCase,
  type HtmlControlElement,
  htmlAttribute,
  htmlControlType,
  isHtmlInputType,
  parseHtmlTag,
} from "./html-controls.js";
export {
  type AnonymousAnswer,
  AUTHENTICATION_REFUSALS,
  type AuthenticationRefusal,
  authenticationRefusal,
  isLoginDocument,
  type LivenessRead,
  type LivenessSignature,
  livenessSignature,
  matchesLivenessSignature,
  type RefusalEvidence,
  ROUTED_REFUSALS,
  refusalEvidence,
  refusalTarget,
  sameRefusal,
  type VerifiedLoginRoute,
} from "./liveness.js";
export {
  effectiveEffect,
  type MatchResult,
  matchRequest,
  maxEffect,
  resolveInputs,
  type Target,
} from "./match.js";
export { describeUrl, guardUrl, isLoopbackHost, OriginError, siteOrigin } from "./origin.js";
export {
  authenticationText,
  createdObjectType,
  isDiscriminatorKey,
  jsonEnvelope,
  jsonFailure,
  jsonRootFailure,
  landingItemValues,
  notFoundSignature,
  responseFlash,
  responsePageError,
  sentInputValue,
  staleVerificationResponse,
} from "./response-evidence.js";
export {
  MIN_REDACTION_LENGTH,
  normaliseSecretText,
  registerSecret,
  secretRedactor,
} from "./secrets.js";
// AUTHORED-BY Codex GPT-6.1-Sol — shared read-only redaction API.
export { pagingKind, selectionPaginationDescription } from "./selection.js";
export {
  expandTemplate,
  parseTemplate,
  templateVariables,
  UriTemplateError,
} from "./uri-template.js";
export { BindingError, idFromIri, resolveParameter, validateValue } from "./values.js";
export { readVerificationBody, VERIFICATION_EVIDENCE_LIMIT } from "./verification-body.js";
export {
  isScopeField,
  readOnlyScopeConstants,
  submittedStateInputs,
  verificationScopeMatches,
} from "./verification-context.js";
export { exactIdentityFilter } from "./verification-filter.js";
export { effectiveWireFields } from "./wire.js";
export {
  type EffectVerification,
  matchesCreatedIdentity,
  readBackIdentityMatches,
  requiresEffectVerification,
  verifiedReadBackItem,
  type WriteResponsePolicy,
} from "./write-response.js";
