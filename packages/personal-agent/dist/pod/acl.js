// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * The ACL-FIRST invariant (§7): "no resource ever exists without its owner-only ACL."
 * Every container this system creates (the proposals + outbox containers; the inbox
 * is locked by `importInbound` itself) has its owner-only WAC ACL written BEFORE any
 * content lands in it. One mis-set ACL here would leak OTHER PEOPLE's messages — the
 * catastrophic case — so the ACL Turtle is built by the bridge's hardened
 * `buildOwnerOnlyAclTurtle` (fail-closed on an unsafe container/owner IRI; `n3.Writer`
 * + typed quads, never hand-concatenated) and written through the redirect-refusing
 * scope-guarded {@link putResource}.
 */
import { buildOwnerOnlyAclTurtle } from "@jeswr/agentic-legacy-bridge";
import { isSafeContainer } from "../config.js";
import { putResource, throwIfNotWritten } from "./write.js";
/** The ACL resource URL for a container (the CSS `<container>.acl` convention). */
export function aclUrlFor(container) {
    return `${container}.acl`;
}
/**
 * Write the owner-only ACL for `container` (owner gets Read/Write/Control on the
 * container AND its descendants; NOTHING to anyone else). Idempotent — safe to call
 * before every batch of writes. Throws (fail-closed) on an unsafe container/owner or
 * a failed write.
 */
export async function writeOwnerOnlyAcl(fetchFn, container, ownerWebId) {
    if (!isSafeContainer(container)) {
        throw new Error(`writeOwnerOnlyAcl: unsafe container IRI: ${container}`);
    }
    // buildOwnerOnlyAclTurtle re-validates BOTH inputs and throws before building a
    // single quad if either is not a canonical, injection-safe IRI.
    const turtle = await buildOwnerOnlyAclTurtle(container, ownerWebId);
    const aclUrl = aclUrlFor(container);
    const res = await putResource(fetchFn, aclUrl, turtle, {
        contentType: "text/turtle",
        base: container,
    });
    throwIfNotWritten(res, aclUrl);
}
//# sourceMappingURL=acl.js.map