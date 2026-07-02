// AUTHORED-BY Claude Fable 5
// The §3.5 CAS-pinned approval pipeline. Every invariant is exercised:
// resolve-once + snapshot persistence, deterministic grantId, concurrent-
// approval loser behaviour (412 → observe the winner, never two grants),
// idempotent retry FROM THE STORED SNAPSHOT (never re-resolves), create-only
// convergence, deny, and state-machine guards.
import { beforeEach, describe, expect, it } from "vitest";
import { readEffectiveAcl } from "../../src/lib/acl.js";
import {
  ApprovalConflictError,
  type ApprovalContext,
  ApprovalStateError,
  approveRequest,
  buildGrantRecordTurtle,
  denyRequest,
  deriveGrantId,
  previewApproval,
  resolveTargets,
  resumeApproval,
} from "../../src/lib/approval.js";
import { readGrantRecord, readReceipt } from "../../src/lib/history.js";
import { readAccessRequest } from "../../src/lib/inbox.js";
import { readTypeRegistrations, type TypeRegistration } from "../../src/lib/type-index.js";
import { DPV } from "../../src/lib/vocab.js";
import { buildPod, GRANTS, INBOX, OWNER, POD, RECEIPTS, REQUESTER } from "../fixtures.js";
import type { PodStub } from "../pod-stub.js";

const REQUEST = `${INBOX}request-1.ttl`;
const ALICE = `${POD}contacts/alice.ttl`;
const CAROL = `${POD}contacts/carol.ttl`;

let pod: PodStub;
let registrations: TypeRegistration[];

async function ctx(overrides: Partial<ApprovalContext> = {}): Promise<ApprovalContext> {
  return {
    ownerWebId: OWNER,
    storageRoot: POD,
    grantsContainer: GRANTS,
    receiptsContainer: RECEIPTS,
    fetch: pod.fetch,
    registrations,
    knownResources: [ALICE, CAROL, `${POD}docs/report.ttl`],
    now: () => new Date("2026-07-02T12:00:00Z"),
    ...overrides,
  };
}

beforeEach(async () => {
  pod = buildPod();
  registrations = await readTypeRegistrations(OWNER, pod.fetch);
});

describe("deriveGrantId", () => {
  it("is deterministic and order-independent over targets", async () => {
    const a = await deriveGrantId("r", [ALICE, CAROL], OWNER);
    const b = await deriveGrantId("r", [CAROL, ALICE], OWNER);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes when ANY component of the canonical tuple changes", async () => {
    const base = await deriveGrantId("r", [ALICE], OWNER, "1");
    expect(await deriveGrantId("r2", [ALICE], OWNER, "1")).not.toBe(base);
    expect(await deriveGrantId("r", [CAROL], OWNER, "1")).not.toBe(base);
    expect(await deriveGrantId("r", [ALICE], "https://other.example/#me", "1")).not.toBe(base);
    expect(await deriveGrantId("r", [ALICE], OWNER, "2")).not.toBe(base);
  });
});

describe("resolveTargets", () => {
  it("resolves a data class through the type index to concrete resources", async () => {
    const request = await readAccessRequest(REQUEST, pod.fetch);
    if (!request) throw new Error("missing request");
    const targets = resolveTargets(
      request,
      registrations,
      [ALICE, CAROL, `${POD}docs/report.ttl`],
      POD,
    );
    expect(targets).toEqual([ALICE, CAROL].sort());
  });

  it("passes concrete resource targets through untouched", async () => {
    const request = await readAccessRequest(REQUEST, pod.fetch);
    if (!request) throw new Error("missing request");
    const concrete = { ...request, dataClass: undefined, targets: [`${POD}docs/report.ttl`] };
    // biome-ignore lint/suspicious/noExplicitAny: narrow test override
    const targets = resolveTargets(concrete as any, registrations, [ALICE], POD);
    expect(targets).toEqual([`${POD}docs/report.ttl`]);
  });

  it("previewApproval surfaces the concrete set for the consent UI", async () => {
    const request = await readAccessRequest(REQUEST, pod.fetch);
    if (!request) throw new Error("missing request");
    const preview = previewApproval(request, {
      registrations,
      knownResources: [ALICE, CAROL],
      storageRoot: POD,
    });
    expect(preview.targets).toEqual([ALICE, CAROL].sort());
    expect(preview.modes).toEqual(["Read"]);
  });
});

