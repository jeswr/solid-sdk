// AUTHORED-BY Codex GPT-6.1-Sol
import { readFileSync } from "node:fs";
import { parseRdf } from "@jeswr/fetch-rdf";
import { describe, expect, test, vi } from "vitest";
import { deriveFeatures } from "./index.js";
import { parseLwsDescription } from "./lws-description.js";
import { parseSolidDescription } from "./solid-description.js";
import type { CapabilityEntry, StorageDescription } from "./types.js";
import { ACQ, LWS, NOTIFY, SSD } from "./vocab.js";

const ROOT = "https://pod.example/";
const SSD_NS = "https://jeswr.org/ns/solid-sd#";
const PREFIXES = `
  @prefix did: <https://www.w3.org/ns/did#> .
  @prefix lws: <https://www.w3.org/ns/lws#> .
  @prefix ssd: <${SSD_NS}> .
  @prefix notify: <http://www.w3.org/ns/solid/notifications#> .
  @prefix dct: <http://purl.org/dc/terms/> .
  @prefix acq: <http://www.w3.org/ns/solid/sparql#> .
`;

function description(values: Partial<StorageDescription> = {}): StorageDescription {
  return {
    protocol: "solid",
    id: ROOT,
    root: ROOT,
    descriptionUrl: `${ROOT}.well-known/solid`,
    services: [],
    capabilities: [],
    sources: ["solid-description"],
    fetchedAt: 0,
    etag: null,
    maxAgeMs: 0,
    verificationMethods: [],
    ...values,
  };
}

function capability(type: string, extra: CapabilityEntry["extra"] = {}): CapabilityEntry {
  return { type: [type], extra };
}

async function solid(body: string): Promise<StorageDescription> {
  return description(
    parseSolidDescription(await parseRdf(PREFIXES + body, "text/turtle", { baseIRI: ROOT }), ROOT),
  );
}

function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
}

