// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
import { DIET_MEAL, DIET_SYMPTOM, LEGACY_DIET_NS } from "@jeswr/solid-health-diary";
import { recordingStorage } from "../../../test/storage";
import { parseRdf } from "@jeswr/fetch-rdf";
import { TermWrapper, NamedNodeAs, OptionalFrom } from "@rdfjs/wrapper";
import { DataFactory } from "n3";
import { describe, expect, it, vi } from "vitest";
import { mealsContainer, symptomsContainer } from "./layout";
import { registerDiaryTypes } from "./type-index";

const WEBID = "https://alice.example/profile/card#me";
const ROOT = "https://alice.example/";
const INDEX = "https://alice.example/settings/privateTypeIndex.ttl";

const PROFILE_TTL = `@prefix solid: <http://www.w3.org/ns/solid/terms#> .
<${WEBID}> solid:privateTypeIndex <${INDEX}> .`;

const EMPTY_INDEX_TTL = `@prefix solid: <http://www.w3.org/ns/solid/terms#> .
<${INDEX}> a solid:TypeIndex, solid:UnlistedDocument .`;

describe("registerDiaryTypes", () => {
  it("registers diet:Meal + diet:Symptom into an existing private index", async () => {
    const { storage, calls, puts } = recordingStorage();
    await storage.write(`${ROOT}profile/card`, PROFILE_TTL, { contentType: "text/turtle", ifMatch: "*" });
    await storage.write(INDEX, EMPTY_INDEX_TTL, { contentType: "text/turtle", ifMatch: "*" });

    calls.length = 0;
    const result = await registerDiaryTypes(storage, { webId: WEBID, storageRoot: ROOT });
    expect(result.registered).toBe(true);
    expect(result.indexUrl).toBe(INDEX);
    const indexPut = puts().find((p) => p.url === INDEX);
    expect(indexPut).toBeTruthy();
    expect(indexPut?.body).toContain(DIET_MEAL);
    expect(indexPut?.body).toContain(DIET_SYMPTOM);
    expect(indexPut?.body).toContain(mealsContainer(ROOT));
  });

  it("surfaces registration failures to the caller", async () => {
    const failure = new TypeError("Failed to fetch");
    const { storage } = recordingStorage(ROOT, () => { throw failure; });
    await expect(registerDiaryTypes(storage, { webId: WEBID, storageRoot: ROOT })).rejects.toBe(failure);
  });
});

const EXTERNAL_WEBID = "https://id.inrupt.com/alice#me";
const PROFILE_DOC = "https://id.inrupt.com/alice";
const STORAGE_ROOT = "https://storage.inrupt.com/alice/";

it.each([
  `${STORAGE_ROOT}settings/privateTypeIndex.ttl`,
  "https://id.inrupt.com/settings/privateTypeIndex.ttl",
  "https://index.example/alice/private.ttl",
  "https://storage.inrupt.com/settings/privateTypeIndex.ttl",
])("registers a different-origin WebID's diary in %s", async (indexUrl) => {
  const { storage, calls } = recordingStorage(STORAGE_ROOT);
  const emptyIndex = `<${indexUrl}> a <http://www.w3.org/ns/solid/terms#TypeIndex> .`;
  if (storage.isWithinStorage(indexUrl)) {
    await storage.write(indexUrl, emptyIndex, { contentType: "text/turtle", ifMatch: "*" });
  }
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    expect(init?.redirect).toBe("manual");
    if (init?.method === "PUT") {
      expect(url).toBe(indexUrl);
      expect(new Headers(init.headers).get("if-match")).toBe('"index-v1"');
      expect(new Headers(init.headers).get("content-type")).toBe("text/turtle");
      const dataset = await parseRdf(String(init.body), "text/turtle", { baseIRI: url });
      expect(dataset.size).toBeGreaterThan(1);
      expect(String(init.body)).toContain(DIET_MEAL);
      expect(String(init.body)).toContain(symptomsContainer(STORAGE_ROOT));
      return new Response(null, { status: 204 });
    }
    if (url === PROFILE_DOC) return new Response(
      `<${EXTERNAL_WEBID}> <http://www.w3.org/ns/solid/terms#privateTypeIndex> <${indexUrl}> .`,
      { headers: { "content-type": "text/turtle", etag: '"profile-v1"' } },
    );
    expect(url).toBe(indexUrl);
    return new Response(emptyIndex, { headers: { "content-type": "text/turtle", etag: '"index-v1"' } });
  });
  expect(await registerDiaryTypes(storage, {
    webId: EXTERNAL_WEBID, storageRoot: STORAGE_ROOT, fetch,
  })).toEqual({ registered: true, indexUrl });
  expect(fetch).toHaveBeenCalledWith(PROFILE_DOC, expect.objectContaining({ redirect: "manual" }));
  const offStorage = calls.filter((call) => !storage.isWithinStorage(call.url));
  expect(offStorage).toEqual([]);
  if (!storage.isWithinStorage(indexUrl)) expect(fetch).toHaveBeenCalledTimes(3);
  else expect((await storage.readRdf(indexUrl)).dataset.size).toBeGreaterThan(1);
});