describe("approveRequest (happy path)", () => {
  it("runs the full pipeline: snapshot CAS → grant → receipt → ACLs → Approved", async () => {
    const request = await readAccessRequest(REQUEST, pod.fetch);
    if (!request) throw new Error("missing request");
    const c = await ctx();
    const { grantUrl, receiptUrl, snapshot } = await approveRequest(request, c);

    // The request resource carries the final state + the pinned snapshot.
    const after = await readAccessRequest(REQUEST, pod.fetch);
    expect(after?.status).toBe("Approved");
    expect(after?.snapshot?.grantId).toBe(snapshot.grantId);
    expect(after?.snapshot?.targets).toEqual([ALICE, CAROL].sort());

    // Grant record: deterministic IRI, ODRL Agreement + accm fields round-trip.
    expect(grantUrl).toBe(`${GRANTS}grant-${snapshot.grantId}.ttl`);
    const grant = await readGrantRecord(grantUrl, pod.fetch);
    expect(grant?.agent).toBe(REQUESTER);
    expect(grant?.modes).toEqual(["Read"]);
    expect(grant?.targets).toEqual([ALICE, CAROL].sort());
    expect(grant?.requestRef).toBe(REQUEST);
    expect(grant?.purpose).toBe("https://w3id.org/dpv#ServiceProvision");

    // DPV consent receipt.
    const receipt = await readReceipt(receiptUrl, pod.fetch);
    expect(receipt?.status).toBe(DPV.ConsentGiven);
    expect(receipt?.owner).toBe(OWNER);
    expect(receipt?.recipient).toBe(REQUESTER);
    expect(receipt?.purpose).toBe("https://w3id.org/dpv#ServiceProvision");
    expect(receipt?.grantRef).toBe(grantUrl);

    // The WAC actually materialised on both pinned targets.
    for (const target of [ALICE, CAROL]) {
      const effective = await readEffectiveAcl(target, POD, pod.fetch);
      const line = effective.entries.find((e) => e.agents.includes(REQUESTER));
      expect(line?.modes).toEqual(["Read"]);
    }
  });

  it("refuses a non-Pending request", async () => {
    const request = await readAccessRequest(REQUEST, pod.fetch);
    if (!request) throw new Error("missing request");
    await approveRequest(request, await ctx());
    const again = await readAccessRequest(REQUEST, pod.fetch);
    if (!again) throw new Error("missing request");
    await expect(approveRequest(again, await ctx())).rejects.toBeInstanceOf(ApprovalStateError);
  });

  it("refuses a request with no resolvable targets", async () => {
    const request = await readAccessRequest(REQUEST, pod.fetch);
    if (!request) throw new Error("missing request");
    await expect(
      approveRequest(request, await ctx({ registrations: [], knownResources: [] })),
    ).rejects.toBeInstanceOf(ApprovalStateError);
  });

  it("refuses a requester-less request", async () => {
    const request = await readAccessRequest(REQUEST, pod.fetch);
    if (!request) throw new Error("missing request");
    const anon = { ...request, requester: undefined };
    // biome-ignore lint/suspicious/noExplicitAny: narrow test override
    await expect(approveRequest(anon as any, await ctx())).rejects.toBeInstanceOf(
      ApprovalStateError,
    );
  });
});

describe("concurrent approval (the CAS race)", () => {
  it("the second approver from the SAME read loses with ApprovalConflictError and observes the winner", async () => {
    // Both "tabs" read the Pending request at the same ETag.
    const tabA = await readAccessRequest(REQUEST, pod.fetch);
    const tabB = await readAccessRequest(REQUEST, pod.fetch);
    if (!tabA || !tabB) throw new Error("missing request");

    await approveRequest(tabA, await ctx()); // A wins the Pending→Approving CAS

    let loserError: unknown;
    try {
      await approveRequest(tabB, await ctx());
    } catch (e) {
      loserError = e;
    }
    expect(loserError).toBeInstanceOf(ApprovalConflictError);
    // The loser can see the winner's state from the re-read carried on the error.
    expect((loserError as ApprovalConflictError).current?.status).toBe("Approved");

    // NEVER two grants: exactly one grant record exists.
    const grantWrites = pod.log.filter(
      (l) => l.method === "PUT" && l.url.startsWith(GRANTS) && l.url.endsWith(".ttl"),
    );
    const distinctGrantUrls = new Set(grantWrites.map((l) => l.url));
    expect(distinctGrantUrls.size).toBe(1);
  });
});

