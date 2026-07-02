// AUTHORED-BY Claude Fable 5
//
// The §3.5 approval pipeline, CLIENT-SIDE (Phase 1 — no new server surface).
// The guarded state machine over the pod's own CAS primitive (`If-Match` /
// `If-None-Match: *`):
//
//   Pending ──CAS(If-Match, persists SNAPSHOT + grantId)──▶ Approving
//   Approving ──create-only grant record ─▶ create-only receipt ─▶ ACL writes
//             ──CAS──▶ Approved
//   Pending ──CAS──▶ Denied (+ create-only denial receipt)
//
// Invariants (each one is regression-tested):
//   • Target resolution happens EXACTLY ONCE, before the Approving CAS; the
//     resolved set + the deterministic grantId are persisted INTO the request
//     as part of that CAS. Every later step — including a crash-recovery retry
//     — reads the STORED snapshot and never re-resolves (the owner approved a
//     specific target set, not a query).
//   • grantId = sha256(requestId ∥ resolvedTargetSet ∥ ownerWebID ∥ schemaVersion)
//     — deterministic, so retried grant/receipt writes hit the SAME IRIs with
//     `If-None-Match: *` and converge (already-exists = success, never a dup).
//   • A concurrent approval loses the Pending→Approving CAS with a 412, and
//     must re-read and observe the winner — never two grants.
//   • ACL materialisation happens strictly AFTER the Approving CAS commits.
//   • Recovery is FORWARD-ONLY (resume from the snapshot); we never roll back
//     live ACLs (a compensating delete is itself a racy security write).

import type { OdrlPolicy, OdrlRule } from "@jeswr/solid-odrl";
import { policyToRdf } from "@jeswr/solid-odrl";
import type { DatasetCore } from "@rdfjs/types";
import { DataFactory, Store } from "n3";
import { grantOnResource, MODE_IRI, type WacMode } from "./acl.js";
import { PreconditionFailedError, putIfMatch, putIfNoneMatch, type SolidFetch } from "./http.js";
import type { ParsedAccessRequest, RequestSnapshot } from "./inbox.js";
import { readAccessRequest } from "./inbox.js";
import { toTurtle } from "./rdf.js";
import { AccmRecord, ConsentReceipt } from "./records.js";
import { nodeInRegistration, type TypeRegistration } from "./type-index.js";
import { DPV } from "./vocab.js";

export const SCHEMA_VERSION = "1";

/** The approval lost a CAS race or found an unexpected state. */
export class ApprovalConflictError extends Error {
  /** What the request looked like when re-read after the lost race. */
  readonly current: ParsedAccessRequest | null;
  constructor(url: string, current: ParsedAccessRequest | null) {
    super(
      `Approval of ${url} lost a concurrent update (412). Current status: ${
        current?.status ?? "gone"
      }.`,
    );
    this.name = "ApprovalConflictError";
    this.current = current;
  }
}

export class ApprovalStateError extends Error {
  constructor(url: string, expected: string, actual: string) {
    super(`Request ${url} is ${actual}; expected ${expected}.`);
    this.name = "ApprovalStateError";
  }
}

export interface ApprovalContext {
  ownerWebId: string;
  storageRoot: string;
  /** Container for grant records, e.g. `${storageRoot}access-manager/grants/`. */
  grantsContainer: string;
  /** Container for consent receipts. */
  receiptsContainer: string;
  fetch: SolidFetch;
  /** Type-index registrations, for data-class → target resolution. */
  registrations: readonly TypeRegistration[];
  /** All storage resource URLs known to the app (the walked tree), for class resolution. */
  knownResources: readonly string[];
  now?: () => Date;
}