describe("draft examples", () => {
  test("CSS lists two usable notification channels and leaves other behaviours unknown", async () => {
    const d = await solid(fixture("css.ttl"));
    expect(d.services).toEqual([
      {
        type: [SSD.SolidNotificationService, NOTIFY.WebSocketChannel2023],
        endpoint: `${ROOT}.notifications/WebSocketChannel2023/`,
        extra: {
          [NOTIFY.channelType]: NOTIFY.WebSocketChannel2023,
          [NOTIFY.feature]: ["accept", "endAt", "rate", "startAt", "state"].map(
            (name) => `http://www.w3.org/ns/solid/notifications#${name}`,
          ),
        },
      },
      {
        type: [SSD.SolidNotificationService, NOTIFY.StreamingHTTPChannel2023],
        endpoint: `${ROOT}.notifications/StreamingHTTPChannel2023/`,
        extra: {
          [NOTIFY.channelType]: NOTIFY.StreamingHTTPChannel2023,
          [NOTIFY.feature]: ["accept", "endAt", "rate", "startAt", "state"].map(
            (name) => `http://www.w3.org/ns/solid/notifications#${name}`,
          ),
        },
      },
    ]);
    expect(d.capabilities).toEqual([]);
    const features = deriveFeatures(d);
    expect(features.liveUpdates).toEqual({
      state: "available",
      evidence: `solid-description:WebSocketChannel2023:${d.services[0]?.endpoint}`,
      detail: { channels: ["websocket", "sse"], endpoint: d.services[0]?.endpoint },
    });
    for (const [name, feature] of Object.entries(features)) {
      if (!["protocol", "liveUpdates", "typeIndex", "move", "rdfConneg"].includes(name))
        expect(feature.state, name).toBe("unknown");
    }
  });

  test("sparq Solid merges both discovery forms and maps the flat capabilities", async () => {
    const d = await solid(fixture("sparq-solid.ttl"));
    expect(d.services.map(({ type, endpoint }) => ({ type, endpoint }))).toEqual([
      {
        type: [SSD.SolidNotificationService, NOTIFY.WebSocketChannel2023],
        endpoint: `${ROOT}.notifications/WebSocketChannel2023/`,
      },
      { type: [LWS.StorageRoot], endpoint: ROOT },
      { type: [SSD.SparqlQueryService], endpoint: `${ROOT}sparql` },
      { type: [SSD.CrdtSyncService], endpoint: `${ROOT}.sync/tickets` },
      { type: [SSD.VersioningService], endpoint: `${ROOT}.versions/` },
      { type: [SSD.TrashService], endpoint: `${ROOT}.trash/` },
      { type: [SSD.RecursiveDeleteService], endpoint: `${ROOT}.delete` },
    ]);
    expect(d.services[0]).toMatchObject({
      id: `${ROOT}.notifications/WebSocketChannel2023/`,
      extra: {
        [NOTIFY.feature]: [
          "http://www.w3.org/ns/solid/notifications#endAt",
          "http://www.w3.org/ns/solid/notifications#rate",
        ],
      },
    });
    expect(d.services[2]?.conformsTo).toEqual([ACQ.profile]);
    expect(d.capabilities).toEqual([
      capability(SSD.AccessControl, { [SSD.model]: SSD.WAC }),
      capability(SSD.PatchSupport, {
        [SSD.source]: "text/turtle",
        [SSD.patchType]: ["text/n3", "application/sparql-update"],
      }),
      capability(SSD.ContentNegotiation, {
        [SSD.source]: "text/turtle",
        [SSD.target]: ["application/ld+json", "application/n-triples"],
      }),
    ]);
    const features = deriveFeatures(d);
    expect(features).toMatchObject({
      liveUpdates: { state: "available", detail: { channels: ["websocket"] } },
      serverSearch: { state: "available", detail: { endpoint: `${ROOT}sparql` } },
      realtimeCollab: { state: "available", detail: { protocols: [SSD.yProtocolV1] } },
      versioning: { state: "available", detail: { endpoint: `${ROOT}.versions/` } },
      trash: { state: "available", detail: { endpoint: `${ROOT}.trash/` } },
      recursiveDelete: {
        state: "available",
        evidence: `solid-description:RecursiveDeleteService:${ROOT}.delete`,
      },
      accessControl: { state: "available", detail: { model: "wac" } },
      patch: {
        state: "available",
        detail: { formats: { "text/turtle": ["text/n3", "application/sparql-update"] } },
      },
      rdfConneg: {
        state: "available",
        detail: { formats: ["text/turtle", "application/ld+json"] },
      },
    });
    for (const name of [
      "accessRequests",
      "accessGrants",
      "pagination",
      "resumableUploads",
    ] as const)
      expect(features[name].state).toBe("unknown");
  });

  test("sparq LWS expands the draft's compact terms without fetching contexts", () => {
    const body = JSON.parse(fixture("sparq-lws.jsonld"));
    const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("no network"));
    try {
      const before = structuredClone(body);
      const d = parseLwsDescription(body, "https://lws.example/", "https://lws.example/doc");
      expect(fetch).not.toHaveBeenCalled();
      expect(body).toEqual(before);
      expect(d.services.map((entry) => entry.type)).toEqual([
        [LWS.StorageRoot],
        [LWS.NotificationService],
        [LWS.TypeIndexService],
        [LWS.TypeSearchService],
        [LWS.AccessRequestService],
        [LWS.AccessGrantService],
        [SSD.SparqlQueryService],
        [SSD.CrdtSyncService],
        [SSD.RecursiveDeleteService],
      ]);
      expect(d.services[1]?.extra.subscriptionType).toEqual([
        LWS.WebhookSubscription,
        SSD.SseSubscription,
        SSD.WebSocketSubscription,
      ]);
      expect(d.capabilities).toEqual([
        capability(SSD.AccessControl, { model: SSD.ODRLGrants }),
        capability(SSD.PatchSupport, {
          source: "application/json",
          patchType: ["application/json-patch+json"],
        }),
        capability(SSD.PatchSupport, {
          source: "application/ld+json",
          patchType: ["application/json-patch+json"],
        }),
        capability(LWS.MoveResource, {
          appliesTo: ["DataResource", "Container"],
          preservesIdentifier: false,
        }),
      ]);
      expect(deriveFeatures(d)).toMatchObject({
        protocol: "lws",
        liveUpdates: { state: "available", detail: { channels: ["websocket", "sse", "webhook"] } },
        typeIndex: {
          state: "available",
          detail: {
            mode: "server",
            indexEndpoint: "https://lws.example/.lws/types/index",
            searchEndpoint: "https://lws.example/.lws/types/search",
          },
        },
        accessRequests: { state: "available", detail: { profiles: [LWS.AccessProfile] } },
        accessGrants: { state: "available", detail: { profiles: [LWS.AccessProfile] } },
        accessControl: { state: "available", detail: { model: "odrl-grants" } },
        serverSearch: { state: "available" },
        realtimeCollab: { state: "available" },
        recursiveDelete: { state: "available" },
        patch: {
          state: "available",
          detail: {
            formats: {
              "application/json": ["application/json-patch+json"],
              "application/ld+json": ["application/json-patch+json"],
            },
          },
        },
        move: {
          state: "available",
          detail: { native: true, containers: true, preservesIdentifier: false },
        },
        pagination: { state: "available" },
        rdfConneg: { state: "unknown" },
        versioning: { state: "unknown" },
        trash: { state: "unknown" },
        resumableUploads: { state: "unknown" },
      });
    } finally {
      fetch.mockRestore();
    }
  });
});

