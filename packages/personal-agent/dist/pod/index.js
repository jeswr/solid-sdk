// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/** The pod-as-state module — owner-private containers, ACL-first, proposal + confirmation records. */
export { aclUrlFor, writeOwnerOnlyAcl } from "./acl.js";
export { confirmationUrl, parseConfirmation, readConfirmation, serializeConfirmation, writeConfirmation, } from "./confirmation-store.js";
export { proposalContentDigest } from "./digest.js";
export { createProposal, listProposals, readProposal, updateProposal, } from "./proposal-store.js";
export { parseProposal, proposalSlug, proposalUrl, serializeProposal, } from "./proposals.js";
export { listContainer, readGraph } from "./read.js";
export { putResource, throwIfNotWritten } from "./write.js";
//# sourceMappingURL=index.js.map