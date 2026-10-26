// AUTHORED-BY Claude Opus 5.5
import fc from "fast-check";
import { describe, expect, test } from "vitest";
import { deriveFeatures } from "./features.js";
import { parseLwsDescription } from "./lws-description.js";
import { sparqLwsCid } from "./testing.js";
import type { CapabilityEntry, ProbeResult, ServiceEntry, StorageDescription } from "./types.js";
import { LWS, NOTIFY, SSD } from "./vocab.js";

const SSD_NS = "https://jeswr.org/ns/solid-sd#";
const SOLID_ROOT = "https://pod.example/";
const LWS_ROOT = "https://lws.example/";

function solid(
  services: ServiceEntry[] = [],
  capabilities: CapabilityEntry[] = [],
  extra: Partial<StorageDescription> = {},
): StorageDescription {
  return {
    protocol: "solid",
    id: SOLID_ROOT,
    root: SOLID_ROOT,
    descriptionUrl: `${SOLID_ROOT}.well-known/solid`,
    services,
    capabilities,
    sources: ["solid-description"],
    fetchedAt: 0,
    etag: null,
    maxAgeMs: 3_600_000,
    verificationMethods: [],
    ...extra,
  };
}

function lws(
  services: ServiceEntry[] = [],
  capabilities: CapabilityEntry[] = [],
): StorageDescription {
  return {
    ...solid(services, capabilities),
    protocol: "lws",
    id: `${LWS_ROOT}.well-known/storage`,
    root: LWS_ROOT,
    descriptionUrl: `${LWS_ROOT}.well-known/storage`,
    sources: ["lws-cid"],
  };
}

const legacy = solid(
  [
    {
      type: [SSD.SolidNotificationService, SSD.LegacyUpdatesVia],
      endpoint: "wss://pod.example/",
      extra: {},
    },
  ],
  [],
  { descriptionUrl: null, sources: ["probe"] },
);

const probe = (fields: Partial<ProbeResult>): ProbeResult => ({
  url: SOLID_ROOT,
  observedAt: 0,
  evidence: [],
  ...fields,
});

const notify = (channel: string, endpoint = `${SOLID_ROOT}ws`): ServiceEntry => ({
  type: [SSD.SolidNotificationService, channel],
  endpoint,
  extra: { [NOTIFY.channelType]: channel, [NOTIFY.feature]: [] },
});

const sparq = parseLwsDescription(sparqLwsCid, sparqLwsCid.id, `${LWS_ROOT}data`);

