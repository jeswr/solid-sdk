// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/** The pod-as-state module — owner-private containers, ACL-first, proposal records. */
export { aclUrlFor, writeOwnerOnlyAcl } from "./acl.js";
export {
  createProposal,
  type LoadedProposal,
  listProposals,
  readProposal,
  updateProposal,
} from "./proposal-store.js";
export {
  type ActionProposal,
  type ConfirmFriction,
  type OfferedTime,
  type ProposalStatus,
  parseProposal,
  proposalSlug,
  proposalUrl,
  type SerializeProposalOptions,
  serializeProposal,
} from "./proposals.js";
export { type FetchedGraph, listContainer, readGraph } from "./read.js";
export { type PutOptions, putResource, throwIfNotWritten } from "./write.js";
