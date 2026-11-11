// AUTHORED-BY Codex GPT-6.1-Sol
import { fetchRdf, parseRdf } from "@jeswr/fetch-rdf";
import { NS } from "@jeswr/suite-vocab";
import { AclResource, Authorization } from "@solid/object";
import { DataFactory, Store, Writer } from "n3";
import { expect, it } from "vitest";
import { createHealthStore } from "../src/apps/health/lib/model";
import { migrateDemoHealthPrivacy } from "../src/lib/demo-pod/migrate-health";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import { buildDemoSeed, DEMO_ROOT, DEMO_WEBID } from "../src/lib/demo-pod/seed";
import { legacyDemoHealthPod } from "./demo-health-fixture";

const NOW = Date.UTC(2026, 10, 1, 12);
const RANGE = { start: new Date("2026-11-01Z"), end: new Date("2026-12-01Z") };

it("satisfies the unmodified Health privacy check and retains a measurement across snapshots", async () => {
  const pod = createDemoPod({ root: DEMO_ROOT, seed: await buildDemoSeed(NOW) });
  // Use the real model directly, without the Health demo transport's metadata fallback.
  const store = createHealthStore(pod.fetch, DEMO_ROOT, DEMO_WEBID);
  await store.initialize();
  for (const path of [
    "",
    "observations/",
    "records/",
    "conditions/",
    "medications/",
    "immunisations/",
    "workouts/",
  ]) {
    const url = `${store.base}${path}`;
    const { dataset } = await fetchRdf(`${url}.acl`, { fetch: pod.fetch });
    const rules = [...new AclResource(dataset, DataFactory).authorizations];
    expect(rules).toHaveLength(1);
    const rule = rules[0];
    expect(rule?.accessTo).toBe(url);
    expect(rule?.default).toBe(url);
    expect([...(rule?.agent ?? [])]).toEqual([DEMO_WEBID]);
    expect(rule?.agentClass.size).toBe(0);
    expect(rule?.agentGroup).toBeUndefined();
    expect(rule?.origin.size).toBe(0);
    expect(rule?.canRead && rule.canWrite && rule.canReadWriteAcl).toBe(true);
  }
  await store.addObservation("demo-weight", {
    kind: "weight",
    value: 76.3,
    at: new Date(NOW),
    source: "Manual entry",
  });
  const restored = createDemoPod({ root: DEMO_ROOT, snapshot: pod.snapshot() });
  const reopened = createHealthStore(restored.fetch, DEMO_ROOT, DEMO_WEBID);
  await reopened.initialize();
  expect(await reopened.metric("weight", RANGE)).toMatchObject([
    { value: 76.3, at: new Date(NOW) },
  ]);
});

it("advertises ACLs while creating private Health containers and before creating records", async () => {
  const pod = createDemoPod({ root: DEMO_ROOT });
  const store = createHealthStore(pod.fetch, DEMO_ROOT, DEMO_WEBID);
  await store.addObservation("first", {
    kind: "weight",
    value: 71,
    at: new Date(NOW),
    source: "Manual entry",
  });
  expect(await store.metric("weight", RANGE)).toMatchObject([{ value: 71 }]);
});

it("keeps the shared Activity fixture separate from private measurements", async () => {
  const pod = createDemoPod({ root: DEMO_ROOT, seed: await buildDemoSeed(NOW) });
  const store = createHealthStore(pod.fetch, DEMO_ROOT, DEMO_WEBID);
  await store.initialize();
  const activity = await pod.fetch(`${store.base}activity.ttl`);
  const original = await activity.text();
  const { document } = await store.read("activity.ttl");
  await expect(
    store.write("activity.ttl", document, { etag: activity.headers.get("etag") as string }),
  ).rejects.toThrow("Resource is not owner-private");
  expect(await (await pod.fetch(`${store.base}activity.ttl`)).text()).toBe(original);
});

it("repairs the exact legacy demo policy without resetting content", async () => {
  const pod = await legacyDemoHealthPod(NOW);
  const store = createHealthStore(pod.fetch, DEMO_ROOT, DEMO_WEBID);
  await expect(store.initialize()).rejects.toThrow("Resource is not owner-private");
  await pod.fetch(`${DEMO_ROOT}drive/my-note.txt`, { method: "PUT", body: "Keep my demo edits" });
  expect(await migrateDemoHealthPrivacy(pod)).toBe(true);
  await store.initialize();
  expect(await (await pod.fetch(`${DEMO_ROOT}drive/my-note.txt`)).text()).toBe(
    "Keep my demo edits",
  );
  const { dataset } = await fetchRdf(`${store.base}activity.ttl.acl`, { fetch: pod.fetch });
  const rules = [...new AclResource(dataset, DataFactory).authorizations];
  expect(rules).toHaveLength(2);
  const app = rules.find((rule) => rule.origin.size > 0);
  expect([...(app?.origin ?? [])]).toEqual(["https://maracoach.example"]);
  expect(app?.accessTo).toBe(`${store.base}activity.ttl`);
  expect(app?.default).toBeUndefined();
  const snapshot = pod.snapshot();
  expect(await migrateDemoHealthPrivacy(pod)).toBe(false);
  expect(pod.snapshot()).toEqual(snapshot);
});