describe("deriveFeatures: one case per ADR-002 mapping row", () => {
  test("liveUpdates: Solid websocket/streaming, LWS subscription types, legacy, webhook-only, absent", () => {
    expect(
      deriveFeatures(
        solid([
          notify(NOTIFY.WebhookChannel2023, `${SOLID_ROOT}hook`),
          notify(NOTIFY.StreamingHTTPChannel2023, `${SOLID_ROOT}stream`),
          notify(NOTIFY.WebSocketChannel2023),
        ]),
      ).liveUpdates,
    ).toEqual({
      state: "available",
      evidence: `solid-description:WebSocketChannel2023:${SOLID_ROOT}ws`,
      detail: { channels: ["websocket", "sse"], endpoint: `${SOLID_ROOT}ws` },
    });
    // ADR-008 did:service form with ssd:channelType, and the ssd streaming alias.
    expect(
      deriveFeatures(
        solid([
          {
            type: [SSD.SolidNotificationService],
            endpoint: `${SOLID_ROOT}s`,
            extra: { [`${SSD_NS}channelType`]: SSD.StreamingHttpChannel },
          },
        ]),
      ).liveUpdates.detail,
    ).toEqual({ channels: ["sse"], endpoint: `${SOLID_ROOT}s` });
    expect(
      deriveFeatures(
        lws([
          {
            type: [LWS.NotificationService],
            endpoint: `${LWS_ROOT}n/`,
            extra: {
              subscriptionType: [
                LWS.WebhookSubscription,
                SSD.SseSubscription,
                SSD.WebSocketSubscription,
              ],
            },
          },
        ]),
      ).liveUpdates,
    ).toEqual({
      state: "available",
      evidence: `lws-cid:WebSocketSubscription:${LWS_ROOT}n/`,
      detail: { channels: ["websocket", "sse", "webhook"], endpoint: `${LWS_ROOT}n/` },
    });
    expect(deriveFeatures(sparq).liveUpdates).toEqual({
      state: "available",
      evidence: `lws-cid:WebhookSubscription:${LWS_ROOT}notifications/`,
      detail: { channels: ["webhook"], endpoint: `${LWS_ROOT}notifications/` },
    });
    expect(deriveFeatures(legacy).liveUpdates).toEqual({
      state: "available",
      evidence: "probe:LegacyUpdatesVia:wss://pod.example/",
      detail: { channels: ["legacy-ws"], endpoint: "wss://pod.example/" },
    });
    expect(deriveFeatures(solid()).liveUpdates).toEqual({
      state: "unavailable",
      evidence: "solid-description:absent:SolidNotificationService",
      detail: { channels: [] },
    });
    // Solid webhooks/LDN need a server-side receiver: present but not browser-consumable.
    expect(deriveFeatures(solid([notify(NOTIFY.LDNChannel2023)])).liveUpdates).toEqual({
      state: "unavailable",
      evidence: "solid-description:unsupported-channels",
      detail: { channels: [] },
    });
    expect(
      deriveFeatures({ ...solid(), descriptionUrl: null, sources: ["probe"] }).liveUpdates.state,
    ).toBe("unknown");
  });

  test("realtimeCollab: CrdtSyncService with y-protocol-v1 only", () => {
    const crdt = (conformsTo: string[]): ServiceEntry => ({
      type: [SSD.CrdtSyncService],
      endpoint: `${SOLID_ROOT}.sync/tickets`,
      conformsTo,
      extra: {},
    });
    expect(deriveFeatures(solid([crdt([`${SSD_NS}y-protocol-v1`])])).realtimeCollab).toEqual({
      state: "available",
      evidence: `solid-description:CrdtSyncService:${SOLID_ROOT}.sync/tickets`,
      detail: { endpoint: `${SOLID_ROOT}.sync/tickets`, protocols: [`${SSD_NS}y-protocol-v1`] },
    });
    expect(deriveFeatures(solid([crdt(["urn:other"])])).realtimeCollab).toEqual({
      state: "unavailable",
      evidence: "solid-description:absent:CrdtSyncService",
      detail: { protocols: [] },
    });
    expect(deriveFeatures(legacy).realtimeCollab).toEqual({
      state: "unknown",
      evidence: "none",
      detail: { protocols: [] },
    });
  });

  test("serverSearch: SparqlQueryService on Solid (ACQ) and LWS, else unavailable", () => {
    const sparql = { type: [SSD.SparqlQueryService], endpoint: `${SOLID_ROOT}sparql`, extra: {} };
    expect(deriveFeatures(solid([sparql])).serverSearch).toEqual({
      state: "available",
      evidence: `solid-description:SparqlQueryService:${SOLID_ROOT}sparql`,
      detail: { endpoint: `${SOLID_ROOT}sparql` },
    });
    expect(
      deriveFeatures(lws([{ ...sparql, endpoint: `${LWS_ROOT}sparql` }])).serverSearch.state,
    ).toBe("available");
    // ADR-008 §8: a foreign endpoint is not trusted.
    expect(deriveFeatures(lws([sparql])).serverSearch.state).toBe("unavailable");
    expect(deriveFeatures(sparq).serverSearch).toEqual({
      state: "unavailable",
      evidence: "lws-cid:absent:SparqlQueryService",
      detail: {},
    });
  });

  test("typeIndex: LWS server with both services; Solid client", () => {
    expect(deriveFeatures(sparq).typeIndex).toEqual({
      state: "available",
      evidence: `lws-cid:TypeIndexService:${LWS_ROOT}type-index/`,
      detail: {
        mode: "server",
        indexEndpoint: `${LWS_ROOT}type-index/`,
        searchEndpoint: `${LWS_ROOT}type-search/`,
      },
    });
    expect(
      deriveFeatures(lws([{ type: [LWS.TypeIndexService], endpoint: `${LWS_ROOT}ti/`, extra: {} }]))
        .typeIndex,
    ).toEqual({
      state: "unavailable",
      evidence: "lws-cid:absent:TypeSearchService",
      detail: { mode: "server", indexEndpoint: `${LWS_ROOT}ti/` },
    });
    expect(deriveFeatures(lws()).typeIndex.evidence).toBe("lws-cid:absent:TypeIndexService");
    expect(deriveFeatures(solid()).typeIndex).toEqual({
      state: "available",
      evidence: "solid-description:client-type-index",
      detail: { mode: "client" },
    });
  });

  test("accessRequests / accessGrants: LWS services with profiles; Solid needs the ssd services", () => {
    expect(deriveFeatures(sparq).accessRequests).toEqual({
      state: "available",
      evidence: `lws-cid:AccessRequestService:${LWS_ROOT}access-requests/`,
      detail: { endpoint: `${LWS_ROOT}access-requests/`, profiles: [LWS.AccessProfile] },
    });
    expect(deriveFeatures(sparq).accessGrants.detail).toEqual({
      endpoint: `${LWS_ROOT}access-grants/`,
      profiles: [LWS.AccessProfile],
    });
    expect(deriveFeatures(solid()).accessRequests).toEqual({
      state: "unavailable",
      evidence: "solid-description:absent:AccessRequestService",
      detail: { profiles: [] },
    });
    const ssdGrants = solid([
      { type: [`${SSD_NS}AccessGrantService`], endpoint: `${SOLID_ROOT}grants/`, extra: {} },
    ]);
    expect(deriveFeatures(ssdGrants).accessGrants).toEqual({
      state: "available",
      evidence: `solid-description:AccessGrantService:${SOLID_ROOT}grants/`,
      detail: { endpoint: `${SOLID_ROOT}grants/`, profiles: [] },
    });
    expect(deriveFeatures(lws()).accessGrants.evidence).toBe("lws-cid:absent:AccessGrantService");
  });

  test("accessControl: LWS grants, Solid capability, then probe acp > wac", () => {
    expect(deriveFeatures(sparq).accessControl).toEqual({
      state: "available",
      evidence: `lws-cid:AccessGrantService:${LWS_ROOT}access-grants/`,
      detail: { model: "odrl-grants" },
    });
    expect(deriveFeatures(lws()).accessControl).toEqual({
      state: "unavailable",
      evidence: "lws-cid:absent:AccessGrantService",
      detail: { model: "none" },
    });
    const declared = (...models: string[]) =>
      solid([], [{ type: [SSD.AccessControl], extra: { [`${SSD_NS}model`]: models } }]);
    expect(deriveFeatures(declared(`${SSD_NS}WAC`, `${SSD_NS}ACP`)).accessControl).toEqual({
      state: "available",
      evidence: "solid-description:AccessControl",
      detail: { model: "acp" },
    });
    expect(deriveFeatures(declared(`${SSD_NS}WAC`)).accessControl.detail.model).toBe("wac");
    expect(deriveFeatures(declared(`${SSD_NS}ODRLGrants`)).accessControl.detail.model).toBe(
      "odrl-grants",
    );
    // An unrecognised model falls through to the probe.
    const both = probe({ acpLink: `${SOLID_ROOT}?ext=acr`, aclLink: `${SOLID_ROOT}.acl` });
    expect(deriveFeatures(declared("urn:x"), both).accessControl).toEqual({
      state: "available",
      evidence: "header:Link",
      detail: { model: "acp" },
    });
    expect(deriveFeatures(solid(), probe({ aclLink: `${SOLID_ROOT}.acl` })).accessControl).toEqual({
      state: "available",
      evidence: "header:Link",
      detail: { model: "wac" },
    });
    expect(
      deriveFeatures(solid(), probe({ wacAllow: { user: ["read"], public: [] } })).accessControl,
    ).toEqual({ state: "available", evidence: "header:WAC-Allow", detail: { model: "wac" } });
    expect(deriveFeatures(solid(), probe({})).accessControl).toEqual({
      state: "unknown",
      evidence: "header:none",
      detail: { model: "none" },
    });
    expect(deriveFeatures(solid()).accessControl).toEqual({
      state: "unknown",
      evidence: "none",
      detail: { model: "none" },
    });
  });

  test("versioning / trash: ssd services, else unavailable when described", () => {
    const d = solid([
      { type: [SSD.VersioningService], endpoint: `${SOLID_ROOT}v/{resource}`, extra: {} },
      { type: [SSD.TrashService], endpoint: `${SOLID_ROOT}trash/`, extra: {} },
    ]);
    expect(deriveFeatures(d).versioning).toEqual({
      state: "available",
      evidence: `solid-description:VersioningService:${SOLID_ROOT}v/{resource}`,
      detail: { endpoint: `${SOLID_ROOT}v/{resource}` },
    });
    expect(deriveFeatures(d).trash.detail).toEqual({ endpoint: `${SOLID_ROOT}trash/` });
    expect(deriveFeatures(sparq).trash).toEqual({
      state: "unavailable",
      evidence: "lws-cid:absent:TrashService",
      detail: {},
    });
    expect(deriveFeatures(legacy).versioning.state).toBe("unknown");
  });

  test("move: LWS MoveResource capability, LWS without it, Solid emulation", () => {
    const moveCapability = (extra: Record<string, unknown>) =>
      lws([], [{ type: [LWS.MoveResource], extra }]);
    expect(
      deriveFeatures(
        moveCapability({ appliesTo: ["DataResource", "Container"], preservesIdentifier: false }),
      ).move,
    ).toEqual({
      state: "available",
      evidence: "lws-cid:MoveResource",
      detail: { native: true, containers: true, preservesIdentifier: false },
    });
    expect(
      deriveFeatures(
        moveCapability({ [LWS.appliesTo]: LWS.Storage, [LWS.preservesIdentifier]: "true" }),
      ).move.detail,
    ).toEqual({ native: true, containers: false, preservesIdentifier: true });
    expect(deriveFeatures(moveCapability({ preservesIdentifier: "false" })).move.detail).toEqual({
      native: true,
      containers: false,
      preservesIdentifier: false,
    });
    expect(deriveFeatures(moveCapability({ preservesIdentifier: true })).move.detail).toEqual({
      native: true,
      containers: false,
      preservesIdentifier: true,
    });
    expect(deriveFeatures(moveCapability({})).move.detail.preservesIdentifier).toBeNull();
    expect(deriveFeatures(sparq).move).toEqual({
      state: "unavailable",
      evidence: "lws-cid:absent:MoveResource",
      detail: { native: false, containers: false, preservesIdentifier: null },
    });
    expect(deriveFeatures(solid()).move).toEqual({
      state: "available",
      evidence: "emulated",
      detail: { native: false, containers: true, preservesIdentifier: false },
    });
  });

  test("patch: LWS PatchSupport map + JSON Patch baseline; Solid capability, Accept-Patch, default", () => {
    expect(
      deriveFeatures(
        lws(
          [],
          [
            {
              type: ["https://example.org/ext#PatchSupport"],
              extra: {
                format: {
                  "text/turtle": ["text/n3", "application/sparql-update"],
                  "application/json": "application/merge-patch+json",
                  ignored: ["x"],
                },
              },
            },
          ],
        ),
      ).patch,
    ).toEqual({
      state: "available",
      evidence: "lws-cid:PatchSupport",
      detail: {
        formats: {
          "text/turtle": ["text/n3", "application/sparql-update"],
          "application/json": ["application/merge-patch+json", "application/json-patch+json"],
          "application/linkset+json": ["application/json-patch+json"],
        },
      },
    });
    expect(deriveFeatures(sparq).patch).toEqual({
      state: "available",
      evidence: "lws-cid:baseline",
      detail: {
        formats: {
          "application/linkset+json": ["application/json-patch+json"],
          "application/json": ["application/json-patch+json"],
        },
      },
    });
    // ADR-008 RDF form: ssd:format [ ssd:source …; ssd:patchType … ] (repeated, with junk).
    const rdfPatch = solid(
      [],
      [
        {
          type: [SSD.PatchSupport],
          extra: {
            [`${SSD_NS}format`]: [
              {
                "@id": "_:b0",
                [`${SSD_NS}source`]: "text/turtle",
                [`${SSD_NS}patchType`]: ["text/n3", "application/sparql-update"],
              },
              { [`${SSD_NS}source`]: "text/turtle", [`${SSD_NS}patchType`]: "TEXT/N3" },
              { [`${SSD_NS}source`]: 3, [`${SSD_NS}patchType`]: "text/n3" },
              { [`${SSD_NS}source`]: "application/json" },
              "not a node",
            ],
          },
        },
      ],
    );
    expect(deriveFeatures(rdfPatch).patch).toEqual({
      state: "available",
      evidence: "solid-description:PatchSupport",
      detail: { formats: { "text/turtle": ["text/n3", "application/sparql-update"] } },
    });
    expect(
      deriveFeatures(
        solid(),
        probe({ acceptPatch: ["text/n3", "application/sparql-update", "text/n3"] }),
      ).patch,
    ).toEqual({
      state: "available",
      evidence: "header:Accept-Patch",
      detail: { formats: { "text/turtle": ["text/n3", "application/sparql-update"] } },
    });
    expect(deriveFeatures(solid(), probe({ acceptPatch: [] })).patch).toEqual({
      state: "available",
      evidence: "default:n3-patch",
      detail: { formats: { "text/turtle": ["text/n3"] } },
    });
    // An empty PatchSupport capability does not stop probing.
    expect(deriveFeatures(solid([], [{ type: [SSD.PatchSupport], extra: {} }])).patch).toEqual({
      state: "unknown",
      evidence: "none",
      detail: { formats: { "text/turtle": ["text/n3"] } },
    });
  });

  test("resumableUploads / recursiveDelete by capability local name; pagination by protocol", () => {
    const d = lws(
      [],
      [
        { type: ["https://example.org/ext#ResumableUploads"], extra: {} },
        { type: [SSD.RecursiveDelete], extra: {} },
      ],
    );
    expect(deriveFeatures(d).resumableUploads).toEqual({
      state: "available",
      evidence: "lws-cid:ResumableUploads",
      detail: undefined,
    });
    expect(deriveFeatures(d).recursiveDelete.state).toBe("available");
    expect(deriveFeatures(sparq).recursiveDelete).toEqual({
      state: "unavailable",
      evidence: "lws-cid:absent:RecursiveDelete",
      detail: undefined,
    });
    expect(deriveFeatures(legacy).resumableUploads.state).toBe("unknown");
    expect(deriveFeatures(sparq).pagination).toEqual({
      state: "available",
      evidence: "lws-cid:lws-paging",
      detail: undefined,
    });
    expect(deriveFeatures(solid()).pagination).toEqual({
      state: "unavailable",
      evidence: "solid-description:solid-no-paging",
      detail: undefined,
    });
  });

  test("rdfConneg: Solid always; LWS only with an RDF ContentNegotiation capability", () => {
    expect(deriveFeatures(solid()).rdfConneg).toEqual({
      state: "available",
      evidence: "solid-description:solid-conneg",
      detail: { formats: ["text/turtle", "application/ld+json"] },
    });
    expect(deriveFeatures(sparq).rdfConneg).toEqual({
      state: "unavailable",
      evidence: "lws-cid:opaque-bodies",
      detail: { formats: [] },
    });
    const conneg = lws(
      [],
      [
        {
          type: [`${SSD_NS}ContentNegotiation`],
          extra: { source: "image/png", target: "image/webp" },
        },
        {
          type: [`${SSD_NS}ContentNegotiation`],
          extra: {
            [`${SSD_NS}source`]: "Text/Turtle",
            [`${SSD_NS}target`]: ["application/ld+json", "application/n-triples"],
          },
        },
      ],
    );
    expect(deriveFeatures(conneg).rdfConneg).toEqual({
      state: "available",
      evidence: "lws-cid:ContentNegotiation",
      detail: { formats: ["text/turtle", "application/ld+json", "application/n-triples"] },
    });
  });
});

