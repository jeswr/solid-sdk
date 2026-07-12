// AUTHORED-BY Claude Fable 5
//
// History / receipts + revocation. Grant records and DPV consent receipts are
// the audit trail (proposal §2.1: receipts adopt DPV 2.2 / ISO 27560 — what
// was granted, to whom, for what purpose, when, revoked-when). Revocation
// retracts the materialised WAC from every pinned target (from the STORED
// grant snapshot — never re-resolved), then CAS-flips the receipt + grant
// record to withdrawn. Honest residual (§6.1): revocation of already-issued
// tokens is eventually-consistent; this app retracts the policy + records.

import { policyFromRdf } from "@jeswr/solid-odrl";
import { AclResource } from "@solid/object";
import { DataFactory } from "n3";
import {
  NoAclFoundError,
  projectEntries,
  readEffectiveAcl,
  removeAgentFromEntry,
  updateAclWithRetry,
  type WacMode,
} from "./acl.js";
import {
  isHttpUrl,
  PreconditionFailedError,
  putIfMatch,
  readRdf,
  type SolidFetch,
} from "./http.js";
import { toTurtle, tryRead } from "./rdf.js";
import { AccmRecord, ConsentReceipt } from "./records.js";
import { containerMembers } from "./storage-walk.js";
import { DPV } from "./vocab.js";

const MODE_FROM_IRI: Record<string, WacMode> = {
  "http://www.w3.org/ns/auth/acl#Read": "Read",
  "http://www.w3.org/ns/auth/acl#Write": "Write",
  "http://www.w3.org/ns/auth/acl#Append": "Append",
  "http://www.w3.org/ns/auth/acl#Control": "Control",
};

export interface GrantRecord {
  url: string;
  etag: string | null;
  grantId?: string;
  agent?: string;
  modes: WacMode[];
  targets: string[];
  requestRef?: string;
  createdAt?: Date;
  revokedAt?: Date;
  purpose?: string;
}

export interface ReceiptRecord {
  url: string;
  /** The DPV consent-status IRI (ConsentGiven / ConsentRefused / ConsentWithdrawn). */
  status?: string;
  owner?: string;
  recipient?: string;
  purpose?: string;
  grantRef?: string;
  requestRef?: string;
  targets: string[];
  createdAt?: Date;
  revokedAt?: Date;
}

/** Project a grant record (guarded — own-pod data, but stay defensive). */
export async function readGrantRecord(
  url: string,
  fetchFn: SolidFetch,
): Promise<GrantRecord | null> {
  const read = await readRdf(url, fetchFn);
  if (!read) return null;
  const record = new AccmRecord(read.url, read.dataset, DataFactory);
  const policy = tryRead(() => policyFromRdf(read.dataset));
  let purpose: string | undefined;
  for (const rule of policy?.permissions ?? []) {
    for (const c of rule.constraints ?? []) {
      if (c.leftOperand === "purpose" && typeof c.rightOperand === "string") {
        purpose = c.rightOperand;
      }
    }
  }
  const agent = tryRead(() => record.snapshotAgent);
  const grantId = tryRead(() => record.grantId);
  const requestRef = tryRead(() => record.requestRef);
  const createdAt = tryRead(() => record.created);
  const revokedAt = tryRead(() => record.revokedAt);
  return {
    url: read.url,
    etag: read.etag,
    ...(grantId !== undefined ? { grantId } : {}),
    ...(agent !== undefined ? { agent } : {}),
    modes: (tryRead(() => [...record.snapshotModes]) ?? [])
      .map((m) => MODE_FROM_IRI[m])
      .filter((m): m is WacMode => m !== undefined),
    targets: (tryRead(() => [...record.resolvesTo]) ?? []).filter(isHttpUrl).sort(),
    ...(requestRef !== undefined ? { requestRef } : {}),
    ...(createdAt !== undefined ? { createdAt } : {}),
    ...(revokedAt !== undefined ? { revokedAt } : {}),
    ...(purpose !== undefined ? { purpose } : {}),
  };
}

/** List grant records in the grants container (missing container → empty). */
export async function listGrants(
  grantsContainer: string,
  fetchFn: SolidFetch,
): Promise<GrantRecord[]> {
  const container = await readRdf(grantsContainer, fetchFn);
  if (!container) return [];
  const out: GrantRecord[] = [];
  for (const member of containerMembers(container.dataset)) {
    if (member.isContainer) continue;
    try {
      const grant = await readGrantRecord(member.url, fetchFn);
      if (grant) out.push(grant);
    } catch {
      // an unreadable record never aborts the listing
    }
  }
  return out;
}

/** Project one consent receipt. */
export async function readReceipt(url: string, fetchFn: SolidFetch): Promise<ReceiptRecord | null> {
  const read = await readRdf(url, fetchFn);
  if (!read) return null;
  const receipt = new ConsentReceipt(read.url, read.dataset, DataFactory);
  const status = tryRead(() => receipt.consentStatus);
  const owner = tryRead(() => receipt.dataSubject);
  const recipient = tryRead(() => receipt.recipient);
  const purpose = tryRead(() => receipt.purpose);
  const grantRef = tryRead(() => receipt.grantRef);
  const requestRef = tryRead(() => receipt.requestRef);
  const createdAt = tryRead(() => receipt.created);
  const revokedAt = tryRead(() => receipt.revokedAt);
  return {
    url: read.url,
    ...(status !== undefined ? { status } : {}),
    ...(owner !== undefined ? { owner } : {}),
    ...(recipient !== undefined ? { recipient } : {}),
    ...(purpose !== undefined ? { purpose } : {}),
    ...(grantRef !== undefined ? { grantRef } : {}),
    ...(requestRef !== undefined ? { requestRef } : {}),
    targets: (tryRead(() => [...receipt.resolvesTo]) ?? []).filter(isHttpUrl).sort(),
    ...(createdAt !== undefined ? { createdAt } : {}),
    ...(revokedAt !== undefined ? { revokedAt } : {}),
  };
}

