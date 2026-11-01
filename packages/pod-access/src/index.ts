// AUTHORED-BY Codex GPT-6.1-Sol
/** Dialect-aware WAC/ACP parsing, serialization, translation and narrowing proofs. */
export {
  assertNotWider,
  effectiveMembers,
  effectivePolicy,
  emptyPolicy,
  ownerPolicy,
  type ProofContext,
  policiesEqual,
  scopePolicy,
  subjectKey,
  unionPolicies,
} from "./policy.js";
export {
  ACL,
  ACP,
  FOAF,
  modeIri,
  modes,
  parent,
  RDF,
  RdfNode,
  readModes,
  safeIri,
  serialize,
} from "./rdf.js";
export { type AcpDialect, PolicyTooComplex, readAcp, writeAcp } from "./systems/acp.js";
export { readWac, writeWac } from "./systems/wac.js";
export {
  optionDescriptions,
  reportItem,
  type TranslationContext,
  translatePolicy,
} from "./translation.js";
export type {
  AccessDocument,
  AccessSystem,
  Denial,
  EffectivePolicy,
  Grant,
  Mode,
  OptionId,
  PodImplementation,
  ReportItem,
  ReportKind,
  ReportOption,
  Resolutions,
  Subject,
} from "./types.js";
