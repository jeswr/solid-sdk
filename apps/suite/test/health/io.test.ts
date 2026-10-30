// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Codex GPT-6.1-Sol
import { LEGACY_NAMESPACES, NS } from "@jeswr/suite-vocab";
import { AclResource } from "@solid/object";
import { DataFactory } from "n3";
import { assert, expect, it, vi } from "vitest";
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
it.each([
  { "@context": "https://foreign.example/context" },
  { "@context": `${BASE}context.jsonld` },
  { "@context": "../context.jsonld" },
  { "@context": [null, { h: NS.HEALTH }, "https://foreign.example/context"] },
  { "@graph": [{ "@context": "https://foreign.example/context" }] },
  { "@context": { "@import": "https://foreign.example/context" } },
  {
    "@context": { nested: { "@id": "urn:nested", "@context": "https://foreign.example/context" } },
  },
])("rejects external JSON-LD contexts before any parser network access: %j", async (json) => {
  const { store, put, calls } = make();
  put("remote.jsonld", JSON.stringify(json), "application/ld+json; charset=utf-8");
  const globalFetch = vi
    .spyOn(globalThis, "fetch")
    .mockRejectedValue(new Error("Unexpected fetch"));
  try {
    await expect(store.read("remote.jsonld")).rejects.toThrow("External JSON-LD contexts");
    expect(globalFetch).not.toHaveBeenCalled();
    expect(calls.map((call) => call.url)).toEqual([`${BASE}remote.jsonld`]);
  } finally {
    globalFetch.mockRestore();
  }
});
it.each([
  "container",
  "target",
])("rejects external contexts in %s ACL reads before writes", async (target) => {
  const { store, put, calls } = make();
  const acl = target === "container" ? ".acl" : "new.ttl.acl";
  put(
    acl,
    JSON.stringify({ "@context": { "@import": "https://foreign.example/context" } }),
    "application/ld+json",
  );
  const globalFetch = vi
    .spyOn(globalThis, "fetch")
    .mockRejectedValue(new Error("Unexpected fetch"));
  try {
    const operation =
      target === "container"
        ? store.initialize()
        : store.write("new.ttl", emptyHealthDocument(), { create: true });
    await expect(operation).rejects.toThrow("External JSON-LD contexts");
    expect(globalFetch).not.toHaveBeenCalled();
    expect(calls.some((call) => call.method === "PUT" && call.url.endsWith("new.ttl"))).toBe(false);
  } finally {
    globalFetch.mockRestore();
  }
});
it("reads inline JSON-LD contexts and ACLs while preserving validators and relative identities", async () => {
  const { store, put, calls } = make();
  put(
    "inline.jsonld",
    JSON.stringify({
      "@context": [null, { h: NS.HEALTH, value: { "@id": "h:value", "@type": `${NS.XSD}double` } }],
      "@id": "#it",
      "@type": "h:Observation",
      value: 72,
    }),
    "application/ld+json",
  );
  const result = await store.read("inline.jsonld");
  expect(result.url).toBe(`${BASE}inline.jsonld`);
  expect(result.etag).toMatch(/^"/);
  expect(result.document.observation(`${BASE}inline.jsonld#it`).measuredValue).toBe(72);
  put(
    "new.ttl.acl",
    JSON.stringify({
      "@context": { acl: NS.ACL },
      "@id": "#owner",
      "@type": "acl:Authorization",
      "acl:accessTo": { "@id": `${BASE}new.ttl` },
      "acl:agent": { "@id": OWNER },
      "acl:mode": ["Read", "Write", "Control"].map((mode) => ({ "@id": `acl:${mode}` })),
    }),
    "application/ld+json",
  );
  await store.write("new.ttl", emptyHealthDocument(), { create: true });
  expect(calls.at(-1)?.method).toBe("PUT");
});
it("parses the validated JSON object when context keys are duplicated", async () => {
  const { store, put } = make();
  put(
    "duplicate.jsonld",
    `{"@context":"https://foreign.example/context","@context":{},"@id":"#it"}`,
    "application/ld+json",
  );
  const globalFetch = vi
    .spyOn(globalThis, "fetch")
    .mockRejectedValue(new Error("Unexpected fetch"));
  try {
    await store.read("duplicate.jsonld");
    expect(globalFetch).not.toHaveBeenCalled();
  } finally {
    globalFetch.mockRestore();
  }
});
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
    "workouts.ttl",
    `@prefix s: <${NS.SCHEMA}>. <#apple> a s:ExerciseAction; s:name "Apple run".`,
  );
  put(
    "activities.ttl",
    `@prefix s: <${NS.SCHEMA}>. <#garmin> a s:ExerciseAction; s:name "Garmin ride".
    <#fitbit> a s:ExerciseAction; s:name "Fitbit walk".`,
  );
  const entries = await store.loadWorkouts();
  expect(entries).toHaveLength(4);
  expect(entries.find((entry) => entry.activity === "Run")).toMatchObject({
    gpx: `${BASE}workouts/run/route.gpx`,
    source: "GPX",
  });
  expect(entries.map((entry) => entry.name)).toEqual(
    expect.arrayContaining(["Apple run", "Garmin ride", "Fitbit walk"]),
  );
  await expect(store.importGpx("run", SAMPLE_GPX)).rejects.toMatchObject({ status: 412 });
});
it("loads connector files without a native workout container", async () => {
  const { store, put } = make();
  put(
    "workouts.ttl",
    `@prefix s: <${NS.SCHEMA}>. <#apple> a s:ExerciseAction; s:name "Apple run".`,
  );
  expect(await store.loadWorkouts()).toMatchObject([
    { iri: `${BASE}workouts.ttl#apple`, name: "Apple run" },
  ]);
});
it("merges explicitly supplied in-scope connector files with native indexes without duplicates", async () => {
  const { store, put, calls } = make();
  await store.importGpx("run", SAMPLE_GPX);
  put(
    "custom.ttl",
    `@prefix s: <${NS.SCHEMA}>. <#custom> a s:ExerciseAction; s:name "Custom run".
    <${BASE}workouts/run/index.ttl#it> a s:ExerciseAction; s:name "Duplicate".`,
  );
  calls.length = 0;
  const entries = await store.loadWorkouts([
    "custom.ttl",
    `${BASE}custom.ttl`,
    "workouts/run/index.ttl",
  ]);
  expect(entries).toHaveLength(2);
  expect(entries.filter((entry) => entry.activity === "Run")).toHaveLength(1);
  expect(entries.find((entry) => entry.name === "Custom run")?.iri).toBe(
    `${BASE}custom.ttl#custom`,
  );
  expect(calls.filter((call) => call.url === `${BASE}custom.ttl`)).toHaveLength(1);
  expect(calls.filter((call) => call.url === `${BASE}workouts/run/index.ttl`)).toHaveLength(1);
  await expect(store.loadWorkouts(["https://foreign.example/workouts.ttl"])).rejects.toThrow();
  expect(calls.some((call) => call.url.includes("foreign"))).toBe(false);
});
it.each([
  "workouts.ttl",
  "activities.ttl",
  "custom.ttl",
])("propagates connector read failures for %s", async (path) => {
  const { store, faults } = make();
  faults.set(`GET ${BASE}${path}`, () => new Response(null, { status: 403 }));
  await expect(store.loadWorkouts([path])).rejects.toMatchObject({ status: 403 });
  faults.set(
    `GET ${BASE}${path}`,
    () => new Response("not turtle", { headers: { "content-type": "text/turtle" } }),
  );
  await expect(store.loadWorkouts([path])).rejects.toThrow();
});
it.each(
  Object.entries(LEGACY_NAMESPACES).filter(([, canonical]) => canonical === NS.HEALTH),
)("migrates legacy namespace %s once, preserving identities/literals and foreign data", async (legacy) => {
  const { store, put, resources, calls } = make();
  await store.initialize();
  calls.length = 0;
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
  await store.initialize();
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
  await store.initialize();
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

function ownerAcl(url: string, defaults = false) {
  return `@prefix acl: <${NS.ACL}>. <#owner> a acl:Authorization;
    acl:accessTo <${url}>; ${defaults ? `acl:default <${url}>;` : ""}
    acl:agent <${OWNER}>; acl:mode acl:Read, acl:Write, acl:Control.`;
}
it.each([
  "observation",
  "record",
  "migration",
  "direct",
  "route",
  "index",
])("refuses a resource ACL override before a sensitive %s write", async (operation) => {
  const { store, put, resources, calls } = make();
  await store.initialize();
  const path = {
    observation: "observations/2025-01.ttl",
    record: "records/one.ttl",
    migration: "record.ttl",
    direct: "direct.ttl",
    route: "workouts/run/route.gpx",
    index: "workouts/run/index.ttl",
  }[operation] as string;
  const url = `${BASE}${path}`;
  const legacy = Object.keys(LEGACY_NAMESPACES).find((key) => LEGACY_NAMESPACES[key] === NS.CORE);
  put(path, `<#it> <${legacy}subject> <${OWNER}>.`);
  put(
    `${path}.acl`,
    `${ownerAcl(url)}
      <#public> a <${NS.ACL}Authorization>; <${NS.ACL}accessTo> <${url}>;
      <${NS.ACL}agentClass> <${NS.FOAF}Agent>; <${NS.ACL}mode> <${NS.ACL}Read>.`,
  );
  const before = resources.get(url);
  assert(before);
  calls.length = 0;
  const action = () => {
    switch (operation) {
      case "observation":
        return store.addObservation("two", input);
      case "record":
        return store.saveRecord(
          "one",
          { kind: "records", name: "x", patient: OWNER, reference: OWNER, reminders: [] },
          { etag: before.etag },
        );
      case "migration":
        return store.migrate(path);
      case "direct":
        return store.write(path, emptyHealthDocument(), { etag: before.etag });
      default:
        return store.importGpx("run", SAMPLE_GPX);
    }
  };
  await expect(action()).rejects.toThrow("not owner-private");
  expect(resources.get(url)).toEqual(before);
  expect(calls.some((call) => call.url === url && call.method === "PUT")).toBe(false);
});
it.each([
  "public-acl",
  "other-agent",
  "denied-acl",
  "broken-acl",
  "empty-acl",
  "missing-link",
  "foreign-link",
])("refuses to create a missing resource with unverifiable target privacy: %s", async (scenario) => {
  const { store, put, faults, calls, resources } = make();
  await store.initialize();
  const path = "new.ttl";
  const url = `${BASE}${path}`;
  if (scenario === "public-acl")
    put(
      `${path}.acl`,
      `${ownerAcl(url)}
      <#public> a <${NS.ACL}Authorization>; <${NS.ACL}accessTo> <${url}>;
      <${NS.ACL}agentClass> <${NS.FOAF}Agent>; <${NS.ACL}mode> <${NS.ACL}Read>.`,
    );
  if (scenario === "other-agent")
    put(`${path}.acl`, ownerAcl(url).replace(`<${OWNER}>`, `<https://other.example/#me>`));
  if (scenario === "denied-acl")
    faults.set(`GET ${url}.acl`, () => new Response(null, { status: 403 }));
  if (scenario === "broken-acl") put(`${path}.acl`, "not turtle");
  if (scenario === "empty-acl") put(`${path}.acl`, "");
  if (scenario === "missing-link")
    faults.set(`HEAD ${url}`, () => new Response(null, { status: 404 }));
  if (scenario === "foreign-link")
    faults.set(
      `HEAD ${url}`,
      () =>
        new Response(null, {
          status: 404,
          headers: { link: '<https://foreign.example/acl>; rel="acl"' },
        }),
    );
  calls.length = 0;
  await expect(store.write(path, emptyHealthDocument(), { create: true })).rejects.toThrow();
  expect(resources.has(url)).toBe(false);
  expect(calls.some((call) => call.url === url && call.method === "PUT")).toBe(false);
  expect(calls.some((call) => call.url === BASE || call.url.includes("foreign"))).toBe(false);
});
it.each([
  true,
  false,
])("checks a missing target's advertised ACL before creation (exists: %s)", async (exists) => {
  const { store, put, faults, calls } = make();
  await store.initialize();
  const url = `${BASE}new.ttl`;
  const aclUrl = `${BASE}permissions.ttl`;
  if (exists) put("permissions.ttl", ownerAcl(url));
  faults.set(
    `HEAD ${url}`,
    () =>
      new Response(null, {
        status: 404,
        headers: { link: '<permissions.ttl>; rel="acl"' },
      }),
  );
  calls.length = 0;
  await store.write("new.ttl", emptyHealthDocument(), { create: true });
  expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
    `HEAD ${url}`,
    `GET ${aclUrl}`,
    ...(!exists ? [`HEAD ${BASE}`, `GET ${BASE}.acl`] : []),
    `PUT ${url}`,
  ]);
});
it("uses the resource ACL link and accepts private overrides without default rules", async () => {
  const { store, put, faults, calls } = make();
  await store.addObservation("one", input);
  const url = `${BASE}observations/2025-01.ttl`;
  put("permissions.ttl", ownerAcl(url));
  faults.set(
    `HEAD ${url}`,
    () => new Response(null, { headers: { link: '<../permissions.ttl>; rel="acl"' } }),
  );
  await store.addObservation("two", input);
  expect(await store.metric("steps", range)).toHaveLength(2);
  expect(calls.some((call) => call.url === `${BASE}permissions.ttl` && call.method === "GET")).toBe(
    true,
  );
});
it.each([
  "head",
  "missing-link",
  "foreign-link",
  "denied-acl",
  "broken-acl",
  "empty-acl",
])("fails closed when resource privacy cannot be established: %s", async (scenario) => {
  const { store, faults, put, calls } = make();
  await store.addObservation("one", input);
  const url = `${BASE}observations/2025-01.ttl`;
  if (scenario === "head") faults.set(`HEAD ${url}`, () => new Response(null, { status: 403 }));
  if (scenario === "missing-link") faults.set(`HEAD ${url}`, () => new Response());
  if (scenario === "foreign-link")
    faults.set(
      `HEAD ${url}`,
      () => new Response(null, { headers: { link: '<https://foreign.example/acl>; rel="acl"' } }),
    );
  if (scenario === "denied-acl")
    faults.set(`GET ${url}.acl`, () => new Response(null, { status: 403 }));
  if (scenario === "broken-acl") put("observations/2025-01.ttl.acl", "not turtle");
  if (scenario === "empty-acl") put("observations/2025-01.ttl.acl", "");
  calls.length = 0;
  await expect(store.addObservation("two", input)).rejects.toThrow();
  expect(calls.some((call) => call.url === url && call.method === "PUT")).toBe(false);
});
it("walks missing inherited ACLs only inside the health scope and requires private defaults", async () => {
  const { store, put, resources, calls } = make();
  await store.initialize();
  put("nested/", "");
  put("nested/data.ttl", "");
  await expect(
    store.write("nested/data.ttl", emptyHealthDocument(), { create: true }),
  ).rejects.toMatchObject({ status: 412 });
  put("nested/.acl", ownerAcl(`${BASE}nested/`));
  await expect(
    store.write("nested/new.ttl", emptyHealthDocument(), { create: true }),
  ).rejects.toThrow("not owner-private");
  resources.delete(`${BASE}nested/.acl`);
  resources.delete(`${BASE}.acl`);
  calls.length = 0;
  await expect(
    store.write("nested/data.ttl", emptyHealthDocument(), { create: true }),
  ).rejects.toThrow("inheritance");
  expect(calls.every((call) => call.url.startsWith(BASE))).toBe(true);
  await expect(
    store.write("absent/new.ttl", emptyHealthDocument(), { create: true }),
  ).rejects.toMatchObject({ status: 404 });
});

