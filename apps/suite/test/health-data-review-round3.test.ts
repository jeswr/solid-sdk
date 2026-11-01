// AUTHORED-BY Codex GPT-6
import { DataFactory } from "n3";
import { expect, it } from "vitest";
import { sampleGpx } from "../src/apps/health/demo/sample";
import { writeSamples } from "../src/apps/health/lib/data/import";
import { addMeasurement, loadMetric } from "../src/apps/health/lib/data/metrics";
import {
  type ClinicalRecord,
  loadRecords,
  nextDose,
  type RecordDraft,
  saveRecord,
} from "../src/apps/health/lib/data/records";
import { createHealthDataStore, healthTransport } from "../src/apps/health/lib/data/store";
import { importGpx, PartialGpxImportError } from "../src/apps/health/lib/data/workouts";
import { RecordDetails } from "../src/apps/health/lib/model";
import { createDemoPod } from "../src/lib/demo-pod/pod";

const ROOT = "https://retry.health.test/";
const OWNER = `${ROOT}profile#me`;
const NOW = new Date("2026-11-01T12:00:00Z");
const RANGE = { start: new Date("2026-11-01Z"), end: new Date("2026-12-01Z") };
const DRAFT: RecordDraft = {
  name: "Example medication",
  dose: "As prescribed",
  note: "",
  date: "2026-11-01",
  time: "08:00",
  timeZone: "UTC",
  frequency: "daily",
};

it.each([
  false,
  true,
])("retries a committed measurement with a lost response (existing shard: %s) without adding steps", async (existing) => {
  const pod = createDemoPod({ root: ROOT });
  let lose = false;
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const response = await pod.fetch(input, init);
    if (lose && init?.method === "PUT" && String(input).endsWith("2026-11.ttl")) {
      lose = false;
      throw new Error("Response lost after commit");
    }
    return response;
  };
  const store = createHealthDataStore(fetch, ROOT, OWNER);
  if (existing) await addMeasurement(store, "earlier", "weight", 70, "kg", NOW);
  lose = true;
  const save = () => addMeasurement(store, "stable-draft", "steps", 1000, "1", NOW);
  await expect(save()).rejects.toThrow("Response lost");
  await save();
  const metric = await loadMetric(store, "steps", RANGE);
  expect(metric.entries).toHaveLength(1);
  expect(metric.buckets[0]?.value).toBe(1000);
});

it.each([
  "route.gpx",
  "index.ttl",
])("recovers a lost GPX %s response with the same import ID", async (file) => {
  const pod = createDemoPod({ root: ROOT });
  let lose = true;
  const store = createHealthDataStore(
    async (input, init) => {
      const response = await pod.fetch(input, init);
      if (lose && init?.method === "PUT" && String(input).endsWith(`/${file}`)) {
        lose = false;
        throw new Error("Response lost after commit");
      }
      return response;
    },
    ROOT,
    OWNER,
  );
  const save = () => importGpx(store, "stable-import", sampleGpx(NOW));
  await expect(save()).rejects.toThrow(
    file === "index.ttl" ? PartialGpxImportError : "Response lost",
  );
  await save();
  await save();
  expect(await store.loadWorkouts()).toHaveLength(1);
  expect(pod.snapshot().resources.filter(([url]) => url.endsWith("/route.gpx"))).toHaveLength(1);
});

it("confirms equivalent RDF while rejecting changed or extended GPX indexes", async () => {
  const pod = createDemoPod({ root: ROOT });
  const store = createHealthDataStore(pod.fetch, ROOT, OWNER);
  const xml = sampleGpx(NOW);
  await importGpx(store, "same", xml);
  const path = "workouts/same/index.ttl";
  const original = await store.read(path);
  // This representation differs in whitespace and comments, not meaning.
  const response = await pod.fetch(`${store.base}${path}`);
  const body = await response.text();
  await pod.fetch(`${store.base}${path}`, {
    method: "PUT",
    headers: { "content-type": "text/turtle" },
    body: `# reordered representation\n${body}`,
  });
  await importGpx(store, "same", xml);
  const fields = new RecordDetails(`${store.base}${path}#it`, original.document, DataFactory);
  fields.name = "Changed elsewhere";
  let saved = await store.read(path);
  await store.write(path, original.document, { etag: saved.etag as string });
  await expect(importGpx(store, "same", xml)).rejects.toMatchObject({ cause: { status: 412 } });
  fields.name = undefined;
  fields.note = "An extra statement";
  saved = await store.read(path);
  await store.write(path, original.document, { etag: saved.etag as string });
  await expect(importGpx(store, "same", xml)).rejects.toMatchObject({ cause: { status: 412 } });
  await expect(importGpx(store, "same", xml.replace('lat="51.', 'lat="52.'))).rejects.toMatchObject(
    { status: 412 },
  );
});

