// AUTHORED-BY Codex
import { PodScopeError } from "@jeswr/guarded-fetch";
import { DataFactory } from "n3";
import { expect, it } from "vitest";
import { PrivateIndexAccessError } from "../../src/apps/docs/lib/model/errors";
import {
  discoverProfileRegistrations,
  discoverRegistrations,
  ensureTypeRegistrations,
  ProfileTypeIndexAnchor,
  TypeIndexDataset,
} from "../../src/apps/docs/lib/model/type-index";
import { type MockResponse, mockFetch, privateIndexPolicy, turtleToStore } from "./helpers";

const ROOT = "https://pod.example/alice/";
const WEBID = `${ROOT}profile#me`;
const PROFILE = `${ROOT}profile`;
const PREFERENCES = `${ROOT}settings/prefs.ttl`;
const INDEX = `${ROOT}settings/privateTypeIndex.ttl`;
const CUSTOM = `${ROOT}custom/index.ttl`;
const EXTENDED = `${ROOT}extended.ttl`;
const SOLID = "http://www.w3.org/ns/solid/terms#";
const PREFS = "http://www.w3.org/ns/pim/space#preferencesFile";
const SEE_ALSO = "http://www.w3.org/2000/01/rdf-schema#seeAlso";
const PRIMARY = "http://xmlns.com/foaf/0.1/isPrimaryTopicOf";
const CLASS = "https://jeswr.org/ns/pod-drive#DriveRoot";
const CONTAINER = `${ROOT}Documents/`;
const pointer = (predicate: string, target: string) => `<${WEBID}> <${predicate}> <${target}>.`;
const REGISTRATION = `<#drive> a <${SOLID}TypeRegistration>; <${SOLID}forClass> <${CLASS}>; <${SOLID}instanceContainer> <${CONTAINER}>.`;
const options = {
  webId: WEBID,
  podRoot: ROOT,
  registrations: [{ forClass: CLASS, container: CONTAINER }],
};

it("reads every class, instance and instanceContainer in a multi-valued registration", () => {
  const index = new TypeIndexDataset(
    turtleToStore(
      `
    @prefix solid: <${SOLID}>.
    [] a solid:TypeRegistration; solid:forClass <https://example.org/Other>, <${CLASS}>;
      solid:instance <${CONTAINER}>, <${ROOT}Archive/>;
      solid:instanceContainer <${ROOT}Files/>, <${ROOT}Photos/>.
  `,
      CUSTOM,
    ),
    DataFactory,
  );
  expect(index.locate(CLASS)).toEqual([
    { forClass: CLASS, instance: CONTAINER, container: undefined },
    { forClass: CLASS, instance: `${ROOT}Archive/`, container: undefined },
    { forClass: CLASS, instance: undefined, container: `${ROOT}Files/` },
    { forClass: CLASS, instance: undefined, container: `${ROOT}Photos/` },
  ]);
  expect(index.all()).toHaveLength(8);
});

it.each([
  "pim",
  "space",
])("discovers a %s:preferencesFile private index on the WebID subject", async (prefix) => {
  const { fetch, calls } = mockFetch({
    [`GET ${WEBID}`]: {
      body: `@prefix ${prefix}: <http://www.w3.org/ns/pim/space#>. <${WEBID}> ${prefix}:preferencesFile <${PREFERENCES}>.`,
    },
    [`GET ${PREFERENCES}`]: { body: pointer(`${SOLID}privateTypeIndex`, CUSTOM) },
    [`GET ${CUSTOM}`]: { body: REGISTRATION },
  });
  expect(await discoverProfileRegistrations(WEBID, fetch, ROOT)).toEqual([
    { forClass: CLASS, container: CONTAINER, instance: undefined },
  ]);
  expect(calls.map((call) => call.url)).toEqual([WEBID, PREFERENCES, CUSTOM]);
});

