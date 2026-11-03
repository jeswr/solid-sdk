// AUTHORED-BY Codex GPT-6
/** Solid request inbox and forward-only, conditional WAC approval pipeline. */
export { accessModel, UnsupportedAccessModelError } from "./acl.js";
export type { DecideOptions, DecisionResult, RequestDecision } from "./approval.js";
export { decide, deriveGrantId } from "./approval.js";
export { accmAliases, accmTerm, canonicalizeAccmDataset } from "./canonical-vocab.js";
export { MAX_MEMBERS, MAX_NOTIFICATION_BYTES, RequestConflictError } from "./http.js";
export type {
  AccessRequestEntry,
  ListRequestsOptions,
  RequestMode,
  RequestStatus,
} from "./inbox.js";
export { listRequests } from "./inbox.js";
export { ACCM, ACL, DCT, DPV, FOAF, LDP, ODRL, PIM, PROV, RDF, RDFS, SOLID, XSD } from "./vocab.js";
