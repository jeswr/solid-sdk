// AUTHORED-BY Codex GPT-6.1-Sol
/** PKG nanopublication model and fact templates (MCP-04). */
export {
  UnsupportedLiteralCharacterError,
  UnsupportedLiteralDatatypeError,
  UnsupportedLiteralLexicalFormError,
} from "./errors.js";
export { canonicalizeAssertion, messageId, PKG_NAMESPACE_UUID, pkgId } from "./ids.js";
export type {
  Batch,
  BuildOptions,
  Claim,
  Entity,
  EpistemicStatus,
  Evidence,
  NanopubEvidence,
  Nanopublication,
  Nanopublications,
  Source,
  ValidityStatus,
} from "./model.js";
export {
  buildNanopublications,
  EPISTEMIC_STATUSES,
  parseAssertion,
  parseNanopublications,
  serializeNanopublications,
  VALIDITY_STATUSES,
} from "./model.js";
export type { Fact, TemporalValue } from "./templates.js";
export { createFactAssertion } from "./templates.js";