describe("entry merging and compatibility", () => {
  test("merges separate notification nodes, unions features and retains listed metadata", async () => {
    const d = await solid(`
      <> notify:subscription <notifications> ; did:service <#service>, <#other-channel> .
      <notifications> notify:channelType notify:WebSocketChannel2023 ; notify:feature notify:state .
      <#service> a ssd:SolidNotificationService ; did:serviceEndpoint <notifications> ;
        notify:channelType notify:WebSocketChannel2023 ; notify:feature notify:rate ; dct:conformsTo <urn:custom> ; <urn:extra> "kept" .
      <#other-channel> a ssd:SolidNotificationService ; did:serviceEndpoint <notifications> ; notify:channelType notify:StreamingHTTPChannel2023 .
    `);
    expect(d.services).toHaveLength(2);
    expect(d.services[0]).toMatchObject({
      id: `${ROOT}#service`,
      conformsTo: ["urn:custom"],
      extra: {
        [NOTIFY.feature]: [
          "http://www.w3.org/ns/solid/notifications#state",
          "http://www.w3.org/ns/solid/notifications#rate",
        ],
        "urn:extra": "kept",
      },
    });
    expect(deriveFeatures(d).liveUpdates.detail.channels).toEqual(["websocket", "sse"]);
  });

  test("notify:channelType wins over sparq's legacy ssd:channelType", async () => {
    const d = await solid(
      `<> did:service [ a ssd:SolidNotificationService ; did:serviceEndpoint <notifications> ; notify:channelType notify:WebSocketChannel2023 ; ssd:channelType notify:WebhookChannel2023 ] .`,
    );
    expect(deriveFeatures(d).liveUpdates.detail.channels).toEqual(["websocket"]);
    const legacy = await solid(
      `<> did:service [ a ssd:SolidNotificationService ; did:serviceEndpoint <notifications> ; ssd:channelType notify:StreamingHTTPChannel2023 ] .`,
    );
    expect(deriveFeatures(legacy).liveUpdates.detail.channels).toEqual(["sse"]);
  });

  test("root ACQ supplies its profile and merges with the listed query service", async () => {
    const d = await solid(
      `<> acq:endpoint <sparql> ; did:service <#query> . <#query> a ssd:SparqlQueryService ; did:serviceEndpoint <sparql> ; dct:conformsTo <urn:other> ; <urn:extra> "kept" .`,
    );
    expect(d.services).toEqual([
      {
        type: [SSD.SparqlQueryService],
        id: `${ROOT}#query`,
        endpoint: `${ROOT}sparql`,
        conformsTo: [ACQ.profile, "urn:other"],
        extra: { "urn:extra": "kept" },
      },
    ]);
    expect(deriveFeatures(d).serverSearch.state).toBe("available");
    expect(deriveFeatures(await solid("<> acq:endpoint <sparql> .")).serverSearch.state).toBe(
      "available",
    );
  });

  test.each([
    false,
    true,
  ])("reads shared nested ssd:format definitions (extension first: %s)", async (extensionFirst) => {
    const predicates = extensionFirst
      ? "<urn:extra> _:format ; ssd:format _:format"
      : "ssd:format _:format ; <urn:extra> _:format";
    const d = await solid(
      `<> lws:capability [ a ssd:PatchSupport ; ${predicates} ] . _:format ssd:source "text/turtle" ; ssd:patchType "text/n3" .`,
    );
    expect(deriveFeatures(d).patch.detail.formats).toEqual({ "text/turtle": ["text/n3"] });
  });

  test.each([
    { format: { "text/turtle": ["text/n3"] } },
    { mediaType: "text/turtle", patchType: ["text/n3"] },
    { format: [{ mediaType: "text/turtle", patchType: "text/n3" }] },
    { format: { mediaType: "text/turtle", patchType: "text/n3" } },
    { format: { source: "text/turtle", patchType: "text/n3" } },
    { format: [{ source: "text/turtle", patchType: "text/n3" }] },
  ])("reads legacy LWS PatchSupport %j", (extra) => {
    const d = parseLwsDescription(
      {
        id: ROOT,
        type: "Storage",
        service: [{ type: "StorageRoot", serviceEndpoint: ROOT }],
        capability: [{ type: "PatchSupport", ...extra }],
      },
      ROOT,
      ROOT,
    );
    expect(deriveFeatures(d).patch.detail.formats).toMatchObject({ "text/turtle": ["text/n3"] });
  });

  test("reads multiple nested RDF format nodes and leaves the deprecated delete capability unknown", async () => {
    const d = await solid(`<> lws:capability [ a ssd:PatchSupport ; ssd:format
      [ ssd:source "text/turtle" ; ssd:patchType "text/n3" ],
      [ ssd:source "application/json" ; ssd:patchType "application/json-patch+json" ] ],
      [ a ssd:RecursiveDelete ] .`);
    expect(deriveFeatures(d)).toMatchObject({
      patch: {
        state: "available",
        detail: {
          formats: {
            "text/turtle": ["text/n3"],
            "application/json": ["application/json-patch+json"],
          },
        },
      },
      recursiveDelete: { state: "unknown" },
    });
    expect(d.services).toEqual([]);
  });

  test("flat source takes precedence over legacy formats and accumulates sources", () => {
    const d = description({
      capabilities: [
        capability(SSD.PatchSupport, {
          source: "Text/Turtle",
          patchType: ["TEXT/N3", "text/n3"],
          format: { "ignored/type": ["ignored/patch"] },
        }),
        capability(SSD.PatchSupport, {
          source: "text/turtle",
          patchType: "application/sparql-update",
        }),
        capability(SSD.PatchSupport, {
          source: "application/json",
          patchType: "application/json-patch+json",
        }),
      ],
    });
    expect(deriveFeatures(d).patch.detail.formats).toEqual({
      "text/turtle": ["text/n3", "application/sparql-update"],
      "application/json": ["application/json-patch+json"],
    });
  });
});

