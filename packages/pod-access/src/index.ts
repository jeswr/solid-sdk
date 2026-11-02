// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Codex GPT-6.1-Sol
/** Solid/LWS sharing, WAC/ACP translation and bounded access proofs. */
export { createAccessClient } from "./access.js";
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
  readModes,
  safeIri,
  serialize,
} from "./rdf.js";
export { type AcpDialect, isPolicyTooComplex, readAcp, writeAcp } from "./systems/acp.js";
export { readWac, writeWac } from "./systems/wac.js";
export {
  optionDescriptions,
  reportItem,
  type TranslationContext,
  translatePolicy,
} from "./translation.js";
export type {
  AccessClient,
  AccessClientOptions,
  AccessDocument,
  AccessGrant,
  AccessMode,
  AccessRequest,
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
  RevocationKey,
  Subject,
} from "./types.js";
