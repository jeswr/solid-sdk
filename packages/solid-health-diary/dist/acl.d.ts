/**
 * Owner-only, fail-closed WAC ACL — the ONE reviewed home for the "every health
 * resource is private" invariant (DESIGN §2.3 / §9).
 *
 * Health data (symptoms, the genetics summary, the restriction plan) is among the
 * most sensitive categories there is, so EVERY container in the diary gets an
 * owner-only ACL, written first, granting ONLY the owner `acl:Read`/`Write`/
 * `Control` over the container AND its descendants (`acl:accessTo` +
 * `acl:default`). Nothing is ever public.
 *
 * **Fail-closed:** an invalid / non-http(s) owner WebID THROWS rather than
 * producing an ACL with no valid agent (which a server could interpret
 * permissively). No `acl:agentClass` / `foaf:Agent` / public grant is ever
 * emitted — `src/acl.test.ts` proves that by parsing the output.
 *
 * Built with `n3.Writer` + typed quads — **never hand-concatenated triples**
 * (house rule). Browser-safe: only `n3` + the WHATWG `URL` global.
 */
/**
 * The ACL resource URL for a Solid resource/container — `${resourceUrl}.acl`
 * (the WAC convention). Not a Link-header discovery (that is the client's job on
 * a real server); this is the conventional default the diary writes to.
 *
 * @throws (fail-closed) if `resourceUrl` is not an absolute http(s) URL, or if it
 *   carries a fragment (see {@link assertAclableResource}).
 */
export declare function aclUrlFor(resourceUrl: string): string;
/**
 * Build an **owner-only, fail-closed** WAC ACL Turtle document for `resourceUrl`
 * (typically a container), granting ONLY `ownerWebId` `acl:Read`/`Write`/
 * `Control` over the resource (`acl:accessTo`) and its descendants
 * (`acl:default`). No public / `acl:agentClass` grant is emitted.
 *
 * @throws if `ownerWebId` is not an absolute http(s) IRI (fail-closed — never
 *   write an ACL whose only authorization names an empty/malformed agent).
 */
export declare function buildOwnerOnlyAcl(resourceUrl: string, ownerWebId: string): Promise<string>;
/**
 * Write an owner-only ACL for `resourceUrl` via an injectable authed `fetch`
 * (PUT `${resourceUrl}.acl`). The fetch seam keeps this unit-testable with a
 * stubbed fetch and no server (suite convention). Throws on a non-2xx response
 * (fail-closed — a resource whose ACL write failed must not be treated as
 * protected).
 */
export declare function writeOwnerOnlyAcl(resourceUrl: string, ownerWebId: string, authedFetch: typeof globalThis.fetch): Promise<void>;
//# sourceMappingURL=acl.d.ts.map