/** Deterministic grant id — sha256 hex over the §3.5 canonical tuple. */
export async function deriveGrantId(
  requestId: string,
  resolvedTargets: readonly string[],
  ownerWebId: string,
  schemaVersion: string = SCHEMA_VERSION,
): Promise<string> {
  const canonical = JSON.stringify({
    requestId,
    targets: [...resolvedTargets].sort(),
    owner: ownerWebId,
    schemaVersion,
  });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Resolve a request's data-class / targets to the CONCRETE target set — ONCE,
 * at approval time (§3.4 step 1 + §6.2: Phase 1 PINS concrete targets).
 *  - a target that is a registered data class (or the accm:dataClass) resolves
 *    through the type index to registered instances + known members of its
 *    instance containers;
 *  - any other target is taken as a concrete resource.
 * The result is deduped + sorted (the canonical snapshot order) and — a
 * security invariant — CONFINED TO THE OWNER'S STORAGE: a request naming an
 * off-pod IRI must never reach the ACL-write path (the app would otherwise be
 * a confused deputy attempting grants against arbitrary origins).
 */
export function resolveTargets(
  request: ParsedAccessRequest,
  registrations: readonly TypeRegistration[],
  knownResources: readonly string[],
  storageRoot: string,
): string[] {
  const out = new Set<string>();
  const classIris = new Set<string>();
  if (request.dataClass !== undefined) classIris.add(request.dataClass);
  for (const target of request.targets) {
    const asClass = registrations.filter((r) => r.forClass === target);
    if (asClass.length > 0) {
      classIris.add(target);
    } else {
      out.add(target);
    }
  }
  for (const classIri of classIris) {
    for (const reg of registrations.filter((r) => r.forClass === classIri)) {
      for (const instance of reg.instances) out.add(instance);
      for (const resource of knownResources) {
        if (nodeInRegistration(resource, reg)) out.add(resource);
      }
    }
  }
  return [...out].filter((t) => t.startsWith(storageRoot)).sort();
}

/** Preview for the consent UI: what approving would concretely share (§3.4 step 2). */
export function previewApproval(
  request: ParsedAccessRequest,
  ctx: Pick<ApprovalContext, "registrations" | "knownResources" | "storageRoot">,
): { targets: string[]; modes: WacMode[] } {
  return {
    targets: resolveTargets(request, ctx.registrations, ctx.knownResources, ctx.storageRoot),
    modes: request.modes,
  };
}

function grantUrl(ctx: ApprovalContext, grantId: string): string {
  return `${ctx.grantsContainer}grant-${grantId}.ttl`;
}
function receiptUrl(ctx: ApprovalContext, id: string): string {
  return `${ctx.receiptsContainer}receipt-${id}.ttl`;
}

/**
 * Step A (the CAS that OWNS the approval): Pending → Approving, persisting the
 * snapshot + grantId into the request resource under `If-Match`. The winner
 * proceeds; the loser gets ApprovalConflictError carrying the re-read state.
 */
async function casToApproving(
  request: ParsedAccessRequest,
  snapshot: RequestSnapshot,
  ctx: ApprovalContext,
): Promise<void> {
  const record = new AccmRecord(request.url, request.dataset, DataFactory);
  record.status = "Approving";
  record.grantId = snapshot.grantId;
  record.schemaVersion = snapshot.schemaVersion;
  record.snapshotAgent = snapshot.agent;
  record.resolvesTo.clear();
  for (const t of snapshot.targets) record.resolvesTo.add(t);
  record.snapshotModes.clear();
  for (const m of snapshot.modes) record.snapshotModes.add(MODE_IRI[m]);
  const turtle = await toTurtle(request.dataset, request.url);
  try {
    await putIfMatch(request.url, turtle, request.etag, ctx.fetch);
  } catch (e) {
    if (e instanceof PreconditionFailedError) {
      throw new ApprovalConflictError(request.url, await readAccessRequest(request.url, ctx.fetch));
    }
    throw e;
  }
}

/** Build the grant record: an ODRL Agreement (via @jeswr/solid-odrl) + accm fields. */
export async function buildGrantRecordTurtle(
  url: string,
  request: Pick<ParsedAccessRequest, "url" | "purpose" | "expiry">,
  snapshot: RequestSnapshot,
  ctx: Pick<ApprovalContext, "ownerWebId" | "now">,
): Promise<string> {
  const constraints: NonNullable<OdrlRule["constraints"]>[number][] = [];
  if (request.purpose !== undefined) {
    constraints.push({ leftOperand: "purpose", operator: "eq", rightOperand: request.purpose });
  }
  if (request.expiry !== undefined) {
    constraints.push({ leftOperand: "dateTime", operator: "lteq", rightOperand: request.expiry });
  }
  const permissions: OdrlRule[] = snapshot.targets.flatMap((target) =>
    snapshot.modes.map(
      (mode): OdrlRule => ({
        type: "permission",
        action: mode === "Read" ? "read" : mode === "Append" ? "modify" : "write",
        target,
        assignee: snapshot.agent,
        assigner: ctx.ownerWebId,
        ...(constraints.length > 0 ? { constraints } : {}),
      }),
    ),
  );
  const policy: OdrlPolicy = {
    id: url,
    type: "Agreement",
    assigner: ctx.ownerWebId,
    assignee: snapshot.agent,
    permissions,
  };
  const dataset: DatasetCore = new Store(policyToRdf(policy));
  const record = new AccmRecord(url, dataset, DataFactory);
  record.grantId = snapshot.grantId;
  record.schemaVersion = snapshot.schemaVersion;
  record.requestRef = request.url;
  record.snapshotAgent = snapshot.agent;
  for (const t of snapshot.targets) record.resolvesTo.add(t);
  for (const m of snapshot.modes) record.snapshotModes.add(MODE_IRI[m]);
  record.created = (ctx.now ?? (() => new Date()))();
  return toTurtle(dataset, url);
}

/** Build a DPV 2.2 consent receipt (ConsentGiven / ConsentRefused / …). */
export async function buildReceiptTurtle(
  url: string,
  fields: {
    statusIri: string;
    owner: string;
    recipient?: string;
    purpose?: string;
    grantRef?: string;
    requestRef: string;
    targets?: readonly string[];
    grantId?: string;
  },
  now: () => Date,
): Promise<string> {
  const dataset: DatasetCore = new Store();
  const receipt = new ConsentReceipt(url, dataset, DataFactory);
  receipt.types.add(DPV.ConsentRecord);
  receipt.dataSubject = fields.owner;
  if (fields.recipient !== undefined) receipt.recipient = fields.recipient;
  if (fields.purpose?.startsWith("http")) {
    receipt.purpose = fields.purpose;
  }
  receipt.consentStatus = fields.statusIri;
  receipt.legalBasis = DPV.Consent;
  if (fields.grantRef !== undefined) receipt.grantRef = fields.grantRef;
  receipt.requestRef = fields.requestRef;
  if (fields.grantId !== undefined) receipt.grantId = fields.grantId;
  for (const t of fields.targets ?? []) receipt.resolvesTo.add(t);
  receipt.created = now();
  return toTurtle(dataset, url);
}

/** Create-only write; "already exists" converges as success (idempotent retry). */
async function putCreateOnlyIdempotent(
  url: string,
  turtle: string,
  fetchFn: SolidFetch,
): Promise<void> {
  try {
    await putIfNoneMatch(url, turtle, fetchFn);
  } catch (e) {
    if (e instanceof PreconditionFailedError) return; // §3.5: retry found it present — no-op success
    throw e;
  }
}

/**
 * Steps B–E, ALL driven from the STORED snapshot (never re-resolved): grant
 * record → receipt → ACL materialisation → CAS to Approved. Idempotent — safe
 * to re-run for crash recovery (`resumeApproval`).
 */
async function completeFromSnapshot(
  requestUrl: string,
  request: Pick<ParsedAccessRequest, "url" | "purpose" | "expiry">,
  snapshot: RequestSnapshot,
  ctx: ApprovalContext,
): Promise<{ grantUrl: string; receiptUrl: string }> {
  // Defense in depth on the resume path: the snapshot is re-validated before
  // ANY write. (1) Every pinned target must live under the owner's storage —
  // a tampered/corrupted snapshot must never drive ACL writes elsewhere.
  // (2) The stored grantId must recompute from the stored tuple — integrity
  // binding of id ↔ target set (a mismatch means corruption or tampering).
  // Residual (documented in DECISIONS.md): an inbox writable (not merely
  // appendable) by requesters could carry a self-consistent forged snapshot —
  // which is why resume is a USER-CONFIRMED action showing the pinned targets,
  // never an automatic sweep.
  if (
    snapshot.targets.length === 0 ||
    !snapshot.targets.every((t) => t.startsWith(ctx.storageRoot))
  ) {
    throw new ApprovalStateError(
      requestUrl,
      "snapshot targets within the owner's storage",
      "out-of-scope targets",
    );
  }
  const expectedId = await deriveGrantId(
    requestUrl,
    snapshot.targets,
    ctx.ownerWebId,
    snapshot.schemaVersion,
  );
  if (expectedId !== snapshot.grantId) {
    throw new ApprovalStateError(
      requestUrl,
      "a grantId that recomputes from the snapshot",
      "mismatched grantId",
    );
  }
  const now = ctx.now ?? (() => new Date());
  const gUrl = grantUrl(ctx, snapshot.grantId);
  const rUrl = receiptUrl(ctx, snapshot.grantId);

  await putCreateOnlyIdempotent(
    gUrl,
    await buildGrantRecordTurtle(gUrl, request, snapshot, ctx),
    ctx.fetch,
  );
  await putCreateOnlyIdempotent(
    rUrl,
    await buildReceiptTurtle(
      rUrl,
      {
        statusIri: DPV.ConsentGiven,
        owner: ctx.ownerWebId,
        ...(snapshot.agent !== undefined ? { recipient: snapshot.agent } : {}),
        ...(request.purpose !== undefined ? { purpose: request.purpose } : {}),
        grantRef: gUrl,
        requestRef: requestUrl,
        targets: snapshot.targets,
        grantId: snapshot.grantId,
      },
      now,
    ),
    ctx.fetch,
  );

  // ACL writes — strictly AFTER the Approving CAS committed, idempotent
  // (agent-add is set-semantics; matching nodes are reused).
  for (const target of snapshot.targets) {
    await grantOnResource(
      target,
      ctx.storageRoot,
      ctx.ownerWebId,
      snapshot.agent,
      snapshot.modes,
      ctx.fetch,
    );
  }

  // Final CAS: Approving → Approved (+ grantRef). Re-read for a fresh ETag; a
  // 412 here means another resumer finished — re-read and accept Approved.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const current = await readAccessRequest(requestUrl, ctx.fetch);
    if (!current) break;
    if (current.status === "Approved") break;
    const record = new AccmRecord(current.url, current.dataset, DataFactory);
    record.status = "Approved";
    record.grantRef = gUrl;
    try {
      await putIfMatch(
        current.url,
        await toTurtle(current.dataset, current.url),
        current.etag,
        ctx.fetch,
      );
      break;
    } catch (e) {
      if (e instanceof PreconditionFailedError) continue;
      throw e;
    }
  }
  return { grantUrl: gUrl, receiptUrl: rUrl };
}

