// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-5
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
 * Built with pod-access policy writers — **never hand-concatenated
 * triples** (house rule). Browser-safe: only suite RDF packages, `n3`, and the
 * WHATWG `URL` global.
 */

import { ownerPolicy, writeWac } from "@jeswr/pod-access";
import { makeOwnerOnly } from "@jeswr/pod-access/roles";
import { httpIriOrUndefined } from "./iri.js";

/**
 * Canonicalise + validate a resource/container URL that an ACL will be written
 * for. **Fail-closed:** rejects anything that is not an absolute http(s) URL, and
 * rejects a URL carrying a FRAGMENT. A fragment is the dangerous case — appending
 * `.acl` to a subject IRI like `…/meal.ttl#it` yields `…/meal.ttl#it.acl`, whose
 * fragment `fetch` STRIPS, so the ACL body would be PUT to the DATA resource
 * itself (`…/meal.ttl`), overwriting it. Returns the canonical fragment-free URL.
 */
function assertAclableResource(resourceUrl: string): string {
  let u: URL;
  try {
    u = new URL(resourceUrl);
  } catch {
    throw new Error(
      `aclUrlFor: resourceUrl must be an absolute http(s) URL (got ${JSON.stringify(resourceUrl)}).`,
    );
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error(
      `aclUrlFor: resourceUrl must be http(s) (got ${u.protocol}) — refusing to write an ACL for a non-http resource.`,
    );
  }
  if (u.hash !== "") {
    throw new Error(
      `aclUrlFor: resourceUrl must be a resource/container URL with NO fragment (got ${JSON.stringify(
        resourceUrl,
      )}) — a fragment would make the ACL body target the data resource itself.`,
    );
  }
  if (u.search !== "") {
    // A query string is the same hazard as a fragment: `${href}.acl` appends AFTER
    // the query (`…/health/?v=1` → `…/health/?v=1.acl`), so the ACL would be written
    // for a DIFFERENT resource than the one being protected — leaving the health
    // resource unprotected. A WAC-managed resource/container URL never carries one.
    throw new Error(
      `aclUrlFor: resourceUrl must be a resource/container URL with NO query string (got ${JSON.stringify(
        resourceUrl,
      )}) — a query would make the ACL body target a different resource.`,
    );
  }
  return u.href;
}

/**
 * The ACL resource URL for a Solid resource/container — `${resourceUrl}.acl`
 * (the WAC convention). Not a Link-header discovery (that is the client's job on
 * a real server). Offline compatibility only; writers use Link discovery.
 *
 * @throws (fail-closed) if `resourceUrl` is not an absolute http(s) URL, or if it
 *   carries a fragment (see {@link assertAclableResource}).
 */
/** @deprecated Offline naming convention only. Never use it to choose a write URL. */
export function aclUrlFor(resourceUrl: string): string {
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
export async function buildOwnerOnlyAcl(resourceUrl: string, ownerWebId: string): Promise<string> {
  const owner = httpIriOrUndefined(ownerWebId);
  if (!owner) {
    throw new Error(
      "buildOwnerOnlyAcl: ownerWebId must be an absolute http(s) WebID IRI " +
        "(fail-closed — refusing to write an ACL with no valid owner).",
    );
  }
  // Validate + canonicalise the target (throws on a non-http or fragment-bearing
  // URL) so `acl:accessTo`/`acl:default` and the .acl URL all reference the SAME
  // fragment-free resource — never a data resource a stripped fragment would hit.
  const aclUrl = aclUrlFor(resourceUrl);
  const resource = aclUrl.slice(0, -".acl".length);
  const policy = ownerPolicy(owner, true);
  policy.grants[0]?.modes.delete("append");
  return writeWac(policy, resource, aclUrl);
}

/**
 * Write an owner-only ACL for `resourceUrl` via an injectable authed `fetch`
 * (server-advertised access document, conditional create/replace). The fetch seam keeps this unit-testable with a
 * stubbed fetch and no server (suite convention). Throws on a non-2xx response
 * (fail-closed — a resource whose ACL write failed must not be treated as
 * protected).
 */
export async function writeOwnerOnlyAcl(
  resourceUrl: string,
  ownerWebId: string,
  authedFetch: typeof globalThis.fetch,
): Promise<void> {
  await makeOwnerOnly(resourceUrl, ownerWebId, {
    fetch: authedFetch,
    inherit: new URL(resourceUrl).pathname.endsWith("/"),
  });
}
