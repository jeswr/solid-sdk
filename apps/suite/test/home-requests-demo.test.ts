// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY Codex GPT-6.1-Sol
// The demo pod's request fixture runs through the real SDK: list, approve, deny.

import { parseRdf } from "@jeswr/fetch-rdf";
import { decide, listRequests } from "@jeswr/pod-access/requests-solid";
import { describe, expect, it } from "vitest";
import { listInboxRequests } from "../src/apps/home/lib/requests/listing";
import { requestCards, splitRequests } from "../src/apps/home/lib/requests/model";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import { buildDemoSeed, DEMO_ROOT, DEMO_WEBID } from "../src/lib/demo-pod/seed";
import {
  ACTIVITY_CLASS,
  ACTIVITY_DOCUMENT,
  DEMO_REQUEST,
  DEMO_REQUEST_PURPOSE,
  DEMO_REQUESTER,
} from "../src/lib/demo-pod/seed-requests";
import { seedShared } from "../src/lib/demo-pod/seed-shared";

const NOW = Date.UTC(2026, 10, 1, 12);
const DPV = "https://w3id.org/dpv#";
const ACL = "http://www.w3.org/ns/auth/acl#";
const SOLID = "http://www.w3.org/ns/solid/terms#";

async function pod() {
  const demo = createDemoPod({ root: DEMO_ROOT, seed: await buildDemoSeed(NOW), now: () => NOW });
  return { demo, options: { fetch: demo.fetch, webId: DEMO_WEBID, storage: DEMO_ROOT } };
}
/**
 * The same seed hosted at an IP literal, as in shared-inbox.test.ts: the share reader's guarded
 * transport refuses hostnames it cannot DNS-pin outside a browser. The inbox is named, since the
 * seeded profile names the hostname pod's inbox.
 */
const IP_ROOT = "https://8.8.8.8/";
async function ipPod() {
  const demo = createDemoPod({ root: IP_ROOT, seed: await buildDemoSeed(NOW), now: () => NOW });
  return {
    demo,
    options: { fetch: demo.fetch, webId: DEMO_WEBID, storage: IP_ROOT, inbox: `${IP_ROOT}inbox/` },
  };
}
/** The share notifications the demo seed puts in the inbox. */
async function shareIds(root = DEMO_ROOT) {
  return (await seedShared(NOW))
    .filter((file) => file.path.startsWith("inbox/"))
    .map((file) => `${root}${file.path}`)
    .sort();
}
async function graph(fetchFn: typeof fetch, url: string) {
  const response = await fetchFn(url);
  expect(response.status).toBe(200);
  return parseRdf(await response.text(), "text/turtle", { baseIRI: url });
}
function objects(dataset: Awaited<ReturnType<typeof graph>>, predicate: string) {
  return [...dataset].filter((q) => q.predicate.value === predicate).map((q) => q.object.value);
}