it("creates an ACL-protected index and conditionally links a profile on another origin", async () => {
  const { storage, puts } = recordingStorage(STORAGE_ROOT);
  const indexUrl = `${STORAGE_ROOT}settings/privateTypeIndex.ttl`;
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    expect(String(input)).toBe(PROFILE_DOC);
    expect(init?.redirect).toBe("manual");
    if (init?.method === "PUT") {
      expect(new Headers(init.headers).get("if-match")).toBe('"profile-v1"');
      const dataset = await parseRdf(String(init.body), "text/turtle", { baseIRI: PROFILE_DOC });
      const subject = new TermWrapper(EXTERNAL_WEBID, dataset, DataFactory);
      expect(OptionalFrom.subjectPredicate(subject,
        "http://www.w3.org/ns/solid/terms#privateTypeIndex", NamedNodeAs.string)).toBe(indexUrl);
      expect(String(init.body)).toContain("Alice");
      const writes = puts();
      expect(writes.findIndex((call) => call.url === `${indexUrl}.acl`)).toBeLessThan(
        writes.findIndex((call) => call.url === indexUrl),
      );
      return new Response(null, { status: 204 });
    }
    return new Response(`<${EXTERNAL_WEBID}> <http://xmlns.com/foaf/0.1/name> "Alice" .`, {
      headers: { "content-type": "text/turtle", etag: '"profile-v1"' },
    });
  });
  expect(await registerDiaryTypes(storage, {
    webId: EXTERNAL_WEBID, storageRoot: STORAGE_ROOT, fetch,
  })).toEqual({ registered: true, indexUrl });
  expect(fetch.mock.calls.some(([, init]) => init?.method === "PUT")).toBe(true);
});

it.each([403, 412, 302])("surfaces external profile writes that fail with HTTP %s", async (status) => {
  const { storage } = recordingStorage(STORAGE_ROOT);
  const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "PUT") return new Response(null, {
      status, headers: { location: "https://elsewhere.example/profile" },
    });
    return new Response("", { headers: { "content-type": "text/turtle", etag: '"profile-v1"' } });
  });
  await expect(registerDiaryTypes(storage, {
    webId: EXTERNAL_WEBID, storageRoot: STORAGE_ROOT, fetch,
  })).rejects.toMatchObject({ name: "PodWriteError", status });
  expect(fetch.mock.calls.every(([url]) => String(url) === PROFILE_DOC)).toBe(true);
});

it("refuses a profile redirect without following it or creating an index", async () => {
  const { storage, puts } = recordingStorage(STORAGE_ROOT);
  const fetch = vi.fn(async () => new Response(null, {
    status: 302, headers: { location: "https://id.inrupt.com/redirect-target" },
  }));
  await expect(registerDiaryTypes(storage, {
    webId: EXTERNAL_WEBID, storageRoot: STORAGE_ROOT, fetch,
  })).rejects.toThrow();
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(puts()).toEqual([]);
});

// AUTHORED-BY Codex GPT-6
it.each([false, true])("keeps existing diary registrations idempotent (legacy: %s)", async (legacy) => {
  const { storage, calls, puts } = recordingStorage();
  const meal = legacy ? `${LEGACY_DIET_NS}Meal` : DIET_MEAL;
  const symptom = legacy ? `${LEGACY_DIET_NS}Symptom` : DIET_SYMPTOM;
  const index = `${EMPTY_INDEX_TTL}
    <#meal> a <http://www.w3.org/ns/solid/terms#TypeRegistration> ;
      <http://www.w3.org/ns/solid/terms#forClass> <${meal}> ;
      <http://www.w3.org/ns/solid/terms#instanceContainer> <${mealsContainer(ROOT)}> .
    <#symptom> a <http://www.w3.org/ns/solid/terms#TypeRegistration> ;
      <http://www.w3.org/ns/solid/terms#forClass> <${symptom}> ;
      <http://www.w3.org/ns/solid/terms#instanceContainer> <${symptomsContainer(ROOT)}> .`;
  await storage.write(`${ROOT}profile/card`, PROFILE_TTL, { contentType: "text/turtle", ifMatch: "*" });
  await storage.write(INDEX, index, { contentType: "text/turtle", ifMatch: "*" });
  calls.length = 0;
  expect(await registerDiaryTypes(storage, { webId: WEBID, storageRoot: ROOT })).toEqual({ registered: true, indexUrl: INDEX });
  expect(puts()).toEqual([]);
});