describe("deriveFeatures trust and robustness", () => {
  test("a cross-origin Solid description only contributes notifications", () => {
    const d = solid(
      [
        notify(NOTIFY.WebSocketChannel2023),
        { type: [SSD.SparqlQueryService], endpoint: "https://evil.example/q", extra: {} },
      ],
      [{ type: [SSD.AccessControl], extra: { [`${SSD_NS}model`]: `${SSD_NS}WAC` } }],
      { evidence: ["cross-origin-description"] },
    );
    const features = deriveFeatures(d);
    expect(features.liveUpdates.state).toBe("available");
    expect(features.serverSearch.state).toBe("unavailable");
    expect(features.accessControl.state).toBe("unknown");
    expect(features.versioning.state).toBe("unknown");
  });

  test("legacy-ws is never read from description content", () => {
    const d = solid([
      {
        type: [SSD.SolidNotificationService],
        endpoint: "https://pod.example/x",
        extra: { [NOTIFY.channelType]: SSD.LegacyUpdatesVia },
      },
    ]);
    expect(deriveFeatures(d).liveUpdates.detail.channels).toEqual([]);
  });

  test("unknown service types are preserved upstream and ignored here", () => {
    const d = lws([{ type: ["https://x.example/Foo"], endpoint: "https://x.example/", extra: {} }]);
    expect(deriveFeatures(d)).toEqual(deriveFeatures(lws()));
  });

  test("is deterministic and never throws for arbitrary entries (property)", () => {
    const entry = fc.record({
      type: fc.oneof(
        fc.array(
          fc.oneof(
            fc.constantFrom(
              ...Object.values(SSD),
              ...Object.values(LWS),
              ...Object.values(NOTIFY),
              `${SSD_NS}AccessGrantService`,
            ),
            fc.string(),
          ),
        ),
        fc.anything({ maxDepth: 2, maxKeys: 4 }),
      ),
      endpoint: fc.oneof(fc.webUrl(), fc.string()),
      conformsTo: fc.option(fc.array(fc.string()), { nil: undefined }),
      extra: fc.oneof(
        fc.dictionary(fc.string(), fc.anything({ maxDepth: 2, maxKeys: 4 })),
        fc.constant(undefined),
        fc.record({
          format: fc.oneof(
            fc.record({
              source: fc.constantFrom("constructor", "__proto__", "toString", "text/turtle"),
              patchType: fc.oneof(fc.string(), fc.array(fc.string())),
            }),
            fc.dictionary(
              fc.constantFrom("constructor", "__proto__", "hasOwnProperty", "text/turtle", "a/b"),
              fc.anything({ maxDepth: 2, maxKeys: 4 }),
            ),
          ),
          model: fc.oneof(fc.string(), fc.constantFrom(`${SSD_NS}ACP`, `${SSD_NS}WAC`)),
        }),
      ),
    });
    fc.assert(
      fc.property(
        fc.constantFrom("solid", "lws"),
        fc.array(entry),
        fc.array(entry),
        fc.option(
          fc.record({
            acceptPatch: fc.array(fc.string()),
            aclLink: fc.option(fc.webUrl(), { nil: undefined }),
          }),
          { nil: undefined },
        ),
        (protocol, services, capabilities, fields) => {
          const d = {
            ...(protocol === "lws" ? lws() : solid()),
            services,
            capabilities,
          } as unknown as StorageDescription;
          const p = fields ? probe(fields) : undefined;
          const features = deriveFeatures(d, p);
          expect(features.protocol).toBe(protocol);
          expect(deriveFeatures(d, p)).toEqual(features);
        },
      ),
      { numRuns: 200 },
    );
  }, 30_000);

  test("the first service offering a channel supplies its endpoint", () => {
    const d = solid([
      notify(NOTIFY.WebSocketChannel2023, `${SOLID_ROOT}a`),
      notify(NOTIFY.WebSocketChannel2023, `${SOLID_ROOT}b`),
    ]);
    expect(deriveFeatures(d).liveUpdates.detail.endpoint).toBe(`${SOLID_ROOT}a`);
  });

  test("an LWS description without a description document is not authoritative", () => {
    const d = {
      ...lws(
        [
          {
            type: [LWS.NotificationService],
            endpoint: `${LWS_ROOT}n/`,
            extra: { subscriptionType: [LWS.WebhookSubscription] },
          },
        ],
        [{ type: [LWS.MoveResource], extra: {} }],
      ),
      descriptionUrl: null,
      sources: ["probe" as const],
    };
    const features = deriveFeatures(d);
    expect(features.move.state).toBe("unknown");
    expect(features.rdfConneg.state).toBe("unavailable");
    expect(features.liveUpdates.state).toBe("unknown");
  });

  test("prototype-named and malformed PatchSupport keys never throw or pollute", () => {
    for (const format of [
      { source: "constructor", patchType: "text/n3" },
      { source: "__proto__", patchType: "text/n3" },
      JSON.parse(
        '{"__proto__": ["text/n3"], "constructor": "text/n3", "text/turtle": ["bad type", "text/n3"]}',
      ),
    ]) {
      const d = solid([], [{ type: [SSD.PatchSupport], extra: { format } }]);
      const features = deriveFeatures(d);
      expect(Object.getPrototypeOf(features.patch.detail.formats)).toBe(Object.prototype);
      expect(Object.keys(features.patch.detail.formats).every((key) => key.includes("/"))).toBe(
        true,
      );
    }
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  test("unknown IRIs never acquire known semantics by local name", () => {
    const acpLookalike = solid(
      [],
      [{ type: [SSD.AccessControl], extra: { [`${SSD_NS}model`]: "https://x.example/ACP" } }],
    );
    expect(deriveFeatures(acpLookalike).accessControl.state).toBe("unknown");
    const moveLookalike = lws([], [{ type: ["https://x.example/MoveResource"], extra: {} }]);
    expect(deriveFeatures(moveLookalike).move.state).toBe("unavailable");
  });

  test("a described storage cannot forge legacy-ws through rdf:type", () => {
    const d = solid([
      {
        type: [SSD.SolidNotificationService, SSD.LegacyUpdatesVia],
        endpoint: "wss://evil.example/",
        extra: {},
      },
    ]);
    expect(deriveFeatures(d).liveUpdates).toMatchObject({
      state: "unavailable",
      detail: { channels: [] },
    });
  });

  test("a service typed for both Solid and LWS notifications keeps every channel", () => {
    const d = lws([
      {
        type: [SSD.SolidNotificationService, LWS.NotificationService],
        endpoint: `${LWS_ROOT}n/`,
        extra: { subscriptionType: LWS.WebhookSubscription },
      },
    ]);
    expect(deriveFeatures(d).liveUpdates).toMatchObject({
      state: "available",
      detail: { channels: ["webhook"] },
    });
  });

  test("results never share mutable state between calls", () => {
    const first = deriveFeatures(solid());
    first.rdfConneg.detail.formats.push("text/plain");
    (first.patch.detail.formats as Record<string, string[]>)["text/turtle"]?.push("x/y");
    const second = deriveFeatures(solid());
    expect(second.rdfConneg.detail.formats).toEqual(["text/turtle", "application/ld+json"]);
    expect(second.patch.detail.formats).toEqual({ "text/turtle": ["text/n3"] });
  });

  test("round-2 regressions: predicate keys, unions, foreign endpoints, huge arrays", () => {
    // Only ssd:/lws: (or bare) keys carry meaning; an unrelated predicate is ignored.
    const unrelated = solid(
      [],
      [{ type: [SSD.AccessControl], extra: { "https://unrelated.example/model": `${SSD_NS}ACP` } }],
    );
    expect(deriveFeatures(unrelated).accessControl.detail.model).toBe("none");
    // Models are unioned across every AccessControl capability, in any order.
    const reordered = solid(
      [],
      [
        { type: [SSD.AccessControl], extra: { [`${SSD_NS}model`]: "urn:x" } },
        { type: [SSD.AccessControl], extra: { [`${SSD_NS}model`]: `${SSD_NS}ACP` } },
      ],
    );
    expect(deriveFeatures(reordered).accessControl.detail.model).toBe("acp");
    // PatchSupport formats are unioned across capabilities.
    const patches = lws(
      [],
      [
        { type: [SSD.PatchSupport], extra: { format: { "text/turtle": "text/n3" } } },
        {
          type: [SSD.PatchSupport],
          extra: { format: { "text/turtle": "application/sparql-update" } },
        },
      ],
    );
    expect(deriveFeatures(patches).patch.detail.formats["text/turtle"]).toEqual([
      "text/n3",
      "application/sparql-update",
    ]);
    // ADR-008 §8: foreign LWS notification and CRDT endpoints are not trusted.
    const foreign = lws([
      {
        type: [LWS.NotificationService],
        endpoint: "https://evil.example/n/",
        extra: { subscriptionType: [SSD.WebSocketSubscription] },
      },
      {
        type: [SSD.CrdtSyncService],
        endpoint: "https://evil.example/sync",
        conformsTo: [`${SSD_NS}y-protocol-v1`],
        extra: {},
      },
    ]);
    expect(deriveFeatures(foreign).liveUpdates.state).toBe("unavailable");
    expect(deriveFeatures(foreign).realtimeCollab.state).toBe("unavailable");
    // An SSE-only LWS service.
    const sse = lws([
      {
        type: [LWS.NotificationService],
        endpoint: `${LWS_ROOT}n/`,
        extra: { subscriptionType: SSD.SseSubscription },
      },
    ]);
    expect(deriveFeatures(sse).liveUpdates.detail.channels).toEqual(["sse"]);
    const bare = lws([{ type: [LWS.NotificationService], endpoint: `${LWS_ROOT}n/` }]);
    expect(deriveFeatures(bare).liveUpdates.state).toBe("unavailable");
    // A huge value array must not overflow the stack (no spread into push).
    const huge = lws([
      {
        type: [LWS.NotificationService],
        endpoint: `${LWS_ROOT}n/`,
        extra: { subscriptionType: Array.from({ length: 150_000 }, () => LWS.WebhookSubscription) },
      },
    ]);
    expect(() => deriveFeatures(huge)).not.toThrow();
    expect(deriveFeatures(huge).liveUpdates.detail.channels).toEqual(["webhook"]);
  });

  test("round-3 regressions: linear PatchSupport parsing and shared format nodes", () => {
    const n = 20_000;
    const flood = solid(
      [],
      [
        {
          type: [SSD.PatchSupport],
          extra: {
            [`${SSD_NS}format`]: {
              [`${SSD_NS}source`]: Array.from({ length: n }, () => "text/turtle"),
              [`${SSD_NS}patchType`]: Array.from({ length: n }, () => "text/n3"),
            },
          },
        },
      ],
    );
    const started = performance.now();
    expect(deriveFeatures(flood).patch.detail.formats).toEqual({ "text/turtle": ["text/n3"] });
    expect(performance.now() - started).toBeLessThan(2000);

    // The mapper expanded the format node under another predicate first; ssd:format is a reference.
    const shared = {
      "@id": "_:f",
      [`${SSD_NS}source`]: "text/turtle",
      [`${SSD_NS}patchType`]: "application/sparql-update",
    };
    const reordered = solid(
      [],
      [
        { type: ["urn:other"], extra: { "urn:p": [{ nested: shared }] } },
        { type: [SSD.PatchSupport], extra: { [`${SSD_NS}format`]: { "@id": "_:f" } } },
      ],
    );
    expect(deriveFeatures(reordered).patch).toMatchObject({
      state: "available",
      detail: { formats: { "text/turtle": ["application/sparql-update"] } },
    });
    // An unresolvable reference contributes nothing; the first expansion of an id wins.
    const dangling = solid(
      [],
      [
        { type: ["urn:other"], extra: { a: shared, b: { ...shared, [`${SSD_NS}source`]: "x/y" } } },
        {
          type: [SSD.PatchSupport],
          extra: { [`${SSD_NS}format`]: [{ "@id": "_:missing" }, { "@id": "_:f" }] },
        },
      ],
    );
    expect(deriveFeatures(dangling).patch.detail.formats).toEqual({
      "text/turtle": ["application/sparql-update"],
    });
  });

  test("round-4 regressions: repeated references read once; RDF/XML is an RDF source", () => {
    const n = 9_000;
    const shared = {
      "@id": "_:f",
      [`${SSD_NS}source`]: "text/turtle",
      [`${SSD_NS}patchType`]: Array.from({ length: n }, () => "text/n3"),
    };
    const references = solid(
      [],
      [
        { type: ["urn:other"], extra: { def: shared } },
        {
          type: [SSD.PatchSupport],
          extra: { [`${SSD_NS}format`]: Array.from({ length: n }, () => ({ "@id": "_:f" })) },
        },
        { type: [SSD.PatchSupport], extra: { [`${SSD_NS}format`]: { "@id": "_:f" } } },
      ],
    );
    const started = performance.now();
    expect(deriveFeatures(references).patch.detail.formats).toEqual({ "text/turtle": ["text/n3"] });
    expect(performance.now() - started).toBeLessThan(2000);

    const rdfXml = lws(
      [],
      [
        {
          type: [`${SSD_NS}ContentNegotiation`],
          extra: { source: "application/rdf+xml", target: "text/turtle" },
        },
      ],
    );
    expect(deriveFeatures(rdfXml).rdfConneg).toMatchObject({
      state: "available",
      detail: { formats: ["application/rdf+xml", "text/turtle"] },
    });
  });

  test("tolerates malformed descriptions without arrays", () => {
    const conneg = lws(
      [],
      [{ type: [`${SSD_NS}ContentNegotiation`] } as unknown as CapabilityEntry],
    );
    expect(deriveFeatures(conneg).rdfConneg.state).toBe("unavailable");
    const d = { ...solid(), services: undefined, capabilities: null, sources: undefined };
    expect(deriveFeatures(d as unknown as StorageDescription).protocol).toBe("solid");
  });
});
