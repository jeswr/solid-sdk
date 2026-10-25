/** The pod-as-state module — owner-private containers, ACL-first, proposal + confirmation records. */
export { aclUrlFor, writeOwnerOnlyAcl } from "./acl.js";
export { type Confirmation, confirmationUrl, parseConfirmation, readConfirmation, serializeConfirmation, writeConfirmation, } from "./confirmation-store.js";
export { proposalContentDigest } from "./digest.js";
export { createProposal, type LoadedProposal, listProposals, readProposal, updateProposal, } from "./proposal-store.js";
export { type ActionProposal, type ConfirmFriction, type OfferedTime, type ProposalStatus, parseProposal, proposalSlug, proposalUrl, type SerializeProposalOptions, serializeProposal, } from "./proposals.js";
export { type FetchedGraph, listContainer, readGraph } from "./read.js";
export { type PutOptions, putResource, throwIfNotWritten } from "./write.js";
//# sourceMappingURL=index.d.ts.map