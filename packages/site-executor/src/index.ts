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
  effectiveEffect,
  type MatchResult,
  matchRequest,
  maxEffect,
  resolveInputs,
  type Target,
} from "./match.js";
export { describeUrl, guardUrl, isLoopbackHost, OriginError, siteOrigin } from "./origin.js";
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
export { matchesCreatedIdentity, type WriteResponsePolicy } from "./write-response.js";