/**
 * APPROVE (the full §3.5 pipeline). `request` must be the freshly-read Pending
 * resource (its ETag anchors the CAS).
 */
export async function approveRequest(
  request: ParsedAccessRequest,
  ctx: ApprovalContext,
): Promise<{ grantUrl: string; receiptUrl: string; snapshot: RequestSnapshot }> {
  if (request.status !== "Pending") {
    throw new ApprovalStateError(request.url, "Pending", request.status);
  }
  if (request.requester === undefined) {
    throw new ApprovalStateError(request.url, "a requester (odrl:assignee)", "none");
  }
  // Resolve ONCE, before the CAS (§3.5) — the snapshot is what the owner approved.
  const targets = resolveTargets(request, ctx.registrations, ctx.knownResources, ctx.storageRoot);
  if (targets.length === 0) {
    throw new ApprovalStateError(request.url, "at least one resolvable target", "none");
  }
  const modes: WacMode[] = request.modes.length > 0 ? request.modes : ["Read"];
  const grantId = await deriveGrantId(request.url, targets, ctx.ownerWebId, SCHEMA_VERSION);
  const snapshot: RequestSnapshot = {
    grantId,
    targets,
    agent: request.requester,
    modes,
    schemaVersion: SCHEMA_VERSION,
  };
  await casToApproving(request, snapshot, ctx);
  const done = await completeFromSnapshot(request.url, request, snapshot, ctx);
  return { ...done, snapshot };
}