it("collects every index link, keeps public before private and de-duplicates documents and cycles", async () => {
  const publicIndex = `${ROOT}public.ttl`;
  const secondPublic = `${ROOT}public2.ttl`;
  const secondPrivate = `${ROOT}private2.ttl`;
  const profile = [
    pointer(`${SOLID}publicTypeIndex`, publicIndex),
    pointer(`${SOLID}publicTypeIndex`, secondPublic),
    pointer(`${SOLID}privateTypeIndex`, CUSTOM),
    pointer(PREFS, PREFERENCES),
    pointer(SEE_ALSO, `${EXTENDED}#a`),
    pointer(PRIMARY, `${EXTENDED}#b`),
  ].join("\n");
  const { fetch, calls } = mockFetch({
    [`GET ${WEBID}`]: { body: profile },
    [`GET ${EXTENDED}`]: {
      body: `${pointer(SEE_ALSO, WEBID)}\n${pointer(PREFS, PREFERENCES)}\n${pointer(`${SOLID}privateTypeIndex`, CUSTOM)}`,
    },
    [`GET ${PREFERENCES}`]: {
      body: `${pointer(`${SOLID}privateTypeIndex`, CUSTOM)}\n${pointer(`${SOLID}privateTypeIndex`, secondPrivate)}`,
    },
    ...Object.fromEntries(
      [publicIndex, secondPublic, CUSTOM, secondPrivate].map((url) => [
        `GET ${url}`,
        { body: REGISTRATION.replace(CONTAINER, `${url}/`) },
      ]),
    ),
  });
  const locations = await discoverProfileRegistrations(WEBID, fetch, ROOT);
  expect(locations.map((location) => location.container)).toEqual(
    [publicIndex, secondPublic, CUSTOM, secondPrivate].map((url) => `${url}/`),
  );
  expect(calls.map((call) => call.url)).toEqual([
    WEBID,
    EXTENDED,
    PREFERENCES,
    publicIndex,
    secondPublic,
    CUSTOM,
    secondPrivate,
  ]);
});

it.each([
  PREFS,
  SEE_ALSO,
  PRIMARY,
])("rejects an off-storage %s link before fetching it or writing", async (predicate) => {
  const { fetch, calls } = mockFetch({
    [`GET ${WEBID}`]: { body: pointer(predicate, "https://evil.example/document") },
  });
  await expect(discoverProfileRegistrations(WEBID, fetch, ROOT)).rejects.toBeInstanceOf(
    PodScopeError,
  );
  await expect(ensureTypeRegistrations({ ...options, fetchImpl: fetch })).rejects.toBeInstanceOf(
    PodScopeError,
  );
  expect(calls.every((call) => call.url === WEBID)).toBe(true);
});

it("rejects an off-storage private index linked from preferences without requesting it", async () => {
  const { fetch, calls } = mockFetch({
    [`GET ${WEBID}`]: { body: pointer(PREFS, PREFERENCES) },
    [`GET ${PREFERENCES}`]: {
      body: pointer(`${SOLID}privateTypeIndex`, "https://evil.example/index"),
    },
  });
  await expect(discoverProfileRegistrations(WEBID, fetch, ROOT)).rejects.toBeInstanceOf(
    PodScopeError,
  );
  expect(calls.map((call) => call.url)).toEqual([WEBID, PREFERENCES]);
});

it.each([
  PREFS,
  SEE_ALSO,
])("a missing %s document contributes no registrations", async (predicate) => {
  const { fetch } = mockFetch({ [`GET ${WEBID}`]: { body: pointer(predicate, PREFERENCES) } });
  await expect(discoverProfileRegistrations(WEBID, fetch, ROOT)).resolves.toEqual([]);
});

it.each([
  PREFS,
  SEE_ALSO,
])("ignores forbidden %s documents only in non-bootstrap discovery", async (predicate) => {
  const profile = turtleToStore(pointer(predicate, PREFERENCES), PROFILE);
  const { fetch } = mockFetch({ [`GET ${PREFERENCES}`]: { status: 403 } });
  await expect(discoverRegistrations(WEBID, profile, fetch, ROOT)).resolves.toEqual([]);
  await expect(discoverRegistrations(WEBID, profile, fetch, ROOT, true)).rejects.toMatchObject({
    status: 403,
  });
});

it.each([
  401,
  403,
  500,
  "offline",
  "parse",
] as const)("does not write when preferences are unreadable (%s)", async (failure) => {
  const { fetch: transport, calls } = mockFetch({
    [`GET ${WEBID}`]: { body: pointer(PREFS, PREFERENCES) },
    [`GET ${PREFERENCES}`]:
      typeof failure === "number" ? { status: failure } : { body: "invalid Turtle" },
  });
  const fetchImpl: typeof fetch = (url, init) => {
    if (String(url) === PREFERENCES && failure === "offline") throw new Error("offline");
    return transport(url, init);
  };
  await expect(ensureTypeRegistrations({ ...options, fetchImpl })).rejects.toThrow();
  expect(calls.some((call) => call.method === "PUT")).toBe(false);
});

