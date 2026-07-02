// AUTHORED-BY Claude Fable 5
// Revocation correctness (direct AND inherited-materialised grants, idempotent
// re-run, lockout guard) + the receipts/grants audit listings.
import { beforeEach, describe, expect, it } from "vitest";
import { readEffectiveAcl } from "../../src/lib/acl.js";
import { type ApprovalContext, approveRequest } from "../../src/lib/approval.js";
import {
  listGrants,
  listReceipts,
  readGrantRecord,
  retractAgentFromTarget,
  revokeGrant,
} from "../../src/lib/history.js";
import { readAccessRequest } from "../../src/lib/inbox.js";
import { readTypeRegistrations } from "../../src/lib/type-index.js";
import { DPV } from "../../src/lib/vocab.js";
import { BOB, buildPod, GRANTS, INBOX, OWNER, POD, RECEIPTS, REQUESTER } from "../fixtures.js";
import type { PodStub } from "../pod-stub.js";

const REQUEST = `${INBOX}request-1.ttl`;
const ALICE = `${POD}contacts/alice.ttl`;
const CAROL = `${POD}contacts/carol.ttl`;
const REPORT = `${POD}docs/report.ttl`;

let pod: PodStub;
let c: ApprovalContext;

beforeEach(async () => {
  pod = buildPod();
  c = {
    ownerWebId: OWNER,
    storageRoot: POD,
    grantsContainer: GRANTS,
    receiptsContainer: RECEIPTS,
    fetch: pod.fetch,
    registrations: await readTypeRegistrations(OWNER, pod.fetch),
    knownResources: [ALICE, CAROL, REPORT],
    now: () => new Date("2026-07-02T12:00:00Z"),
  };
});

async function approve() {
  const request = await readAccessRequest(REQUEST, pod.fetch);
  if (!request) throw new Error("missing request");
  return approveRequest(request, c);
}

describe("listGrants + listReceipts", () => {
  it("lists what an approval produced; empty containers list empty", async () => {
    expect(await listGrants(GRANTS, pod.fetch)).toEqual([]);
    expect(await listReceipts(RECEIPTS, pod.fetch)).toEqual([]);
    const { snapshot } = await approve();
    const grants = await listGrants(GRANTS, pod.fetch);
    expect(grants).toHaveLength(1);
    expect(grants[0]?.grantId).toBe(snapshot.grantId);
    expect(grants[0]?.revokedAt).toBeUndefined();
    const receipts = await listReceipts(RECEIPTS, pod.fetch);
    expect(receipts).toHaveLength(1);
    expect(receipts[0]?.status).toBe(DPV.ConsentGiven);
    expect(receipts[0]?.createdAt?.toISOString()).toBe("2026-07-02T12:00:00.000Z");
  });

  it("an unreadable record never aborts the audit listing", async () => {
    await approve();
    pod.seed(`${GRANTS}garbage.ttl`, "@@@ not turtle");
    const grants = await listGrants(GRANTS, pod.fetch);
    expect(grants).toHaveLength(1); // the good one survives
  });
});

describe("retractAgentFromTarget", () => {
  it("removes the agent from a DIRECT acl", async () => {
    await retractAgentFromTarget(REPORT, POD, BOB, OWNER, pod.fetch);
    const effective = await readEffectiveAcl(REPORT, POD, pod.fetch);
    expect(effective.entries.some((e) => e.agents.includes(BOB))).toBe(false);
    // Public + owner lines survive.
    expect(effective.entries.some((e) => e.isPublic)).toBe(true);
    expect(effective.entries.some((e) => e.agents.includes(OWNER))).toBe(true);
  });

  it("edits the GOVERNING (ancestor) document for an inherited grant", async () => {
    // Give bob inherited access via the root default.
    pod.seed(
      `${POD}.acl`,
      `${pod.body(`${POD}.acl`) ?? ""}
<${POD}.acl#bob> a <http://www.w3.org/ns/auth/acl#Authorization> ;
  <http://www.w3.org/ns/auth/acl#agent> <${BOB}> ;
  <http://www.w3.org/ns/auth/acl#default> <${POD}> ;
  <http://www.w3.org/ns/auth/acl#mode> <http://www.w3.org/ns/auth/acl#Read> .`,
    );
    await retractAgentFromTarget(ALICE, POD, BOB, OWNER, pod.fetch);
    // The edit landed in the ROOT acl (where the authorization lives).
    expect(pod.body(`${POD}.acl`)).not.toContain(BOB);
    expect(pod.has(`${ALICE}.acl`)).toBe(false); // no stray own-acl minted
  });

  it("is a no-op for a target with no ACL anywhere", async () => {
    pod.delete(`${POD}.acl`);
    await expect(
      retractAgentFromTarget(ALICE, POD, BOB, OWNER, pod.fetch),
    ).resolves.toBeUndefined();
  });
});

describe("revokeGrant (end-to-end)", () => {
  it("retracts WAC on every pinned target and flips grant + receipt to withdrawn", async () => {
    const { grantUrl } = await approve();
    const grant = await readGrantRecord(grantUrl, pod.fetch);
    if (!grant) throw new Error("missing grant");

    await revokeGrant(grant, {
      ownerWebId: OWNER,
      storageRoot: POD,
      receiptsContainer: RECEIPTS,
      fetch: pod.fetch,
      now: () => new Date("2026-07-03T09:00:00Z"),
    });

    for (const target of [ALICE, CAROL]) {
      const effective = await readEffectiveAcl(target, POD, pod.fetch);
      expect(effective.entries.some((e) => e.agents.includes(REQUESTER))).toBe(false);
      // The owner keeps Control on the materialised docs (no lockout).
      expect(effective.entries.some((e) => e.agents.includes(OWNER))).toBe(true);
    }

    const after = await readGrantRecord(grantUrl, pod.fetch);
    expect(after?.revokedAt?.toISOString()).toBe("2026-07-03T09:00:00.000Z");
    const receipts = await listReceipts(RECEIPTS, pod.fetch);
    expect(receipts[0]?.status).toBe(DPV.ConsentWithdrawn);
    expect(receipts[0]?.revokedAt?.toISOString()).toBe("2026-07-03T09:00:00.000Z");
  });

  it("is idempotent — a second revoke converges without error", async () => {
    const { grantUrl } = await approve();
    const grant = await readGrantRecord(grantUrl, pod.fetch);
    if (!grant) throw new Error("missing grant");
    const rctx = {
      ownerWebId: OWNER,
      storageRoot: POD,
      receiptsContainer: RECEIPTS,
      fetch: pod.fetch,
      now: () => new Date("2026-07-03T09:00:00Z"),
    };
    await revokeGrant(grant, rctx);
    const firstRevokedAt = (await readGrantRecord(grantUrl, pod.fetch))?.revokedAt;
    await revokeGrant(grant, { ...rctx, now: () => new Date("2026-07-04T09:00:00Z") });
    // The original revocation timestamp is preserved (already-revoked = no-op).
    expect((await readGrantRecord(grantUrl, pod.fetch))?.revokedAt).toEqual(firstRevokedAt);
  });
});