it("lists complete workouts and resumes an identical GPX after its index write fails", async () => {
  const { store, faults, resources, calls } = make();
  await store.importGpx("complete", SAMPLE_GPX);
  const index = `${BASE}workouts/run/index.ttl`;
  const route = `${BASE}workouts/run/route.gpx`;
  faults.set(`PUT ${index}`, () => new Response(null, { status: 500 }));
  await expect(store.importGpx("run", SAMPLE_GPX)).rejects.toMatchObject({ status: 500 });
  const uploaded = resources.get(route);
  expect(uploaded?.body).toBe(SAMPLE_GPX);
  expect(await store.loadWorkouts()).toHaveLength(1);
  faults.delete(`PUT ${index}`);
  await store.importGpx("run", SAMPLE_GPX);
  expect(resources.get(route)).toEqual(uploaded);
  expect(await store.loadWorkouts()).toHaveLength(2);
  expect(
    calls
      .filter((call) => call.method === "PUT" && call.url === route)
      .every((call) => call.headers.get("if-none-match") === "*"),
  ).toBe(true);
});
it("does not reuse a different GPX upload or hide upload/read failures", async () => {
  const { store, faults, resources } = make();
  const index = `${BASE}workouts/run/index.ttl`;
  const route = `${BASE}workouts/run/route.gpx`;
  faults.set(`PUT ${route}`, () => new Response(null, { status: 403 }));
  await expect(store.importGpx("run", SAMPLE_GPX)).rejects.toMatchObject({ status: 403 });
  faults.delete(`PUT ${route}`);
  faults.set(`PUT ${index}`, () => new Response(null, { status: 500 }));
  await expect(store.importGpx("run", SAMPLE_GPX)).rejects.toMatchObject({ status: 500 });
  faults.delete(`PUT ${index}`);
  await expect(store.importGpx("run", SAMPLE_GPX.replace("Run", "Walk"))).rejects.toMatchObject({
    status: 412,
  });
  expect(resources.has(index)).toBe(false);
  faults.set(`GET ${route}`, () => new Response(null, { status: 403 }));
  await expect(store.importGpx("run", SAMPLE_GPX)).rejects.toMatchObject({ status: 403 });
});
it("does not treat a privacy precondition failure as a resumable route conflict", async () => {
  const { store, faults, resources, calls } = make();
  await store.importGpx("run", SAMPLE_GPX);
  const index = `${BASE}workouts/run/index.ttl`;
  resources.delete(index);
  faults.set(`HEAD ${BASE}workouts/run/route.gpx`, () => new Response(null, { status: 412 }));
  calls.length = 0;
  await expect(store.importGpx("run", SAMPLE_GPX)).rejects.toMatchObject({
    status: 412,
    operation: "inspect privacy",
  });
  expect(resources.has(index)).toBe(false);
  expect(calls.some((call) => call.method === "PUT" && call.url === index)).toBe(false);
});
it.each([
  "denied",
  "malformed",
  "missing-file",
])("does not hide workout read failures: %s", async (scenario) => {
  const { store, faults, put } = make();
  await store.importGpx("run", SAMPLE_GPX);
  const path = scenario === "missing-file" ? "workouts/legacy.ttl" : "workouts/run/index.ttl";
  if (scenario === "malformed") put(path, "not turtle");
  else {
    if (scenario === "missing-file") put(path, "");
    faults.set(
      `GET ${BASE}${path}`,
      () => new Response(null, { status: scenario === "missing-file" ? 404 : 403 }),
    );
  }
  await expect(store.loadWorkouts()).rejects.toThrow();
});

it.each([
  "dateTimeStamp",
  "dateTime",
  "date",
])("reads metrics with xsd:%s timestamps", async (datatype) => {
  const { store, put } = make();
  const lexical = datatype === "date" ? "2025-01-01" : "2025-01-01T02:00:00+02:00";
  put(
    "observations/2025-01.ttl",
    `
    <#it> a <${NS.HEALTH}StepCountObservation>;
      <${NS.HEALTH}effectiveTime> <#time>; <${NS.HEALTH}value> 100;
      <${NS.HEALTH}hasUnit> <${NS.UNIT}NUM>; <${NS.HEALTH}unitCode> "1".
    <#time> <http://www.w3.org/2006/time#inXSDDateTimeStamp> "${lexical}"^^<${NS.XSD}${datatype}>.`,
  );
  expect(await store.metric("steps", range)).toMatchObject([{ at: input.at, value: 100 }]);
});