it("confirms a create-only record after response loss and preserves a different existing record", async () => {
  const pod = createDemoPod({ root: ROOT });
  let lose = true;
  const store = createHealthDataStore(
    async (input, init) => {
      const response = await pod.fetch(input, init);
      if (lose && init?.method === "PUT" && String(input).endsWith("stable.ttl")) {
        lose = false;
        throw new Error("Response lost");
      }
      return response;
    },
    ROOT,
    OWNER,
  );
  const save = (draft = DRAFT) =>
    saveRecord(store, OWNER, "medications", "stable", draft, { create: true }, NOW);
  await expect(save()).rejects.toThrow("Response lost");
  await save();
  await expect(save({ ...DRAFT, name: "Different draft" })).rejects.toMatchObject({ status: 412 });
  expect((await loadRecords(store, "medications")).map((record) => record.name)).toEqual([
    DRAFT.name,
  ]);
});

it("keeps a create conflict when confirmation cannot read the existing resource", async () => {
  const pod = createDemoPod({ root: ROOT });
  const store = createHealthDataStore(pod.fetch, ROOT, OWNER);
  await importGpx(store, "unreadable", sampleGpx(NOW));
  const retry = createHealthDataStore(
    async (input, init) => {
      if (!init?.method && String(input).endsWith("/index.ttl"))
        return new Response(null, { status: 403 });
      return pod.fetch(input, init);
    },
    ROOT,
    OWNER,
  );
  await expect(importGpx(retry, "unreadable", sampleGpx(NOW))).rejects.toMatchObject({
    cause: { status: 412 },
  });
});

it("does not confirm updates, missing bodies or container creates as document creates", async () => {
  const fetch: typeof globalThis.fetch = async () => new Response(null, { status: 412 });
  const transport = healthTransport(fetch);
  for (const init of [
    undefined,
    { method: "PUT", headers: { "if-match": '"old"' }, body: "data" },
    { method: "PUT", headers: { "if-none-match": "*" } },
    { method: "PUT", headers: { "if-none-match": "*" }, body: "data" },
  ])
    expect((await transport(`${ROOT}health/`, init)).status).toBe(412);
});

it("retries private ACL creation after its response is lost", async () => {
  const pod = createDemoPod({ root: ROOT });
  let lose = true;
  const store = createHealthDataStore(
    async (input, init) => {
      const response = await pod.fetch(input, init);
      if (lose && init?.method === "PUT" && String(input).endsWith("health/.acl")) {
        lose = false;
        throw new Error("ACL response lost");
      }
      return response;
    },
    ROOT,
    OWNER,
  );
  await expect(store.initialize()).rejects.toThrow("ACL response lost");
  await store.initialize();
  await writeSamples(store, [], OWNER, () => {});
});

it.each([
  "daily",
  "weekly",
] as const)("finds future %s schedules from their local start date", async (frequency) => {
  const pod = createDemoPod({ root: ROOT });
  const store = createHealthDataStore(pod.fetch, ROOT, OWNER);
  await saveRecord(
    store,
    OWNER,
    "medications",
    "future",
    {
      ...DRAFT,
      date: "2026-11-20",
      time: "09:00",
      timeZone: "Pacific/Auckland",
      frequency,
    },
    { create: true },
    NOW,
  );
  const record = (await loadRecords(store, "medications"))[0] as ClinicalRecord;
  expect(nextDose(record, NOW)?.toISOString()).toBe("2026-11-19T20:00:00.000Z");
  expect(nextDose(record, new Date("2026-11-19T20:00:00Z"))?.toISOString()).toBe(
    "2026-11-19T20:00:00.000Z",
  );
  expect(nextDose(record, new Date("2026-11-19T20:00:01Z"))?.toISOString()).toBe(
    frequency === "daily" ? "2026-11-20T20:00:00.000Z" : "2026-11-26T20:00:00.000Z",
  );
});