it("bounds linked-profile discovery and refuses an incomplete bootstrap decision", async () => {
  const { fetch, calls } = mockFetch(
    Object.fromEntries([
      [`GET ${WEBID}`, { body: pointer(SEE_ALSO, `${ROOT}extended0.ttl`) }],
      ...Array.from({ length: 32 }, (_, index) => [
        `GET ${ROOT}extended${index}.ttl`,
        { body: pointer(SEE_ALSO, `${ROOT}extended${index + 1}.ttl`) },
      ]),
    ]),
  );
  await expect(discoverProfileRegistrations(WEBID, fetch, ROOT)).rejects.toThrow("Too many linked");
  expect(calls).toHaveLength(32);
});

const bootstrapScript = (): Record<string, MockResponse> => ({
  [`GET ${WEBID}`]: { body: "", etag: '"profile"' },
  [`PUT ${PROFILE}`]: { status: 205 },
  [`PUT ${PREFERENCES}`]: { status: 201 },
  [`GET ${INDEX}`]: { body: "", etag: '"index"' },
  [`PUT ${INDEX}`]: { status: 201 },
  ...privateIndexPolicy(INDEX, WEBID),
  ...privateIndexPolicy(PREFERENCES, WEBID),
});

it.each([
  true,
  false,
])("links a newly created private index from preferences (preferences linked: %s)", async (linked) => {
  const script = bootstrapScript();
  if (linked) script[`GET ${WEBID}`] = { body: pointer(PREFS, PREFERENCES), etag: '"profile"' };
  const { fetch, calls } = mockFetch(script);
  await expect(ensureTypeRegistrations({ ...options, fetchImpl: fetch })).resolves.toEqual({
    indexUrl: INDEX,
    added: 1,
    bootstrapped: true,
  });
  const prefsPut = calls.find((call) => call.url === PREFERENCES && call.method === "PUT");
  expect(prefsPut?.headers["if-none-match"]).toBe("*");
  expect(
    new ProfileTypeIndexAnchor(WEBID, turtleToStore(prefsPut?.body ?? "", PREFERENCES), DataFactory)
      .privateIndex,
  ).toBe(INDEX);
  const profilePut = calls.find((call) => call.url === PROFILE && call.method === "PUT");
  expect(Boolean(profilePut)).toBe(!linked);
  if (profilePut) {
    expect(profilePut.headers["if-match"]).toBe('"profile"');
    const anchor = new ProfileTypeIndexAnchor(
      WEBID,
      turtleToStore(profilePut.body ?? "", PROFILE),
      DataFactory,
    );
    expect(anchor.privateIndex).toBeUndefined();
    expect([...anchor.preferencesFiles]).toEqual([PREFERENCES]);
  }
});

it("preserves an existing preferences document and conditionally adds its private index link", async () => {
  const script = bootstrapScript();
  script[`GET ${WEBID}`] = { body: pointer(PREFS, PREFERENCES) };
  script[`GET ${PREFERENCES}`] = {
    body: '<#settings> <https://example.org/theme> "dark".',
    etag: '"prefs"',
  };
  const { fetch, calls } = mockFetch(script);
  await ensureTypeRegistrations({ ...options, fetchImpl: fetch });
  const write = calls.find((call) => call.url === PREFERENCES && call.method === "PUT");
  expect(write?.headers["if-match"]).toBe('"prefs"');
  expect(write?.body).toContain('"dark"');
  expect(calls.some((call) => call.url === PROFILE)).toBe(false);
});

it("reuses an unlinked preferences document's private index before linking preferences to the profile", async () => {
  const script = bootstrapScript();
  script[`GET ${PREFERENCES}`] = {
    body: pointer(`${SOLID}privateTypeIndex`, CUSTOM),
    etag: '"prefs"',
  };
  script[`GET ${CUSTOM}`] = { body: REGISTRATION };
  Object.assign(script, privateIndexPolicy(CUSTOM, WEBID));
  const { fetch, calls } = mockFetch(script);
  await expect(ensureTypeRegistrations({ ...options, fetchImpl: fetch })).resolves.toEqual({
    indexUrl: CUSTOM,
    added: 0,
    bootstrapped: false,
  });
  expect(calls.filter((call) => call.method === "PUT").map((call) => call.url)).toEqual([PROFILE]);
});

