import type { PodFetch } from "../config.js";
/** The ACL resource URL for a container (the CSS `<container>.acl` convention). */
export declare function aclUrlFor(container: string): string;
/**
 * Write the owner-only ACL for `container` (owner gets Read/Write/Control on the
 * container AND its descendants; NOTHING to anyone else). Idempotent — safe to call
 * before every batch of writes. Throws (fail-closed) on an unsafe container/owner or
 * a failed write.
 */
export declare function writeOwnerOnlyAcl(fetchFn: PodFetch, container: string, ownerWebId: string): Promise<void>;
//# sourceMappingURL=acl.d.ts.map