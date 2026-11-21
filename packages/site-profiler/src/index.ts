// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
/** @jeswr/site-profiler: learn a website once and write its site model. */

export {
  type CrawlOptions,
  type CrawlResult,
  chooseSampleWord,
  crawl,
  type PageSnapshot,
} from "./crawl.js";
export { buildFlow, type DemoStep, type FlowContext, runDemonstration } from "./demonstrations.js";
export {
  applyExtraction,
  type Item,
  mapKey,
  proposeHtmlExtraction,
  proposeJsonExtraction,
} from "./extraction.js";
export {
  formCsrfRules,
  isCsrfFieldName,
  metaCsrfRules,
  parseForms,
  sampleGetUrl,
} from "./forms.js";
export { parseHtml, parseSelector, selectAll, selectOne } from "./html.js";
export { HeuristicLabeller, heuristicLabeller, isLoginCandidate } from "./labeller.js";
export {
  findLoginLink,
  type LoginObservation,
  performLogin,
  probeCandidates,
  refreshInfo,
  usernameField,
} from "./login.js";
export { buildOperation, type OperationContext, toParameter } from "./operations.js";
export { launchChromium, profileSite, proposeExtraction } from "./profile.js";
export { BODY_LIMIT, Recorder, redactBody, sanitiseHeaders } from "./recorder.js";
export { analyseScript, type ScriptAnalysis } from "./scripts.js";
export {
  discoverCredentialSources,
  discoverSessionTokens,
  redactTrace,
  type SessionTokens,
} from "./session-tokens.js";
export {
  bodyTemplateFor,
  candidateFromForm,
  candidateFromScriptCall,
  clusterRequests,
  collectKnownIds,
  matchRequest,
  mergeCandidates,
  requestValues,
  templateForPage,
} from "./templates.js";
export type {
  CandidateParam,
  Demonstration,
  EndpointCandidate,
  FormField,
  FormInfo,
  Label,
  Labeller,
  ParamKind,
  Phase,
  ProfileOptions,
  ProfileResult,
  RecordedRequest,
  ScriptCall,
} from "./types.js";
export { expandTemplate, templateShape, templateVariables } from "./util.js";
export {
  findProbeUrl,
  playwrightReplayer,
  type Replayer,
  type ReplayResponse,
  sampleValues,
  verifyOperations,
} from "./verify.js";

export { learnWriteResponses } from "./write-responses.js";
