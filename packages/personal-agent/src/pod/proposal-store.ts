// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * Owner-private persistence for {@link ActionProposal} records — the pod-as-state seam
 * between the Actor (writes `pending`) and the outbox executor (reads `confirmed`,
 * marks `executed`). The proposals container is locked owner-only ACL-FIRST before the
 * first record lands. New proposals are CREATE-ONLY writes (`If-None-Match: *`, so a
 * re-run never clobbers a record); status transitions are COMPARE-AND-SWAP writes
 * (`If-Match: <etag>`, so two executor runs can never both send the same proposal).
 */
import type { PodFetch } from "../config.js";
import { isSafeContainer } from "../config.js";
import { writeOwnerOnlyAcl } from "./acl.js";
import { type ActionProposal, parseProposal, proposalUrl, serializeProposal } from "./proposals.js";
import { listContainer, readGraph } from "./read.js";
import { putResource, throwIfNotWritten } from "./write.js";

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
export async function createProposal(
  fetchFn: PodFetch,
  container: string,
  ownerWebId: string,
  proposal: ActionProposal,
): Promise<string | undefined> {
  if (!isSafeContainer(container)) throw new Error("createProposal: unsafe container");
  const url = proposalUrl(container, proposal.id);
  if (!url) throw new Error("createProposal: unsafe proposal id");
  await writeOwnerOnlyAcl(fetchFn, container, ownerWebId);
  const body = await serializeProposal(proposal, { resourceUrl: url });
  const res = await putResource(fetchFn, url, body, {
    contentType: "text/turtle",
    ifNoneMatch: "*",
    base: container,
  });
  if (res.status === 412) return undefined; // already exists — do not clobber
  throwIfNotWritten(res, url);
  return url;
}

/**
 * Compare-and-swap an existing proposal (a status transition). Returns `true` on
 * success, `false` if the ETag no longer matches (`412` — someone else changed it).
 */
export async function updateProposal(
  fetchFn: PodFetch,
  container: string,
  proposal: ActionProposal,
  ifMatch: string,
): Promise<boolean> {
  const url = proposalUrl(container, proposal.id);
  if (!url) throw new Error("updateProposal: unsafe proposal id");
  const body = await serializeProposal(proposal, { resourceUrl: url });
  const res = await putResource(fetchFn, url, body, {
    contentType: "text/turtle",
    ifMatch,
    base: container,
  });
  if (res.status === 412) return false;
  throwIfNotWritten(res, url);
  return true;
}

/** Read + parse a single proposal resource (or `undefined` if it is not a proposal). */
export async function readProposal(
  fetchFn: PodFetch,
  url: string,
): Promise<LoadedProposal | undefined> {
  const { store, etag } = await readGraph(fetchFn, url);
  const proposal = parseProposal(store);
  if (!proposal) return undefined;
  return { proposal, url, etag };
}

/**
 * List every well-formed proposal in a container. A resource that does not parse as a
 * proposal is skipped (fail-closed — a malformed record never reaches the executor).
 */
export async function listProposals(
  fetchFn: PodFetch,
  container: string,
): Promise<LoadedProposal[]> {
  const children = await listContainer(fetchFn, container);
  const out: LoadedProposal[] = [];
  for (const url of children) {
    if (!url.endsWith(".ttl") || url.endsWith(".acl")) continue;
    try {
      const loaded = await readProposal(fetchFn, url);
      if (loaded) out.push(loaded);
    } catch {
      // A single unreadable/unparseable proposal never aborts the batch.
    }
  }
  return out;
}
