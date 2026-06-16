/**
 * `@jeswr/federation-registry` — a typed TypeScript client for the Solid
 * Federation **Catalogue / Registry** vocabulary (`fedreg:`) at
 * `https://w3id.org/jeswr/fedreg#`.
 *
 * This is the **discovery axis** of a Solid data federation (one of the five
 * federation services in the architecture: Scheme Authority, Conformance
 * Assessor, Vocabulary/Spec Hub, **Catalogue/Registry**, Receipt/Audit log). It
 * answers two questions the self-asserted `fedapp:` layer
 * (`@jeswr/federation-client`) cannot:
 *
 * 1. **Who is a member?** A {@link buildRegistry} / {@link parseRegistry} /
 *    {@link listMembers} / {@link verifyMembership} surface over a
 *    `fedreg:Registry` of `fedreg:Membership` records. A Membership is the
 *    **registry's** assertion (it carries `fedreg:assertedBy` + a lifecycle
 *    status) — never trust a self-asserted `fedapp:App` as a membership claim.
 * 2. **Which storage accepts which spec-version?** {@link describeStorage} /
 *    {@link parseStorage} build/read a `fedreg:StorageDescription`, and
 *    {@link acceptsSpec} / {@link unsupportedSpecs} answer the
 *    schema-migration-coordination query.
 *
 * RDF discipline: parse via `@jeswr/fetch-rdf`, extract via `@rdfjs/wrapper`,
 * serialise via `n3.Writer`. Never a bespoke parser.
 *
 * Experimental, AI-agent-generated — not production-hardened.
 *
 * @packageDocumentation
 */
export { type BuiltGraph, buildMembership, buildRegistry, type FetchOptions, listMembers, type MembershipInput, type ParsedRegistry, parseRegistry, parseRegistryDataset, type RegistryInput, verifyMembership, verifyMembershipDataset, } from "./registry.js";
export { serialize } from "./serialize.js";
export { acceptsSpec, type BuiltStorage, describeStorage, parseStorage, parseStorageDataset, type StorageFetchOptions, type StorageInput, unsupportedSpecs, } from "./storage.js";
export type { Membership, MembershipVerification, Registry, RegistryIssue, RegistryIssueCode, StorageDescription, StorageVerification, } from "./types.js";
export { membershipNodeToView, storageNodeToView, verifyMembershipNode, verifyStorageNode, } from "./verify.js";
export { DCAT, FEDAPP, FEDREG, MEMBERSHIP_STATUS, type MembershipStatusName, SECTOR_BASE, statusName, TRUSTED_STATUS, VALID_STATUS_IRIS, } from "./vocab.js";
//# sourceMappingURL=index.d.ts.map