/**
 * RESUME an orphaned `Approving` request (crash recovery — §3.5 forward
 * reconciliation): re-runs the idempotent pipeline FROM THE STORED SNAPSHOT.
 * It never re-resolves; a snapshot-less Approving request is surfaced as an
 * error (it cannot be safely completed).
 */
export async function resumeApproval(
  requestUrl: string,
  ctx: ApprovalContext,
): Promise<{ grantUrl: string; receiptUrl: string }> {
  const current = await readAccessRequest(requestUrl, ctx.fetch);
  if (!current) throw new ApprovalStateError(requestUrl, "an existing request", "gone");
  if (current.status !== "Approving" && current.status !== "Approved") {
    throw new ApprovalStateError(requestUrl, "Approving", current.status);
  }
  const snapshot = current.snapshot;
  if (!snapshot) {
    throw new ApprovalStateError(requestUrl, "a persisted snapshot", "none");
  }
  return completeFromSnapshot(requestUrl, current, snapshot, ctx);
}

/** DENY: CAS Pending → Denied + a create-only ConsentRefused receipt. */
export async function denyRequest(
  request: ParsedAccessRequest,
  ctx: ApprovalContext,
): Promise<{ receiptUrl: string }> {
  if (request.status !== "Pending") {
    throw new ApprovalStateError(request.url, "Pending", request.status);
  }
  const record = new AccmRecord(request.url, request.dataset, DataFactory);
  record.status = "Denied";
  try {
    await putIfMatch(
      request.url,
      await toTurtle(request.dataset, request.url),
      request.etag,
      ctx.fetch,
    );
  } catch (e) {
    if (e instanceof PreconditionFailedError) {
      throw new ApprovalConflictError(request.url, await readAccessRequest(request.url, ctx.fetch));
    }
    throw e;
  }
  const id = await deriveGrantId(request.url, [], ctx.ownerWebId, SCHEMA_VERSION);
  const rUrl = receiptUrl(ctx, id);
  await putCreateOnlyIdempotent(
    rUrl,
    await buildReceiptTurtle(
      rUrl,
      {
        statusIri: DPV.ConsentRefused,
        owner: ctx.ownerWebId,
        ...(request.requester !== undefined ? { recipient: request.requester } : {}),
        ...(request.purpose !== undefined ? { purpose: request.purpose } : {}),
        requestRef: request.url,
      },
      ctx.now ?? (() => new Date()),
    ),
    ctx.fetch,
  );
  return { receiptUrl: rUrl };
}
