// AUTHORED-BY Codex GPT-6.1-Sol
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
import { buildOwnerOnlyAclTurtle, discoverWacAcl } from "@jeswr/agentic-legacy-bridge";
import type { PodFetch } from "../config.js";
import { isSafeContainer } from "../config.js";
import { putResource, throwIfNotWritten } from "./write.js";

/** Legacy CSS URL convention. Never use this as proof of an ACL association.
 * @deprecated Discover the container's ACL with discoverWacAcl instead. */
export function aclUrlFor(container: string): string {
  return `${container}.acl`;
}

/**
 * Write the owner-only ACL for `container` (owner gets Read/Write/Control on the
 * container AND its descendants; NOTHING to anyone else). Idempotent — safe to call
 * before every batch of writes. Throws (fail-closed) on an unsafe container/owner or
 * a failed write.
 */
export async function writeOwnerOnlyAcl(
  fetchFn: PodFetch,
  container: string,
  ownerWebId: string,
): Promise<void> {
  if (!isSafeContainer(container)) {
    throw new Error(`writeOwnerOnlyAcl: unsafe container IRI: ${container}`);
  }
  // buildOwnerOnlyAclTurtle re-validates BOTH inputs and throws before building a
  // single quad if either is not a canonical, injection-safe IRI.
  const turtle = await buildOwnerOnlyAclTurtle(container, ownerWebId);
  const aclUrl = await discoverWacAcl(fetchFn, container);
  const res = await putResource(fetchFn, aclUrl, turtle, {
    contentType: "text/turtle",
    base: container,
  });
  throwIfNotWritten(res, aclUrl);
}
