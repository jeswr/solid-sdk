/**
 * Owner-private persistence for {@link ActionProposal} records — the pod-as-state seam
 * between the Actor (writes `pending`) and the outbox executor (reads `confirmed`,
 * marks `executed`). The proposals container is locked owner-only ACL-FIRST before the
 * first record lands. New proposals are CREATE-ONLY writes (`If-None-Match: *`, so a
 * re-run never clobbers a record); status transitions are COMPARE-AND-SWAP writes
 * (`If-Match: <etag>`, so two executor runs can never both send the same proposal).
 */
import type { PodFetch } from "../config.js";
import { type ActionProposal } from "./proposals.js";
/** A proposal read from the pod together with its ETag (for a later CAS write). */
export interface LoadedProposal {
    readonly proposal: ActionProposal;
    readonly url: string;
    readonly etag: string | null;
}
/**
 * Create a new `pending` proposal (ACL-first, create-only). Returns the resource URL,
 * or `undefined` if a record with that id already exists (a `412` — never clobbered).
 */
export declare function createProposal(fetchFn: PodFetch, container: string, ownerWebId: string, proposal: ActionProposal): Promise<string | undefined>;
/**
 * Compare-and-swap an existing proposal (a status transition). Returns `true` on
 * success, `false` if the ETag no longer matches (`412` — someone else changed it).
 */
export declare function updateProposal(fetchFn: PodFetch, container: string, proposal: ActionProposal, ifMatch: string): Promise<boolean>;
/** Read + parse a single proposal resource (or `undefined` if it is not a proposal). */
export declare function readProposal(fetchFn: PodFetch, url: string): Promise<LoadedProposal | undefined>;
/**
 * List every well-formed proposal in a container. A resource that does not parse as a
 * proposal is skipped (fail-closed — a malformed record never reaches the executor).
 */
export declare function listProposals(fetchFn: PodFetch, container: string): Promise<LoadedProposal[]>;
//# sourceMappingURL=proposal-store.d.ts.map