it.each([
  false,
  true,
])("preserves an edited %s policy instead of overwriting it", async (activity) => {
  const pod = await legacyDemoHealthPod(NOW);
  const url = `${DEMO_ROOT}health/${activity ? "activity.ttl.acl" : ".acl"}`;
  const dataset = activity
    ? new Store()
    : (await fetchRdf(`${DEMO_ROOT}health/.acl`, { fetch: pod.fetch })).dataset;
  // Change the origin in place, retaining the legacy graph's size so recognition
  // has to compare its content. Neither a folder edit nor a document collision is migrated.
  const app = new Authorization(`${url}#maracoach`, dataset, DataFactory);
  app.type.add(`${NS.ACL}Authorization`);
  app.accessTo = activity ? `${DEMO_ROOT}health/activity.ttl` : `${DEMO_ROOT}health/`;
  app.canRead = true;
  app.canWrite = true;
  app.origin.clear();
  app.origin.add("https://other-coach.example");
  const writer = new Writer({ format: "text/turtle" });
  writer.addQuads([...dataset]);
  const body = await new Promise<string>((resolve, reject) =>
    writer.end((error, result) => (error ? reject(error) : resolve(result))),
  );
  await pod.fetch(url, { method: "PUT", headers: { "content-type": "text/turtle" }, body });
  const snapshot = pod.snapshot();
  expect(await migrateDemoHealthPrivacy(pod)).toBe(false);
  expect(pod.snapshot()).toEqual(snapshot);
  await expect(createHealthStore(pod.fetch, DEMO_ROOT, DEMO_WEBID).initialize()).rejects.toThrow(
    "Resource is not owner-private",
  );
});

it("does not migrate a foreign pod or a pod without the fixture policy", async () => {
  expect(await migrateDemoHealthPrivacy(createDemoPod({ root: "https://pod.example/" }))).toBe(
    false,
  );
  expect(await migrateDemoHealthPrivacy(createDemoPod({ root: DEMO_ROOT }))).toBe(false);
});

it("preserves previously approved document grants while narrowing the legacy fixture", async () => {
  const pod = await legacyDemoHealthPod(NOW);
  const url = `${DEMO_ROOT}health/activity.ttl.acl`;
  const file = (await buildDemoSeed(NOW)).find((entry) => entry.path === "health/activity.ttl.acl");
  if (!file) throw new Error("Missing Activity fixture");
  const dataset = await parseRdf(String(file.body), "text/turtle", { baseIRI: url });
  const approved = new Authorization(`${url}#approved`, dataset, DataFactory);
  approved.type.add(`${NS.ACL}Authorization`);
  approved.agent.add("https://coach.demo.pod/profile/card#me");
  approved.accessTo = `${DEMO_ROOT}health/activity.ttl`;
  approved.canRead = true;
  const writer = new Writer({ format: "text/turtle" });
  writer.addQuads([...dataset]);
  const body = await new Promise<string>((resolve, reject) =>
    writer.end((error, result) => (error ? reject(error) : resolve(result))),
  );
  await pod.fetch(url, { method: "PUT", headers: { "content-type": "text/turtle" }, body });
  expect(await migrateDemoHealthPrivacy(pod)).toBe(true);
  const after = (await fetchRdf(url, { fetch: pod.fetch })).dataset;
  expect(after.size).toBe(dataset.size);
  expect([...dataset].every((quad) => after.has(quad))).toBe(true);
  await createHealthStore(pod.fetch, DEMO_ROOT, DEMO_WEBID).initialize();
});

it.each([
  ".acl",
  "activity.ttl.acl",
])("leaves unreadable %s unchanged for Health to reject", async (path) => {
  const pod = await legacyDemoHealthPod(NOW);
  await pod.fetch(`${DEMO_ROOT}health/${path}`, {
    method: "PUT",
    headers: { "content-type": "text/turtle" },
    body: "malformed Turtle",
  });
  const snapshot = pod.snapshot();
  expect(await migrateDemoHealthPrivacy(pod)).toBe(false);
  expect(pod.snapshot()).toEqual(snapshot);
  await expect(createHealthStore(pod.fetch, DEMO_ROOT, DEMO_WEBID).initialize()).rejects.toThrow();
});