it.each([
  401, 403, 500,
])("never replaces an unreadable default preferences document (%s)", async (status) => {
  const script = bootstrapScript();
  script[`GET ${PREFERENCES}`] = { status };
  const { fetch, calls } = mockFetch(script);
  await expect(ensureTypeRegistrations({ ...options, fetchImpl: fetch })).rejects.toMatchObject({
    status,
  });
  expect(calls.some((call) => call.method === "PUT")).toBe(false);
});

it.each([
  true,
  false,
])("re-discovers preferences after a conditional-write conflict (create: %s)", async (missing) => {
  const script = bootstrapScript();
  script[`GET ${WEBID}`] = { body: pointer(PREFS, PREFERENCES) };
  script[`GET ${CUSTOM}`] = { body: REGISTRATION };
  Object.assign(script, privateIndexPolicy(CUSTOM, WEBID));
  const { fetch: transport } = mockFetch(script);
  let writes = 0;
  const fetchImpl: typeof fetch = (url, init) => {
    if (String(url) === PREFERENCES) {
      if (init?.method === "PUT") {
        expect(new Headers(init.headers).get(missing ? "if-none-match" : "if-match")).toBe(
          missing ? "*" : '"prefs"',
        );
        writes++;
        return Promise.resolve(new Response(null, { status: 412 }));
      }
      if (!init?.method)
        return Promise.resolve(
          new Response(writes ? pointer(`${SOLID}privateTypeIndex`, CUSTOM) : "", {
            status: !writes && missing ? 404 : 200,
            headers: { "content-type": "text/turtle", etag: '"prefs"' },
          }),
        );
    }
    return transport(url, init);
  };
  await expect(ensureTypeRegistrations({ ...options, fetchImpl })).resolves.toMatchObject({
    indexUrl: CUSTOM,
    added: 0,
  });
  expect(writes).toBe(1);
});

it.each([
  false,
  true,
])("does not expose a private-index link through publicly readable preferences (index linked: %s)", async (linked) => {
  const script = bootstrapScript();
  if (linked) script[`GET ${PREFERENCES}`] = { body: pointer(`${SOLID}privateTypeIndex`, INDEX) };
  script[`GET ${PREFERENCES}.acl`] = {
    body: `<#public> a <http://www.w3.org/ns/auth/acl#Authorization>; <http://www.w3.org/ns/auth/acl#accessTo> <${PREFERENCES}>; <http://www.w3.org/ns/auth/acl#agentClass> <http://xmlns.com/foaf/0.1/Agent>; <http://www.w3.org/ns/auth/acl#mode> <http://www.w3.org/ns/auth/acl#Read>.`,
  };
  const { fetch, calls } = mockFetch(script);
  await expect(ensureTypeRegistrations({ ...options, fetchImpl: fetch })).rejects.toBeInstanceOf(
    PrivateIndexAccessError,
  );
  expect(calls.filter((call) => call.method === "PUT").map((call) => call.url)).toEqual(
    linked ? [] : [INDEX],
  );
});

it("adds the fallback to an existing preferences-linked index while preserving unrelated registrations", async () => {
  const script = bootstrapScript();
  script[`GET ${WEBID}`] = { body: pointer(PREFS, PREFERENCES) };
  script[`GET ${PREFERENCES}`] = { body: pointer(`${SOLID}privateTypeIndex`, CUSTOM) };
  script[`GET ${CUSTOM}`] = {
    body: REGISTRATION.replace(CLASS, "https://example.org/Other"),
    etag: '"custom"',
  };
  script[`PUT ${CUSTOM}`] = { status: 205 };
  Object.assign(script, privateIndexPolicy(CUSTOM, WEBID));
  const { fetch, calls } = mockFetch(script);
  await ensureTypeRegistrations({ ...options, fetchImpl: fetch });
  const writes = calls.filter((call) => call.method === "PUT");
  expect(writes).toHaveLength(1);
  expect(writes[0]).toMatchObject({ url: CUSTOM, headers: { "if-match": '"custom"' } });
  expect(
    new TypeIndexDataset(turtleToStore(writes[0]?.body ?? "", CUSTOM), DataFactory).all(),
  ).toHaveLength(2);
});
