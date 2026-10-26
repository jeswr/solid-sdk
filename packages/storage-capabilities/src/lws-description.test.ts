// AUTHORED-BY Codex GPT-6.1-Sol
import { afterEach, expect, test, vi } from "vitest";
import { CapabilitiesError, parseLwsDescription } from "./index.js";
import { sparqLwsCid } from "./testing.js";
import { LWS, SSD } from "./vocab.js";

const storageUrl = sparqLwsCid.id;
const requestUrl = "https://lws.example/documents/note";
const rootService = { type: "StorageRoot", serviceEndpoint: "https://lws.example/" };

function minimal(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { id: storageUrl, type: "Storage", service: [{ ...rootService }], ...overrides };
}

function failure(
  body: unknown,
  code: CapabilitiesError["code"] = "description-invalid",
  location = storageUrl,
  request = requestUrl,
): void {
  let thrown: unknown;
  try {
    parseLwsDescription(body, location, request);
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(CapabilitiesError);
  expect(thrown).toMatchObject({ code, url: location });
}

afterEach(() => vi.restoreAllMocks());

test("parses the sparq LWS CID into the expected StorageDescription", () => {
  vi.spyOn(Date, "now").mockReturnValue(1_793_000_000_000);
  const before = structuredClone(sparqLwsCid);
  expect(parseLwsDescription(sparqLwsCid, storageUrl, requestUrl)).toMatchSnapshot();
  expect(sparqLwsCid).toEqual(before);
});

test.each([
  "application/lws+cid",
  "application/cid",
  "application/ld+json",
])("accepts a %s body by compact CID shape without interpreting its context", async (mediaType) => {
  const response = new Response(JSON.stringify(sparqLwsCid), {
    headers: { "Content-Type": mediaType },
  });
  expect(parseLwsDescription(await response.json(), storageUrl, requestUrl)).toMatchObject({
    protocol: "lws",
    id: storageUrl,
    root: rootService.serviceEndpoint,
    capabilities: [],
    sources: ["lws-cid"],
    etag: null,
    maxAgeMs: 3_600_000,
  });
});

test("normalises scheme, host and default port while retaining storage and root paths", () => {
  const body = minimal({
    id: "HTTPS://LWS.EXAMPLE:443/.well-known/storage",
    type: ["https://example.org/OtherStorage", LWS.Storage],
    service: [{ type: [LWS.StorageRoot], serviceEndpoint: "HTTPS://LWS.EXAMPLE:443/root/" }],
  });
  expect(parseLwsDescription(body, storageUrl, requestUrl)).toMatchObject({
    id: storageUrl,
    descriptionUrl: storageUrl,
    root: "https://lws.example/root/",
  });
  expect(
    parseLwsDescription(
      minimal({
        id: "http://lws.example:80/cid",
        service: [{ ...rootService, serviceEndpoint: "http://lws.example:80/" }],
      }),
      "http://lws.example/cid",
      "HTTP://LWS.EXAMPLE:80/doc",
    ),
  ).toMatchObject({ id: "http://lws.example/cid", root: "http://lws.example/" });
  expect(
    parseLwsDescription(minimal(), "HTTPS://LWS.EXAMPLE:443/.well-known/storage", requestUrl),
  ).toMatchObject({ id: storageUrl, descriptionUrl: storageUrl });
});

test("maps services and capabilities, preserves unknown types, raw extras and scalar/list shapes", () => {
  const extension = {
    type: ["UnknownService", "https://x.example/Foo", "urn:example:service", SSD.CrdtSyncService],
    id: "#extension",
    serviceEndpoint: "https://x.example/service",
    conformsTo: "https://example.org/profile",
    subscriptionType: ["WebhookSubscription", SSD.SseSubscription, "custom:suite"],
    label: "Unknown extension",
    settings: { enabled: true },
  };
  const body = minimal({
    service: [rootService, extension, { ...extension, subscriptionType: "WebhookSubscription" }],
    capability: [
      {
        id: "#move",
        type: ["MoveResource", "https://x.example/Foo"],
        appliesTo: ["Container"],
        preservesIdentifier: true,
      },
      { type: SSD.PatchSupport, format: { "text/turtle": ["text/n3"] } },
      { type: "FutureCapability", subscriptionType: "FutureSubscription" },
    ],
  });
  const before = structuredClone(body);
  const result = parseLwsDescription(body, storageUrl, requestUrl);
  expect(result.services[1]).toEqual({
    type: [
      `https://www.w3.org/ns/lws#UnknownService`,
      "https://x.example/Foo",
      "urn:example:service",
      SSD.CrdtSyncService,
    ],
    id: "#extension",
    endpoint: extension.serviceEndpoint,
    conformsTo: ["https://example.org/profile"],
    extra: {
      subscriptionType: [LWS.WebhookSubscription, SSD.SseSubscription, "custom:suite"],
      label: extension.label,
      settings: extension.settings,
    },
  });
  expect(result.services[2]?.extra.subscriptionType).toBe(LWS.WebhookSubscription);
  expect(result.capabilities).toEqual([
    {
      id: "#move",
      type: [LWS.MoveResource, "https://x.example/Foo"],
      extra: { appliesTo: ["Container"], preservesIdentifier: true },
    },
    { type: [SSD.PatchSupport], extra: { format: { "text/turtle": ["text/n3"] } } },
    {
      type: ["https://www.w3.org/ns/lws#FutureCapability"],
      extra: { subscriptionType: "https://www.w3.org/ns/lws#FutureSubscription" },
    },
  ]);
  expect(result.verificationMethods).toEqual([]);
  expect(body).toEqual(before);
});

test("keeps unusual raw keys as data without changing object prototypes", () => {
  const body = minimal({
    service: [
      rootService,
      JSON.parse(
        '{"type":"Unknown","serviceEndpoint":"https://lws.example/service","__proto__":{"polluted":true}}',
      ),
    ],
  });
  const extra = parseLwsDescription(body, storageUrl, requestUrl).services[1]?.extra;
  expect(extra).toHaveProperty("__proto__", { polluted: true });
  expect(Object.getPrototypeOf(extra)).toBe(Object.prototype);
  expect({}).not.toHaveProperty("polluted");
});

test("maps only JWK verification methods and preserves cryptographic type and key fields", () => {
  const jwkMethod = sparqLwsCid.verificationMethod[0];
  const body = minimal({
    verificationMethod: [
      { id: "#multikey", type: "Multikey", publicKeyMultibase: "zExample" },
      jwkMethod,
    ],
  });
  expect(parseLwsDescription(body, storageUrl, requestUrl).verificationMethods).toEqual([
    jwkMethod,
  ]);
});

test.each([
  { revoked: "2024-12-10T15:28:32Z" },
  { expires: "2025-12-01T00:00:00Z" },
  { revoked: "2030-01-01T12:00:00.123+02:00", expires: "2031-01-01T00:00:00Z" },
])("preserves verification-method validity metadata for use-time checks: %j", (validity) => {
  const method = { ...sparqLwsCid.verificationMethod[0], ...validity };
  const body = minimal({ verificationMethod: [method] });
  const before = structuredClone(body);
  vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-01-01T00:00:00Z"));
  const parsed = parseLwsDescription(body, storageUrl, requestUrl);
  // Cache serialization must retain past and future validity limits verbatim.
  expect(JSON.parse(JSON.stringify(parsed)).verificationMethods).toEqual([method]);
  expect(body).toEqual(before);
});

test.each(["revoked", "expires"])("rejects malformed %s metadata", (field) => {
  for (const value of [
    null,
    false,
    42,
    {},
    [],
    "",
    "not a date",
    "2026-01-01T00:00:00",
    "2026-13-01T00:00:00Z",
  ]) {
    failure(
      minimal({
        verificationMethod: [{ ...sparqLwsCid.verificationMethod[0], [field]: value }],
      }),
    );
  }
});

test.each([
  null,
  undefined,
  [],
  "{}",
  4,
  minimal({ id: undefined }),
  minimal({ id: "not a URL" }),
  minimal({ id: `${storageUrl}/` }),
  minimal({ id: "https://lws.example/.well-known/Storage" }),
  minimal({ id: `${storageUrl}?query` }),
  minimal({ id: `${storageUrl}#fragment` }),
  minimal({ id: "https://other.example/cid" }),
  minimal({ type: undefined }),
  minimal({ type: "NotStorage" }),
  minimal({ type: [] }),
  minimal({ type: ["Storage", 4] }),
  minimal({ type: " " }),
  minimal({ service: undefined }),
  minimal({ service: [] }),
  minimal({ service: {} }),
  minimal({ service: [null] }),
  minimal({ service: [rootService, rootService] }),
  minimal({ service: [{ ...rootService, type: [] }] }),
  minimal({ service: [{ ...rootService, serviceEndpoint: undefined }] }),
  minimal({ service: [{ ...rootService, serviceEndpoint: "/relative" }] }),
  minimal({ service: [{ ...rootService, id: 3 }] }),
  minimal({ service: [{ ...rootService, conformsTo: [null] }] }),
  minimal({ service: [{ ...rootService, subscriptionType: [null] }] }),
  minimal({ capability: null }),
  minimal({ capability: [null] }),
  minimal({ capability: [{ type: "MoveResource", id: false }] }),
  minimal({ capability: [{ type: undefined }] }),
  minimal({ verificationMethod: {} }),
  minimal({ verificationMethod: [null] }),
  ...["id", "type", "controller", "publicKeyJwk"].map((field) =>
    minimal({
      verificationMethod: [{ ...sparqLwsCid.verificationMethod[0], [field]: null }],
    }),
  ),
  minimal({ verificationMethod: [{ ...sparqLwsCid.verificationMethod[0], publicKeyJwk: [] }] }),
])("rejects invalid description shape or storage id: %#", (body) => failure(body));

test.each([
  "https://other.example/",
  "http://lws.example/",
  "https://lws.example:444/",
  "https://user@lws.example/",
  "https://:password@lws.example/",
])("rejects a StorageRoot with another scheme or authority: %s", (endpoint) =>
  failure(minimal({ service: [{ ...rootService, serviceEndpoint: endpoint }] }), "root-mismatch"));

test("rejects a foreign description authority even when its root is local", () => {
  const foreign = "https://foreign.example/cid";
  failure(minimal({ id: foreign }), "root-mismatch", foreign);
});

test("reports invalid storage/request URL arguments as description-invalid", () => {
  failure(minimal(), "description-invalid", "not absolute");
  failure(minimal(), "description-invalid", storageUrl, "/relative");
});
