// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * Owner-only, fail-closed WAC ACL — the ONE reviewed home for the "every scrobble
 * is private" invariant.
 *
 * A listening history is behavioural data (what you played, when, how far) — a
 * privacy-sensitive category — so a scrobble resource / the scrobbles container
 * gets an owner-only ACL, written first, granting ONLY the owner `acl:Read`/
 * `Write`/`Control` over the resource AND (for a container) its descendants
 * (`acl:accessTo` + `acl:default`). Nothing is ever public.
 *
 * **Fail-closed:** an invalid / non-http(s) owner WebID THROWS rather than
 * producing an ACL with no valid agent (which a server could interpret
 * permissively). No `acl:agentClass` / `foaf:Agent` / public grant is ever
 * emitted — `src/acl.test.ts` proves that by parsing the output.
 *
 * Built with `n3.Writer` + typed quads — **never hand-concatenated triples**
 * (house rule). Browser-safe: only `n3` + the WHATWG `URL` global.
 */
import { DataFactory, Store, Writer } from "n3";
import { httpIriOrUndefined } from "./iri.js";
import { ACL, acl, FOAF, RDF_TYPE } from "./vocab.js";
const { namedNode } = DataFactory;
/**
 * Canonicalise + validate a resource/container URL that an ACL will be written
 * for. **Fail-closed:** rejects anything that is not an absolute http(s) URL, and
 * rejects a URL carrying a FRAGMENT. A fragment is the dangerous case — appending
 * `.acl` to a subject IRI like `…/meal.ttl#it` yields `…/meal.ttl#it.acl`, whose
 * fragment `fetch` STRIPS, so the ACL body would be PUT to the DATA resource
 * itself (`…/meal.ttl`), overwriting it. Returns the canonical fragment-free URL.
 */
function assertAclableResource(resourceUrl) {
    let u;
    try {
        u = new URL(resourceUrl);
    }
    catch {
        throw new Error(`aclUrlFor: resourceUrl must be an absolute http(s) URL (got ${JSON.stringify(resourceUrl)}).`);
    }
    if (u.protocol !== "http:" && u.protocol !== "https:") {
        throw new Error(`aclUrlFor: resourceUrl must be http(s) (got ${u.protocol}) — refusing to write an ACL for a non-http resource.`);
    }
    if (u.hash !== "") {
        throw new Error(`aclUrlFor: resourceUrl must be a resource/container URL with NO fragment (got ${JSON.stringify(resourceUrl)}) — a fragment would make the ACL body target the data resource itself.`);
    }
    if (u.search !== "") {
        // A query string is the same hazard as a fragment: `${href}.acl` appends AFTER
        // the query (`…/health/?v=1` → `…/health/?v=1.acl`), so the ACL would be written
        // for a DIFFERENT resource than the one being protected — leaving the health
        // resource unprotected. A WAC-managed resource/container URL never carries one.
        throw new Error(`aclUrlFor: resourceUrl must be a resource/container URL with NO query string (got ${JSON.stringify(resourceUrl)}) — a query would make the ACL body target a different resource.`);
    }
    return u.href;
}
/**
 * The ACL resource URL for a Solid resource/container — `${resourceUrl}.acl`
 * (the WAC convention). Not a Link-header discovery (that is the client's job on
 * a real server); this is the conventional default the diary writes to.
 *
 * @throws (fail-closed) if `resourceUrl` is not an absolute http(s) URL, or if it
 *   carries a fragment (see {@link assertAclableResource}).
 */
export function aclUrlFor(resourceUrl) {
    return `${assertAclableResource(resourceUrl)}.acl`;
}
/**
 * Build an **owner-only, fail-closed** WAC ACL Turtle document for `resourceUrl`
 * (typically a container), granting ONLY `ownerWebId` `acl:Read`/`Write`/
 * `Control` over the resource (`acl:accessTo`) and its descendants
 * (`acl:default`). No public / `acl:agentClass` grant is emitted.
 *
 * @throws if `ownerWebId` is not an absolute http(s) IRI (fail-closed — never
 *   write an ACL whose only authorization names an empty/malformed agent).
 */
export async function buildOwnerOnlyAcl(resourceUrl, ownerWebId) {
    const owner = httpIriOrUndefined(ownerWebId);
    if (!owner) {
        throw new Error("buildOwnerOnlyAcl: ownerWebId must be an absolute http(s) WebID IRI " +
            "(fail-closed — refusing to write an ACL with no valid owner).");
    }
    // Validate + canonicalise the target (throws on a non-http or fragment-bearing
    // URL) so `acl:accessTo`/`acl:default` and the .acl URL all reference the SAME
    // fragment-free resource — never a data resource a stripped fragment would hit.
    const aclUrl = aclUrlFor(resourceUrl);
    const resource = aclUrl.slice(0, -".acl".length);
    const auth = namedNode(`${aclUrl}#owner`);
    const store = new Store();
    store.addQuad(auth, namedNode(RDF_TYPE), namedNode(acl("Authorization")));
    store.addQuad(auth, namedNode(acl("agent")), namedNode(owner));
    store.addQuad(auth, namedNode(acl("accessTo")), namedNode(resource));
    store.addQuad(auth, namedNode(acl("default")), namedNode(resource));
    store.addQuad(auth, namedNode(acl("mode")), namedNode(acl("Read")));
    store.addQuad(auth, namedNode(acl("mode")), namedNode(acl("Write")));
    store.addQuad(auth, namedNode(acl("mode")), namedNode(acl("Control")));
    const writer = new Writer({ format: "text/turtle", prefixes: { acl: ACL, foaf: FOAF } });
    writer.addQuads([...store]);
    return new Promise((resolve, reject) => {
        writer.end((error, result) => (error ? reject(error) : resolve(result)));
    });
}
/**
 * Write an owner-only ACL for `resourceUrl` via an injectable authed `fetch`
 * (PUT `${resourceUrl}.acl`). The fetch seam keeps this unit-testable with a
 * stubbed fetch and no server (suite convention). Throws on a non-2xx response
 * (fail-closed — a resource whose ACL write failed must not be treated as
 * protected).
 */
export async function writeOwnerOnlyAcl(resourceUrl, ownerWebId, authedFetch) {
    const aclUrl = aclUrlFor(resourceUrl);
    const body = await buildOwnerOnlyAcl(resourceUrl, ownerWebId);
    const res = await authedFetch(aclUrl, {
        method: "PUT",
        headers: { "content-type": "text/turtle" },
        body,
    });
    if (!res.ok) {
        throw new Error(`owner-only ACL write failed: PUT ${aclUrl} -> ${res.status} ${res.statusText}`);
    }
}
//# sourceMappingURL=acl.js.map