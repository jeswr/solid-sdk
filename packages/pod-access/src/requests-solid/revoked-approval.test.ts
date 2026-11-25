// AUTHORED-BY Claude Sonnet 5.5
// A half-applied approval that was revoked must never be finished: finishing re-applies the
// pinned snapshot to every target.
import { describe, expect, it } from "vitest";
import { buildPod, OWNER, POD, REQUEST } from "../../test/requests/fixtures.js";
import { ApprovalRevokedError } from "./errors.js";
import { ACCM, DPV, decide } from "./index.js";

const opts = (pod: ReturnType<typeof buildPod>) => ({
  fetch: pod.fetch,
  webId: OWNER,
  storage: POD,
});
const ACLS = [`${POD}contacts/alice.ttl.acl`, `${POD}contacts/carol.ttl.acl`];
const aclWrites = (pod: ReturnType<typeof buildPod>, from = 0) =>
  pod.log.slice(from).filter(({ method, url }) => method === "PUT" && ACLS.includes(url));

/** Crash on the first target's ACL write, after the grant and receipt exist. */
async function halfApplied() {
  const pod = buildPod();
  const decision = { approve: true, role: "viewer" as const };
  pod.intercept = (method, url) => {
    if (method === "PUT" && ACLS.includes(url)) throw new Error("crash");
  };
  await expect(decide({ id: REQUEST }, decision, opts(pod))).rejects.toThrow("crash");
  pod.intercept = undefined;
  const put = (marker: string) =>
    pod.log.find(({ method, url }) => method === "PUT" && url.includes(marker))?.url as string;
  return { pod, decision, grant: put("/grant-"), receipt: put("/receipt-") };
}

describe("a revoked approval is not finished", () => {
  it("refuses to resume when the grant record carries revokedAt, and writes no access", async () => {
    const { pod, decision, grant } = await halfApplied();
    pod.seed(
      grant,
      `${pod.body(grant)}\n<${grant}> <${ACCM.revokedAt}> "2026-11-12T10:00:00Z"^^<http://www.w3.org/2001/XMLSchema#dateTime> .\n`,
    );
    const before = pod.log.length;
    await expect(decide({ id: REQUEST }, decision, opts(pod))).rejects.toBeInstanceOf(
      ApprovalRevokedError,
    );
    expect(aclWrites(pod, before)).toEqual([]);
  });

  it("refuses to resume when only the receipt says the consent was withdrawn", async () => {
    const { pod, decision, receipt } = await halfApplied();
    pod.seed(
      receipt,
      `${pod.body(receipt)}\n<${receipt}> <${DPV.hasConsentStatus}> <${DPV.ConsentWithdrawn}> .\n`,
    );
    const before = pod.log.length;
    await expect(decide({ id: REQUEST }, decision, opts(pod))).rejects.toBeInstanceOf(
      ApprovalRevokedError,
    );
    expect(aclWrites(pod, before)).toEqual([]);
  });

  it("stops between targets when a revoke lands mid-way", async () => {
    const { pod, decision, grant } = await halfApplied();
    const revoke = `\n<${grant}> <${ACCM.revokedAt}> "2026-11-12T10:00:00Z"^^<http://www.w3.org/2001/XMLSchema#dateTime> .\n`;
    const before = pod.log.length;
    pod.intercept = (method, url) => {
      // The revoke is written as the first target's ACL is being written.
      if (method === "PUT" && url === ACLS[0]) {
        pod.intercept = undefined;
        pod.seed(grant, pod.body(grant) + revoke);
      }
      return undefined;
    };
    await expect(decide({ id: REQUEST }, decision, opts(pod))).rejects.toBeInstanceOf(
      ApprovalRevokedError,
    );
    expect(aclWrites(pod, before).map(({ url }) => url)).toEqual([ACLS[0]]);
  });

  it("still finishes an approval that was never revoked", async () => {
    const { pod, decision } = await halfApplied();
    expect((await decide({ id: REQUEST }, decision, opts(pod))).status).toBe("approved");
    expect(aclWrites(pod).length).toBeGreaterThan(0);
  });

  it("lets a revoked, half-applied approval be denied, writing no access", async () => {
    const { pod, grant } = await halfApplied();
    pod.seed(
      grant,
      `${pod.body(grant)}\n<${grant}> <${ACCM.revokedAt}> "2026-11-12T10:00:00Z"^^<http://www.w3.org/2001/XMLSchema#dateTime> .\n`,
    );
    const before = pod.log.length;
    expect((await decide({ id: REQUEST }, { approve: false }, opts(pod))).status).toBe("denied");
    expect(aclWrites(pod, before)).toEqual([]);
    // Settled: a second denial is the same denial, and it can no longer be approved.
    expect((await decide({ id: REQUEST }, { approve: false }, opts(pod))).status).toBe("denied");
    await expect(
      decide({ id: REQUEST }, { approve: true, role: "viewer" }, opts(pod)),
    ).rejects.toThrow("Cannot approve a denial");
  });

  it("still refuses to deny an approval that was never revoked", async () => {
    const { pod } = await halfApplied();
    const before = pod.log.length;
    await expect(decide({ id: REQUEST }, { approve: false }, opts(pod))).rejects.toThrow(
      "Cannot deny an approval",
    );
    expect(aclWrites(pod, before)).toEqual([]);
  });

  it("still refuses to deny a finished approval", async () => {
    const { pod, decision } = await halfApplied();
    await decide({ id: REQUEST }, decision, opts(pod));
    await expect(decide({ id: REQUEST }, { approve: false }, opts(pod))).rejects.toThrow(
      "Cannot deny an approval",
    );
  });
});