describe("demo access request fixture", () => {
  it("lists MaraCoach's pending one-month Activity request", async () => {
    const { options } = await pod();
    const entries = await listRequests(options);
    const [entry, ...rest] = entries.filter((candidate) => candidate.status !== "unreadable");
    expect(rest).toEqual([]);
    expect(entry).toMatchObject({
      id: `${DEMO_ROOT}${DEMO_REQUEST}`,
      status: "pending",
      requester: DEMO_REQUESTER,
      requesterName: "MaraCoach",
      purpose: DEMO_REQUEST_PURPOSE,
      requestedDuration: "P1M",
      dataTypes: [ACTIVITY_CLASS],
      modes: ["read"],
    });
    if (entry?.status === "unreadable" || !entry) throw new Error("unreadable");
    expect(requestCards(entry).map((card) => card.label)).toEqual(["Activity"]);
    // listRequests reports every other inbox member as unreadable: here, exactly the seeded shares.
    expect(
      entries
        .filter((candidate) => candidate.status === "unreadable")
        .map((candidate) => candidate.id)
        .sort(),
    ).toEqual(await shareIds());
  });

  it("Home lists the request alone: the seeded share notifications are not unreadable", async () => {
    const { options } = await ipPod();
    const { entries, shares } = await listInboxRequests(options);
    expect([...shares].sort()).toEqual(await shareIds(IP_ROOT));
    const lists = splitRequests(entries, new Date(NOW), new Set(), shares);
    expect(lists.pending).toHaveLength(1);
    expect(lists.pending[0]).toMatchObject({
      id: `${IP_ROOT}${DEMO_REQUEST}`,
      requesterName: "MaraCoach",
      dataTypes: [ACTIVITY_CLASS],
    });
    expect(lists.decided).toEqual([]);
    expect(lists.unreadable).toEqual([]);
  });

  it("Home still counts a genuinely malformed inbox item as unreadable", async () => {
    const { demo, options } = await ipPod();
    const broken = `${IP_ROOT}inbox/broken.ttl`;
    const put = await demo.fetch(broken, {
      method: "PUT",
      headers: { "content-type": "text/turtle" },
      body: "this is not turtle",
    });
    expect(put.ok).toBe(true);
    const { entries, shares } = await listInboxRequests(options);
    expect([...shares].sort()).toEqual(await shareIds(IP_ROOT));
    const lists = splitRequests(entries, new Date(NOW), new Set(), shares);
    expect(lists.unreadable).toEqual([{ id: broken, status: "unreadable" }]);
    expect(lists.pending.map((request) => request.id)).toEqual([`${IP_ROOT}${DEMO_REQUEST}`]);
  });

  it("registers Activity as its one document, never the whole health/ folder", async () => {
    const { demo } = await pod();
    const indexUrl = `${DEMO_ROOT}settings/privateTypeIndex.ttl`;
    const index = await graph(demo.fetch, indexUrl);
    const registration = [...index].find(
      (q) => q.predicate.value === `${SOLID}forClass` && q.object.value === ACTIVITY_CLASS,
    )?.subject;
    const of = (predicate: string) =>
      [...index]
        .filter((q) => q.subject.equals(registration) && q.predicate.value === predicate)
        .map((q) => q.object.value);
    expect(of(`${SOLID}instance`)).toEqual([`${DEMO_ROOT}${ACTIVITY_DOCUMENT}`]);
    expect(of(`${SOLID}instanceContainer`)).toEqual([]);
  });

  it("approves with an expiry receipt and a Viewer grant on the registered Activity data", async () => {
    const { demo, options } = await pod();
    // Other Health data beside Activity, as the Health app keeps it.
    const vitals = await demo.fetch(`${DEMO_ROOT}health/vitals.ttl`, {
      method: "PUT",
      headers: { "content-type": "text/turtle" },
      body: "<#it> a <https://jeswr.org/ns/sectors/health#VitalSign> .",
    });
    expect(vitals.ok).toBe(true);
    const [entry] = await listRequests(options);
    if (!entry || entry.status === "unreadable") throw new Error("unreadable");
    const expiresAt = new Date(Date.UTC(2026, 11, 1, 12));
    const result = await decide(
      entry,
      { approve: true, dataTypes: entry.dataTypes, expiresAt },
      { ...options, now: () => new Date(NOW) },
    );
    expect(result).toMatchObject({ status: "approved", notified: false, expiryEnforced: false });
    const receipt = await graph(demo.fetch, result.receiptUrl);
    expect(objects(receipt, `${DPV}hasExpiryTime`)).toEqual([expiresAt.toISOString()]);
    expect(objects(receipt, `${DPV}hasRecipient`)).toEqual([DEMO_REQUESTER]);
    const acl = await graph(demo.fetch, `${DEMO_ROOT}health/activity.ttl.acl`);
    expect(objects(acl, `${ACL}agent`)).toContain(DEMO_REQUESTER);
    // Other Health data stays private: neither the folder nor its other documents name the requester.
    const folder = await graph(demo.fetch, `${DEMO_ROOT}health/.acl`);
    expect(objects(folder, `${ACL}agent`)).not.toContain(DEMO_REQUESTER);
    expect((await demo.fetch(`${DEMO_ROOT}health/vitals.ttl.acl`)).status).toBe(404);
    const [after] = await listRequests(options);
    expect(after).toMatchObject({ status: "approved", decidedAt: new Date(NOW).toISOString() });
  });

  it("denies without granting anything", async () => {
    const { demo, options } = await pod();
    const activityAcl = `${DEMO_ROOT}health/activity.ttl.acl`;
    const before = await (await demo.fetch(activityAcl)).text();
    const [entry] = await listRequests(options);
    if (!entry || entry.status === "unreadable") throw new Error("unreadable");
    expect(await decide(entry, { approve: false }, options)).toMatchObject({ status: "denied" });
    expect(await (await demo.fetch(activityAcl)).text()).toBe(before);
    expect(objects(await graph(demo.fetch, activityAcl), `${ACL}agent`)).not.toContain(
      DEMO_REQUESTER,
    );
    expect((await listRequests(options))[0]).toMatchObject({ status: "denied" });
  });
});
