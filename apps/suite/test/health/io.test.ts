// AUTHORED-BY Codex GPT-6.1-Sol
import { LEGACY_NAMESPACES, NS } from "@jeswr/suite-vocab";
import { AclResource } from "@solid/object";
import { DataFactory } from "n3";
import { assert, expect, it } from "vitest";
import {
  createHealthStore,
  emptyHealthDocument,
  HealthIoError,
  parseHealth,
} from "../../src/apps/health/lib/model/io.js";
import { toTurtle } from "../../src/apps/health/lib/model/serialise.js";
import { SAMPLE_GPX } from "./fixtures.js";
import { BASE, OWNER, podFixture } from "./pod-fixture.js";

const make = () => {
  const pod = podFixture();
  return { ...pod, store: createHealthStore(pod.fetch, "https://pod.example/storage/", OWNER) };
};
const input = { kind: "steps" as const, at: new Date("2025-01-01Z"), value: 100, source: "Watch" };
const range = { start: new Date("2024-12-01Z"), end: new Date("2025-03-01Z") };
it("creates and verifies owner-private ACLs and inherited defaults on every container", async () => {
  const { store, resources, calls } = make();
  await store.initialize();
  expect([...resources.keys()].filter((url) => url.endsWith("/"))).toHaveLength(7);
  for (const [url, resource] of resources) {
    if (!url.endsWith(".acl")) continue;
    const parsed = await parseHealth(resource.body, url);
    const rules = [...new AclResource(parsed, DataFactory).authorizations];
    expect(rules).toHaveLength(1);
    const rule = rules[0];
    assert(rule);
    expect([...rule.agent]).toEqual([OWNER]);
    expect(rule.agentClass.size).toBe(0);
    expect(rule.accessTo).toBe(url.slice(0, -4));
    expect(rule.default).toBe(rule.accessTo);
    expect(rule.canRead && rule.canWrite && rule.canReadWriteAcl).toBe(true);
  }
  const aclPuts = calls.filter((call) => call.method === "PUT" && call.url.endsWith(".acl")).length;
  await store.initialize();
  expect(calls.filter((call) => call.method === "PUT" && call.url.endsWith(".acl"))).toHaveLength(
    aclPuts,
  );
});
it("creates monthly shards, appends conditionally, preserves samples, and reads a sparse range", async () => {
  const { store, resources, calls } = make();
  const first = await store.addObservation("one", input);
  const second = await store.addObservation("two", {
    ...input,
    at: new Date("2025-02-01Z"),
    value: 200,
  });
  await store.addObservation("three", { ...input, value: 300 });
  expect(first).toBe(`${BASE}observations/2025-01.ttl#one`);
  const jan = await store.read("observations/2025-01.ttl");
  expect([...jan.document.observations]).toHaveLength(2);
  expect(jan.document.observation(first).patient).toBe(OWNER);
  expect(await store.metric("steps", range)).toMatchObject([
    { iri: first, value: 100 },
    { value: 300 },
    { iri: second, value: 200 },
  ]);
  const writes = calls.filter((call) => call.method === "PUT" && call.url.endsWith("2025-01.ttl"));
  expect(writes[0]?.headers.get("if-none-match")).toBe("*");
  expect(writes[1]?.headers.get("if-match")).toMatch(/^"/);
  expect(resources.get(`${BASE}observations/2025-02.ttl`)?.body).toContain("StepCountObservation");
});
it("creates, lists and updates records and their reminders with validators", async () => {
  const { store, resources } = make();
  const record = {
    kind: "medications" as const,
    name: "Medication",
    patient: OWNER,
    reference: "https://snomed.info/id/1",
    reminders: [{ iri: `${BASE}medications/drug.ttl#reminder`, at: new Date("2025-01-01Z") }],
  };
  const iri = await store.saveRecord("drug", record, { create: true });
  expect(iri).toBe(`${BASE}medications/drug.ttl#it`);
  expect((await store.loadRecords("medications"))[0]?.reminders.size).toBe(1);
  const etag = resources.get(`${BASE}medications/drug.ttl`)?.etag;
  assert(etag);
  await store.saveRecord("drug", { ...record, name: "Updated", reminders: [] }, { etag });
  expect((await store.loadRecords("medications"))[0]?.name).toBe("Updated");
  expect((await store.loadRecords("medications"))[0]?.reminders.size).toBe(0);
  await expect(store.saveRecord("drug", record, { etag })).rejects.toMatchObject({ status: 412 });
});
it("persists GPX plus typed index and reads legacy connector files alongside workout directories", async () => {
  const { store, resources, put } = make();
  const workout = await store.importGpx("run", SAMPLE_GPX);
  expect(workout.patient).toBe(OWNER);
  expect(resources.get(`${BASE}workouts/run/route.gpx`)).toMatchObject({
    body: SAMPLE_GPX,
    type: "application/gpx+xml",
  });
  put(
    "workouts/legacy.ttl",
    `@prefix s: <${NS.SCHEMA}>. <#it> a s:ExerciseAction; s:name "Legacy ride".`,
  );
  const entries = await store.loadWorkouts();
  expect(entries).toHaveLength(2);
  expect(entries.find((entry) => entry.activity === "Run")).toMatchObject({
    gpx: `${BASE}workouts/run/route.gpx`,
    source: "GPX",
  });
  expect(entries.some((entry) => entry.name === "Legacy ride")).toBe(true);
  await expect(store.importGpx("run", SAMPLE_GPX)).rejects.toMatchObject({ status: 412 });
});
it.each(
  Object.entries(LEGACY_NAMESPACES).filter(([, canonical]) => canonical === NS.HEALTH),
)("migrates legacy namespace %s once, preserving identities/literals and foreign data", async (legacy) => {
  const { store, put, resources, calls } = make();
  put(
    "record.ttl",
    `<#record> a <${legacy}HealthRecord>; <${NS.CORE}subject> <${OWNER}>.
    <#obs> a <${legacy}Observation>; <${legacy}value> 72.
    <#obs> <https://example.org/note> "${legacy}Observation".
    <#foreign> <https://example.org/p> <https://example.org/o>.`,
  );
  expect(await store.migrate("record.ttl")).toBe(true);
  const result = await store.read("record.ttl");
  expect([...result.document.observations][0]?.measuredValue).toBe(72);
  const body = resources.get(`${BASE}record.ttl`)?.body;
  expect(body).toContain(`"${legacy}Observation"`);
  expect(body).toContain("https://example.org/");
  expect(await store.migrate("record.ttl")).toBe(false);
  expect(calls.filter((call) => call.method === "PUT")).toHaveLength(1);
});
it("migrates predicate-only aliases and leaves canonical / arbitrary non-type objects alone", async () => {
  const { store, put } = make();
  const legacy = Object.keys(LEGACY_NAMESPACES).find((key) => LEGACY_NAMESPACES[key] === NS.CORE);
  assert(legacy);
  put("record.ttl", `<#r> <${legacy}subject> <${OWNER}>.`);
  expect(await store.migrate("record.ttl")).toBe(true);
  put("foreign.ttl", `<#r> <${NS.DCT}source> <${legacy}Person>; <${NS.DCT}title> "sample".`);
  expect(await store.migrate("foreign.ttl")).toBe(false);
});
it("never writes unconditionally or swallows permission, parse, transport or conflict errors", async () => {
  const { store, put, faults, calls } = make();
  for (const etag of ["", 'W/"1"'])
    await expect(store.write("any.ttl", emptyHealthDocument(), { etag })).rejects.toThrow(
      "strong ETag",
    );
  put("observations/2025-01.ttl", "");
  faults.set(
    `GET ${BASE}observations/2025-01.ttl`,
    () => new Response("", { headers: { "content-type": "text/turtle" } }),
  );
  await expect(store.addObservation("x", input)).rejects.toThrow("strong ETag");
  faults.set(
    `GET ${BASE}record.ttl`,
    () => new Response(`<#x> <${NS.CORE}value> 1.`, { headers: { "content-type": "text/turtle" } }),
  );
  const legacy = Object.keys(LEGACY_NAMESPACES).find((key) => LEGACY_NAMESPACES[key] === NS.CORE);
  assert(legacy);
  faults.set(
    `GET ${BASE}record.ttl`,
    () => new Response(`<#x> <${legacy}value> 1.`, { headers: { "content-type": "text/turtle" } }),
  );
  await expect(store.migrate("record.ttl")).rejects.toThrow("strong ETag");
  expect(calls.filter((call) => call.method === "PUT")).toHaveLength(0);
  for (const operation of [
    () => store.addObservation("x", input),
    () => store.metric("steps", range),
  ]) {
    faults.set(`GET ${BASE}observations/2025-01.ttl`, () => new Response(null, { status: 403 }));
    await expect(operation()).rejects.toMatchObject({ status: 403 });
  }
  faults.set(`GET ${BASE}medications/`, () => new Response(null, { status: 401 }));
  await expect(store.loadRecords("medications")).rejects.toMatchObject({ status: 401 });
  faults.set(
    `GET ${BASE}broken.ttl`,
    () => new Response("not turtle", { headers: { "content-type": "text/turtle" } }),
  );
  await expect(store.read("broken.ttl")).rejects.toThrow();
  faults.set(`GET ${BASE}offline.ttl`, () => {
    throw new Error("offline");
  });
  await expect(store.read("offline.ttl")).rejects.toThrow();
  faults.set(`PUT ${BASE}conflict.ttl`, () => new Response(null, { status: 412 }));
  await expect(
    store.write("conflict.ttl", emptyHealthDocument(), { create: true }),
  ).rejects.toBeInstanceOf(HealthIoError);
});
it("treats absent record/workout containers as empty and rejects escaped listings and redirects", async () => {
  const { store, faults, calls } = make();
  expect(await store.loadRecords("conditions")).toEqual([]);
  expect(await store.loadWorkouts()).toEqual([]);
  faults.set(
    `GET ${BASE}conditions/`,
    () =>
      new Response(`<${BASE}conditions/> <${NS.LDP}contains> <https://foreign.example/secret>.`, {
        headers: { "content-type": "text/turtle" },
      }),
  );
  await expect(store.loadRecords("conditions")).rejects.toThrow();
  expect(calls.some((call) => call.url.includes("foreign"))).toBe(false);
  faults.set(
    `GET ${BASE}redirect.ttl`,
    () =>
      new Response(null, { status: 302, headers: { location: "https://foreign.example/secret" } }),
  );
  await expect(store.read("redirect.ttl")).rejects.toThrow();
  expect(calls.at(-1)?.url).toBe(`${BASE}redirect.ttl`);
  await expect(store.read("../secret")).rejects.toThrow();
  await expect(store.addObservation("../bad", input)).rejects.toThrow("resource ID");
  await expect(
    store.saveRecord(
      "../bad",
      { kind: "records", name: "x", patient: OWNER, reference: OWNER, reminders: [] },
      { create: true },
    ),
  ).rejects.toThrow("resource ID");
  expect(() =>
    createHealthStore(podFixture().fetch, "https://pod.example/", "javascript:bad"),
  ).toThrow("owner IRI");
});
it("fails before sensitive writes on ACL setup failure and safely recovers interrupted creation", async () => {
  const { store, faults, calls, resources } = make();
  faults.set(`PUT ${BASE}.acl`, () => new Response(null, { status: 403 }));
  await expect(store.addObservation("one", input)).rejects.toMatchObject({ status: 403 });
  expect(resources.has(BASE)).toBe(true);
  expect(calls.some((call) => call.method === "PUT" && call.url.includes("observations/"))).toBe(
    false,
  );
  faults.delete(`PUT ${BASE}.acl`);
  await store.addObservation("one", input);
  expect(resources.has(`${BASE}.acl`)).toBe(true);
});
it.each([
  "missing-link",
  "foreign-link",
  "create-error",
  "head-error",
  "acl-error",
  "empty-acl",
  "public-acl",
])("fails closed on privacy error %s", async (scenario) => {
  const { store, faults, put, resources, calls } = make();
  if (scenario === "missing-link")
    faults.set(`PUT ${BASE}`, () => new Response(null, { status: 201 }));
  if (scenario === "foreign-link")
    faults.set(
      `PUT ${BASE}`,
      () =>
        new Response(null, {
          status: 201,
          headers: { link: '<https://foreign.example/acl>; rel="acl"' },
        }),
    );
  if (scenario === "create-error")
    faults.set(`PUT ${BASE}`, () => new Response(null, { status: 500 }));
  if (scenario === "head-error") {
    resources.set(BASE, { body: "", type: "text/turtle", etag: '"x"', container: true });
    faults.set(`HEAD ${BASE}`, () => new Response(null, { status: 403 }));
  }
  if (scenario === "acl-error")
    faults.set(`GET ${BASE}.acl`, () => new Response(null, { status: 403 }));
  if (scenario === "empty-acl") put(".acl", "");
  if (scenario === "public-acl")
    put(
      ".acl",
      `@prefix acl: <${NS.ACL}>. <#public> a acl:Authorization; acl:agentClass <${NS.FOAF}Agent>; acl:accessTo <${BASE}>; acl:mode acl:Read.`,
    );
  await expect(store.addObservation("one", input)).rejects.toThrow();
  expect(calls.some((call) => call.method === "PUT" && call.url.endsWith("2025-01.ttl"))).toBe(
    false,
  );
});
it("rejects unsafe IRI data before serialization", async () => {
  const document = emptyHealthDocument();
  document.mintObservation("https://evil.example/> injected");
  await expect(toTurtle(document)).rejects.toThrow("Unsafe RDF IRI");
});
it("refuses even an in-scope redirect before following it", async () => {
  const { store, faults, calls } = make();
  faults.set(
    `GET ${BASE}redirect.ttl`,
    () => new Response(null, { status: 302, headers: { location: `${BASE}target.ttl` } }),
  );
  await expect(store.read("redirect.ttl")).rejects.toThrow();
  expect(calls).toHaveLength(1);
});