/** List consent receipts (the audit-trail view). */
export async function listReceipts(
  receiptsContainer: string,
  fetchFn: SolidFetch,
): Promise<ReceiptRecord[]> {
  const container = await readRdf(receiptsContainer, fetchFn);
  if (!container) return [];
  const out: ReceiptRecord[] = [];
  for (const member of containerMembers(container.dataset)) {
    if (member.isContainer) continue;
    try {
      const receipt = await readReceipt(member.url, fetchFn);
      if (receipt) out.push(receipt);
    } catch {
      // never abort the audit view on one bad record
    }
  }
  return out;
}

function sameModeSet(a: readonly WacMode[], b: readonly WacMode[]): boolean {
  return [...a].sort().join(",") === [...b].sort().join(",");
}

/**
 * Retract EXACTLY what a grant materialised on one pinned target — no more.
 * The approval pipeline only ever writes agent-scoped `acl:accessTo` entries
 * into the target's OWN ACL (materialising one first when needed), with the
 * grant's pinned mode set. So revocation removes the agent ONLY from entries
 * in the target's own ACL that match that exact shape (accessTo == target,
 * not public/authenticated, mode set == the grant's). Unrelated access —
 * manual shares with other modes, ancestor `acl:default` entries, other
 * agents — is never touched (the roborev High: a broad "remove the agent
 * everywhere" retraction would revoke access this grant never granted).
 * A target with no governing ACL is skipped (nothing to retract).
 */
export async function retractGrantFromTarget(
  target: string,
  storageRoot: string,
  agent: string,
  modes: readonly WacMode[],
  ownerWebId: string,
  fetchFn: SolidFetch,
): Promise<void> {
  let effective: Awaited<ReturnType<typeof readEffectiveAcl>>;
  try {
    effective = await readEffectiveAcl(target, storageRoot, fetchFn);
  } catch (e) {
    if (e instanceof NoAclFoundError) return;
    throw e;
  }
  // The pipeline wrote into the target's OWN ACL; an inherited-only target
  // means this grant's entry no longer exists (or never did) — nothing to do.
  if (!effective.owned) return;
  await updateAclWithRetry(effective.aclUrl, fetchFn, (dataset) => {
    const acl = new AclResource(dataset, DataFactory);
    const authIris = [...acl.authorizations].map((a) => a.value);
    for (const authIri of authIris) {
      const entry = projectEntries(dataset).find((e) => e.authIri === authIri);
      if (
        entry?.agents.includes(agent) === true &&
        !entry.isPublic &&
        !entry.isAuthenticated &&
        entry.accessTo.some((t) => t === target) &&
        sameModeSet(entry.modes, modes)
      ) {
        removeAgentFromEntry(dataset, authIri, agent, ownerWebId, target);
      }
    }
  });
}

/**
 * REVOKE a grant: retract the agent's WAC on every PINNED target from the
 * stored snapshot, then CAS the grant record + receipt to withdrawn
 * (dpv:ConsentWithdrawn + accm:revokedAt). Idempotent — re-running converges.
 */
export async function revokeGrant(
  grant: GrantRecord,
  ctx: {
    ownerWebId: string;
    storageRoot: string;
    receiptsContainer: string;
    fetch: SolidFetch;
    now?: () => Date;
  },
): Promise<void> {
  const now = ctx.now ?? (() => new Date());
  const agent = grant.agent;
  if (agent !== undefined) {
    for (const target of grant.targets) {
      await retractGrantFromTarget(
        target,
        ctx.storageRoot,
        agent,
        grant.modes,
        ctx.ownerWebId,
        ctx.fetch,
      );
    }
  }
  // Mark the grant record revoked (CAS; tolerate concurrent revokers).
  await casSetRevoked(grant.url, now(), ctx.fetch);
  // Flip the linked receipt (deterministically named from the grantId) to
  // ConsentWithdrawn. A grantId-less record has no receipt to flip.
  if (grant.grantId !== undefined) {
    await casWithdrawReceipt(
      `${ctx.receiptsContainer}receipt-${grant.grantId}.ttl`,
      now(),
      ctx.fetch,
    );
  }
}

async function casSetRevoked(url: string, when: Date, fetchFn: SolidFetch): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const read = await readRdf(url, fetchFn);
    if (!read) return;
    const record = new AccmRecord(read.url, read.dataset, DataFactory);
    if (tryRead(() => record.revokedAt) !== undefined) return; // already revoked
    record.revokedAt = when;
    try {
      await putIfMatch(read.url, await toTurtle(read.dataset, read.url), read.etag, fetchFn);
      return;
    } catch (e) {
      if (!(e instanceof PreconditionFailedError)) throw e;
      // lost the race → re-read and retry
    }
  }
}

async function casWithdrawReceipt(url: string, when: Date, fetchFn: SolidFetch): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const read = await readRdf(url, fetchFn);
    if (!read) return;
    const receipt = new ConsentReceipt(read.url, read.dataset, DataFactory);
    if (tryRead(() => receipt.consentStatus) === DPV.ConsentWithdrawn) return;
    receipt.consentStatus = DPV.ConsentWithdrawn;
    receipt.revokedAt = when;
    try {
      await putIfMatch(read.url, await toTurtle(read.dataset, read.url), read.etag, fetchFn);
      return;
    } catch (e) {
      if (!(e instanceof PreconditionFailedError)) throw e;
      // lost the race → re-read and retry
    }
  }
}
