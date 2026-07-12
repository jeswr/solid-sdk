import type { Membership, MembershipVerification, RegistryIssue, StorageVerification } from "./types.js";
import type { MembershipNode, StorageNode } from "./wrappers.js";
/**
 * Project a {@link MembershipNode} into a plain {@link Membership}, recording
 * issues. Exposed so a registry walk can verify each membership independently. The
 * per-field validators run in a fixed order (term-type → app → status → assertedBy)
 * so the recorded issue ORDER is stable.
 */
export declare function membershipNodeToView(node: MembershipNode, issues: RegistryIssue[]): Membership;
/** Verify a single {@link MembershipNode} in isolation. */
export declare function verifyMembershipNode(node: MembershipNode): MembershipVerification;
/** Verify a single {@link StorageNode} in isolation. */
export declare function verifyStorageNode(node: StorageNode): StorageVerification;
//# sourceMappingURL=verify.d.ts.map