describe("resume from the STORED snapshot (crash recovery — §3.5)", () => {
  it("completes an orphaned Approving request WITHOUT re-resolving", async () => {
    const request = await readAccessRequest(REQUEST, pod.fetch);
    if (!request) throw new Error("missing request");
    const c = await ctx();

    // Crash injection: the pipeline dies right after the Approving CAS commits
    // (before the grant record write).
    pod.intercept = (method, url) => {
      if (method === "PUT" && url.startsWith(GRANTS)) {
        throw new Error("simulated crash before grant write");
      }
      return undefined;
    };
    await expect(approveRequest(request, c)).rejects.toThrow("simulated crash");
    pod.intercept = undefined;

    // The request is orphaned in Approving with the snapshot persisted.
    const orphaned = await readAccessRequest(REQUEST, pod.fetch);
    expect(orphaned?.status).toBe("Approving");
    expect(orphaned?.snapshot).toBeDefined();
    const pinnedTargets = orphaned?.snapshot?.targets;

    // THE POD CHANGES between crash and recovery: a new contact appears. A
    // re-resolution would now include it — the recovery MUST NOT.
    pod.seed(
      `${POD}contacts/dave.ttl`,
      `<${POD}contacts/dave.ttl#it> a <http://www.w3.org/2006/vcard/ns#Individual> .`,
    );

    const { grantUrl } = await resumeApproval(REQUEST, {
      ...c,
      knownResources: [...c.knownResources, `${POD}contacts/dave.ttl`],
    });

    const after = await readAccessRequest(REQUEST, pod.fetch);
    expect(after?.status).toBe("Approved");
    const grant = await readGrantRecord(grantUrl, pod.fetch);
    // The grant covers EXACTLY the pinned snapshot — dave.ttl is NOT included.
    expect(grant?.targets).toEqual(pinnedTargets);
    expect(grant?.targets).not.toContain(`${POD}contacts/dave.ttl`);
    // And no ACL was written for the post-approval resource.
    expect(pod.has(`${POD}contacts/dave.ttl.acl`)).toBe(false);
  });

  it("re-running the completed pipeline converges (create-only no-ops, same IRIs)", async () => {
    const request = await readAccessRequest(REQUEST, pod.fetch);
    if (!request) throw new Error("missing request");
    const c = await ctx();
    const first = await approveRequest(request, c);
    const again = await resumeApproval(REQUEST, c); // full re-run from snapshot
    expect(again.grantUrl).toBe(first.grantUrl);
    expect(again.receiptUrl).toBe(first.receiptUrl);
    const grant = await readGrantRecord(first.grantUrl, pod.fetch);
    expect(grant?.targets).toEqual([ALICE, CAROL].sort());
  });

  it("refuses to resume a snapshot-less Approving request (cannot be safely completed)", async () => {
    // Hand-craft an Approving request with NO persisted snapshot.
    const url = `${INBOX}broken-approving.ttl`;
    pod.seed(
      url,
      `@prefix accm: <https://w3id.org/jeswr/accm#> . <${url}> accm:status accm:Approving .`,
    );
    await expect(resumeApproval(url, await ctx())).rejects.toBeInstanceOf(ApprovalStateError);
  });

  it("refuses to resume a Pending or Denied request", async () => {
    await expect(resumeApproval(REQUEST, await ctx())).rejects.toBeInstanceOf(ApprovalStateError);
  });
});

describe("denyRequest", () => {
  it("CAS Pending→Denied + a ConsentRefused receipt; no ACL is ever written", async () => {
    const aclWritesBefore = pod.log.filter((l) => l.method === "PUT" && l.url.endsWith(".acl"));
    const request = await readAccessRequest(REQUEST, pod.fetch);
    if (!request) throw new Error("missing request");
    const { receiptUrl } = await denyRequest(request, await ctx());

    const after = await readAccessRequest(REQUEST, pod.fetch);
    expect(after?.status).toBe("Denied");
    const receipt = await readReceipt(receiptUrl, pod.fetch);
    expect(receipt?.status).toBe(DPV.ConsentRefused);
    expect(receipt?.recipient).toBe(REQUESTER);

    const aclWritesAfter = pod.log.filter((l) => l.method === "PUT" && l.url.endsWith(".acl"));
    expect(aclWritesAfter.length).toBe(aclWritesBefore.length); // zero ACL writes
    expect(pod.has(`${ALICE}.acl`)).toBe(false);
  });

  it("a deny that lost the CAS race surfaces the winner's state", async () => {
    const tabA = await readAccessRequest(REQUEST, pod.fetch);
    const tabB = await readAccessRequest(REQUEST, pod.fetch);
    if (!tabA || !tabB) throw new Error("missing request");
    await approveRequest(tabA, await ctx());
    let err: unknown;
    try {
      await denyRequest(tabB, await ctx());
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ApprovalConflictError);
    expect((err as ApprovalConflictError).current?.status).toBe("Approved");
  });

  it("refuses to deny a non-Pending request", async () => {
    const request = await readAccessRequest(REQUEST, pod.fetch);
    if (!request) throw new Error("missing request");
    await denyRequest(request, await ctx());
    const denied = await readAccessRequest(REQUEST, pod.fetch);
    if (!denied) throw new Error("missing request");
    await expect(denyRequest(denied, await ctx())).rejects.toBeInstanceOf(ApprovalStateError);
  });
});

describe("buildGrantRecordTurtle", () => {
  it("carries purpose + expiry constraints into the ODRL Agreement", async () => {
    const turtle = await buildGrantRecordTurtle(
      `${GRANTS}grant-x.ttl`,
      {
        url: REQUEST,
        purpose: "https://w3id.org/dpv#ServiceProvision",
        expiry: "2027-01-01T00:00:00Z",
      },
      { grantId: "x", targets: [ALICE], agent: REQUESTER, modes: ["Read"], schemaVersion: "1" },
      { ownerWebId: OWNER, now: () => new Date("2026-07-02T12:00:00Z") },
    );
    expect(turtle).toContain("Agreement");
    expect(turtle).toContain("ServiceProvision");
    expect(turtle).toContain("2027-01-01");
  });
});