describe("draft feature semantics with T-014 protocol defaults", () => {
  test.each([
    "solid",
    "lws",
  ] as const)("omitted entries on %s never mean unavailable", (protocol) => {
    for (const sources of [
      [],
      ["probe"],
      [protocol === "solid" ? "solid-description" : "lws-cid"],
    ] as StorageDescription["sources"][]) {
      const d = description({ protocol, sources });
      const features = deriveFeatures(d);
      // These derive from protocol guarantees or client emulation, rather than omissions.
      const baseline =
        protocol === "solid" ? ["typeIndex", "move", "rdfConneg"] : ["patch", "pagination"];
      for (const [name, feature] of Object.entries(features)) {
        if (name !== "protocol" && !baseline.includes(name))
          expect(feature.state, name).toBe("unknown");
      }
    }
  });

  test.each([
    [SSD.SparqlQueryService, "serverSearch", ACQ.profile],
    [SSD.CrdtSyncService, "realtimeCollab", SSD.yProtocolV1],
    [LWS.AccessRequestService, "accessRequests", LWS.AccessProfile],
    [LWS.AccessGrantService, "accessGrants", LWS.AccessProfile],
  ] as const)("%s requires at least one implemented profile", (type, name, profile) => {
    for (const conformsTo of [undefined, [], ["urn:unsupported"]]) {
      const result = deriveFeatures(
        description({
          services: [{ type: [type], endpoint: `${ROOT}service`, conformsTo, extra: {} }],
        }),
      )[name];
      expect(result.state).toBe("unknown");
      expect(result.detail).not.toHaveProperty("endpoint");
    }
    const services = [
      { type: [type], endpoint: `${ROOT}unsupported`, extra: {} },
      {
        type: [type],
        endpoint: `${ROOT}supported`,
        conformsTo: ["urn:future", profile],
        extra: {},
      },
    ];
    expect(deriveFeatures(description({ services }))[name]).toMatchObject({
      state: "available",
      detail: { endpoint: `${ROOT}supported` },
    });
  });

  test.each([
    { source: [], patchType: "text/n3" },
    { source: ["text/turtle", "application/json"], patchType: "text/n3" },
    { source: "text/turtle" },
    { source: "text/turtle", patchType: [] },
    { source: "bad", patchType: "text/n3" },
    { source: "text/turtle", patchType: [null, "bad", "text/n3;parameter=1"] },
  ])("malformed flat patch metadata cannot fall back: %j", (extra) => {
    const d = description({
      capabilities: [
        capability(SSD.PatchSupport, { ...extra, format: { "text/turtle": "text/n3" } }),
      ],
    });
    expect(deriveFeatures(d).patch.state).toBe("unknown");
  });

  test("unknown service/capability IRIs and deprecated RecursiveDelete have no known behaviour", () => {
    const d = description({
      services: [
        {
          type: ["https://other.example/SparqlQueryService"],
          endpoint: `${ROOT}query`,
          conformsTo: [ACQ.profile],
          extra: {},
        },
      ],
      capabilities: [
        capability(SSD.RecursiveDelete),
        capability("https://other.example/PatchSupport", {
          source: "text/turtle",
          patchType: "text/n3",
        }),
        capability("https://other.example/ResumableUploads"),
        capability("https://other.example/ContentNegotiation", {
          source: "text/turtle",
          target: "application/ld+json",
        }),
      ],
    });
    const features = deriveFeatures(d);
    for (const name of ["serverSearch", "recursiveDelete", "patch", "resumableUploads"] as const)
      expect(features[name].state).toBe("unknown");
    expect(deriveFeatures({ ...d, protocol: "lws" }).rdfConneg.state).toBe("unknown");
  });

  test("compact CID scoped terms, recursive service and profile-bearing capabilities", () => {
    const d = parseLwsDescription(
      {
        id: ROOT,
        type: "Storage",
        service: [
          { type: "StorageRoot", serviceEndpoint: ROOT },
          {
            type: "SolidNotificationService",
            serviceEndpoint: `${ROOT}notify`,
            channelType: "WebSocketChannel2023",
          },
          { type: "RecursiveDeleteService", serviceEndpoint: `${ROOT}delete` },
        ],
        capability: [
          { type: "AccessControl", model: ["WAC", "ACP", "urn:unknown"] },
          { type: "ResumableUploads", conformsTo: ["https://tus.io/protocols/resumable-upload"] },
          { type: "Pagination" },
        ],
      },
      ROOT,
      ROOT,
    );
    expect(d.services[1]?.extra.channelType).toBe(NOTIFY.WebSocketChannel2023);
    expect(d.capabilities[0]?.extra.model).toEqual([SSD.WAC, SSD.ACP, "urn:unknown"]);
    expect(deriveFeatures(d)).toMatchObject({
      liveUpdates: { state: "available" },
      recursiveDelete: { state: "available" },
      resumableUploads: { state: "available" },
    });
    // The same capability works on Solid, including its optional paging extension.
    expect(deriveFeatures({ ...d, protocol: "solid" })).toMatchObject({
      accessControl: { detail: { model: "acp" } },
      pagination: { state: "available" },
    });
    for (const extra of [{}, { conformsTo: "urn:future" }]) {
      expect(
        deriveFeatures(description({ capabilities: [capability(SSD.ResumableUploads, extra)] }))
          .resumableUploads.state,
      ).toBe("unknown");
    }
    expect(
      deriveFeatures(
        description({
          capabilities: [
            capability(SSD.ResumableUploads, {
              conformsTo: "https://tus.io/protocols/resumable-upload",
            }),
          ],
        }),
      ).resumableUploads.state,
    ).toBe("available");
  });

  test("notification merging preserves shared extensions on the same RDF node", async () => {
    const d = await solid(`<> notify:subscription <notify> ; did:service <notify> .
      <notify> a ssd:SolidNotificationService ; did:serviceEndpoint <notify> ;
        notify:channelType notify:WebSocketChannel2023 ; <urn:extra> [ <urn:value> "kept" ] .`);
    expect(d.services).toHaveLength(1);
    expect(d.services[0]?.extra["urn:extra"]).toMatchObject({ "urn:value": "kept" });
  });

  test("multiple channel IRIs remain usable; scoped CID unknown extras are preserved", async () => {
    const d =
      await solid(`<> did:service [ a ssd:SolidNotificationService ; did:serviceEndpoint <notify> ;
      notify:channelType notify:WebSocketChannel2023, notify:StreamingHTTPChannel2023 ] .`);
    expect(deriveFeatures(d).liveUpdates.detail.channels).toEqual(["websocket", "sse"]);
    const cid = parseLwsDescription(
      {
        id: ROOT,
        type: "Storage",
        service: [
          { type: "StorageRoot", serviceEndpoint: ROOT },
          {
            type: "FutureService",
            serviceEndpoint: `${ROOT}future`,
            channelType: { toString: "kept" },
            model: 42,
          },
        ],
      },
      ROOT,
      ROOT,
    );
    expect(cid.services[1]?.extra).toEqual({ channelType: { toString: "kept" }, model: 42 });
  });
});
