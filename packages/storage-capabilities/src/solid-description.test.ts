// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { parseRdf } from "@jeswr/fetch-rdf";
import { describe, expect, test, vi } from "vitest";
import { deriveFeatures } from "./features.js";
import { parseSolidDescription } from "./solid-description.js";
import { LWS, NOTIFY, SSD } from "./vocab.js";

const ROOT = "https://pod.example/";
const SSD_NS = "https://jeswr.org/ns/solid-sd#";
const NOTIFY_NS = "http://www.w3.org/ns/solid/notifications#";
const CONTEXT_URL = "https://www.w3.org/ns/solid/notification/v1";
const PREFIXES = `
  @prefix lws: <https://www.w3.org/ns/lws#> .
  @prefix did: <https://www.w3.org/ns/did#> .
  @prefix ssd: <https://jeswr.org/ns/solid-sd#> .
  @prefix notify: <http://www.w3.org/ns/solid/notifications#> .
  @prefix dct: <http://purl.org/dc/terms/> .
  @prefix acq: <http://www.w3.org/ns/solid/sparql#> .
`;

async function turtle(body: string) {
  return parseRdf(PREFIXES + body, "text/turtle", { baseIRI: ROOT });
}

describe("parseSolidDescription", () => {
  test("maps a CSS /.well-known/solid JSON-LD description with two subscriptions", async () => {
    // CSS-style notification description. The remote context is supplied offline explicitly;
    // only terms used by this fixture are needed from the notification/v1 context.
    const documentLoader = {
      load: vi.fn(async (url: string) => {
        expect(url).toBe(CONTEXT_URL);
        return {
          "@context": {
            id: "@id",
            type: "@type",
            notify: NOTIFY_NS,
            subscription: { "@id": NOTIFY.subscription, "@type": "@id" },
            channelType: { "@id": NOTIFY.channelType, "@type": "@vocab" },
            feature: { "@id": NOTIFY.feature, "@type": "@vocab" },
          },
        };
      }),
    };
    const body = {
      "@context": [CONTEXT_URL],
      id: "https://pod.example/.well-known/solid",
      subscription: [
        {
          id: "/.notifications/WebSocketChannel2023/",
          channelType: "notify:WebSocketChannel2023",
          feature: [
            "notify:accept",
            "notify:endAt",
            "notify:rate",
            "notify:startAt",
            "notify:state",
          ],
        },
        {
          id: "/.notifications/StreamingHTTPChannel2023/",
          channelType: "notify:StreamingHTTPChannel2023",
          feature: ["notify:accept", "notify:state"],
        },
      ],
    };
    const dataset = await parseRdf(JSON.stringify(body), "application/ld+json", {
      baseIRI: "https://pod.example/.well-known/solid",
      documentLoader,
    });
    expect(documentLoader.load).toHaveBeenCalled();
    expect(parseSolidDescription(dataset, ROOT)).toEqual({
      services: [
        {
          type: [SSD.SolidNotificationService, NOTIFY.WebSocketChannel2023],
          endpoint: `${ROOT}.notifications/WebSocketChannel2023/`,
          extra: {
            [NOTIFY.channelType]: NOTIFY.WebSocketChannel2023,
            [NOTIFY.feature]: ["accept", "endAt", "rate", "startAt", "state"].map(
              (name) => NOTIFY_NS + name,
            ),
          },
        },
        {
          type: [SSD.SolidNotificationService, NOTIFY.StreamingHTTPChannel2023],
          endpoint: `${ROOT}.notifications/StreamingHTTPChannel2023/`,
          extra: {
            [NOTIFY.channelType]: NOTIFY.StreamingHTTPChannel2023,
            [NOTIFY.feature]: [`${NOTIFY_NS}accept`, `${NOTIFY_NS}state`],
          },
        },
      ],
      capabilities: [],
    });
  });

  test("maps ADR-008's Turtle example to four services and three capabilities", async () => {
    const dataset = await turtle(`
      @prefix pim: <http://www.w3.org/ns/pim/space#> .
      <https://pod.example/> a pim:Storage, lws:Storage ;
        did:service [ a lws:StorageRoot ; did:serviceEndpoint <https://pod.example/> ] ,
                    [ a ssd:SolidNotificationService ; did:serviceEndpoint <https://pod.example/.notifications/WebSocketChannel2023/> ;
                      ssd:channelType notify:WebSocketChannel2023 ] ,
                    [ a ssd:SparqlQueryService ; did:serviceEndpoint <https://pod.example/sparql> ;
                      dct:conformsTo <https://jeswr.github.io/solid-specs/specs/access-controlled-query/> ] ,
                    [ a ssd:CrdtSyncService ; did:serviceEndpoint <https://pod.example/.sync/tickets> ;
                      ssd:roomTemplate "wss://pod.example/.sync/rooms/{room}" ; dct:conformsTo <https://jeswr.org/ns/solid-sd#y-protocol-v1> ] ;
        lws:capability [ a ssd:AccessControl ; ssd:model ssd:WAC ] ,
                       [ a ssd:PatchSupport ; ssd:format [ ssd:source "text/turtle" ; ssd:patchType "text/n3", "application/sparql-update" ] ] ,
                       [ a ssd:RecursiveDelete ] .
    `);
    const before = [...dataset];
    const result = parseSolidDescription(dataset, ROOT);
    expect(result).toEqual({
      services: [
        { type: [LWS.StorageRoot], endpoint: ROOT, extra: {} },
        {
          type: [SSD.SolidNotificationService],
          endpoint: `${ROOT}.notifications/WebSocketChannel2023/`,
          extra: { [`${SSD_NS}channelType`]: NOTIFY.WebSocketChannel2023 },
        },
        {
          type: [SSD.SparqlQueryService],
          endpoint: `${ROOT}sparql`,
          conformsTo: ["https://jeswr.github.io/solid-specs/specs/access-controlled-query/"],
          extra: {},
        },
        {
          type: [SSD.CrdtSyncService],
          endpoint: `${ROOT}.sync/tickets`,
          conformsTo: [`${SSD_NS}y-protocol-v1`],
          extra: { [`${SSD_NS}roomTemplate`]: "wss://pod.example/.sync/rooms/{room}" },
        },
      ],
      capabilities: [
        { type: [SSD.AccessControl], extra: { [`${SSD_NS}model`]: `${SSD_NS}WAC` } },
        {
          type: [SSD.PatchSupport],
          extra: {
            [`${SSD_NS}format`]: {
              "@id": expect.stringMatching(/^_:/),
              [`${SSD_NS}source`]: "text/turtle",
              [`${SSD_NS}patchType`]: ["text/n3", "application/sparql-update"],
            },
          },
        },
        { type: [SSD.RecursiveDelete], extra: {} },
      ],
    });
    expect([...dataset]).toEqual(before);
    expect(parseSolidDescription(dataset, ROOT)).toEqual(result);
  });

  test("maps ACQ endpoints only on the supplied root, rejecting non-IRI values", async () => {
    const dataset = await turtle(`
      <> acq:endpoint <sparql>, <sparql-2>, "invalid", [] .
      <https://other.example/> acq:endpoint <https://other.example/sparql> .
    `);
    expect(parseSolidDescription(dataset, ROOT)).toEqual({
      services: ["sparql", "sparql-2"].map((path) => ({
        type: [SSD.SparqlQueryService],
        endpoint: ROOT + path,
        extra: {},
      })),
      capabilities: [],
    });
  });

  test("keeps unknown types, identifiers, profiles and expanded extras on root entries", async () => {
    const dataset = await turtle(`
      <> did:service <#unknown>, [ did:serviceEndpoint <untyped> ] ; lws:capability <#cap>, [] .
      <#unknown> a <urn:unknown:Service>, ssd:TrashService ;
        did:serviceEndpoint <trash> ; dct:conformsTo <urn:profile:a>, <urn:profile:b> ;
        <urn:extra:label> "one", "two" ; <urn:extra:link> <urn:extra:target> .
      <#cap> a <urn:unknown:Capability> ; <urn:extra:value> "lexical" .
      <unrelated> did:service [ did:serviceEndpoint <ignored> ] ; lws:capability [ a ssd:RecursiveDelete ] .
    `);
    expect(parseSolidDescription(dataset, ROOT)).toEqual({
      services: [
        {
          id: `${ROOT}#unknown`,
          type: ["urn:unknown:Service", SSD.TrashService],
          endpoint: `${ROOT}trash`,
          conformsTo: ["urn:profile:a", "urn:profile:b"],
          extra: { "urn:extra:label": ["one", "two"], "urn:extra:link": "urn:extra:target" },
        },
        { type: [], endpoint: `${ROOT}untyped`, extra: {} },
      ],
      capabilities: [
        {
          id: `${ROOT}#cap`,
          type: ["urn:unknown:Capability"],
          extra: { "urn:extra:value": "lexical" },
        },
        { type: [], extra: {} },
      ],
    });
  });

  test("ignores malformed links and types without dropping valid siblings", async () => {
    const dataset = await turtle(`
      <> did:service "literal", [ a "not a type" ; did:serviceEndpoint "not an IRI" ],
          [ did:serviceEndpoint [] ], [ a ssd:VersioningService, "bad" ; did:serviceEndpoint "bad", <versions> ; dct:conformsTo "bad", <urn:profile> ] ;
        lws:capability "bad", [ a "bad", ssd:RecursiveDelete ] .
    `);
    expect(parseSolidDescription(dataset, ROOT)).toEqual({
      services: [
        {
          type: [SSD.VersioningService],
          endpoint: `${ROOT}versions`,
          conformsTo: ["urn:profile"],
          extra: {},
        },
      ],
      capabilities: [{ type: [SSD.RecursiveDelete], extra: {} }],
    });
  });

  test("finds subscriptions on any subject, deduplicates endpoints, and keeps unknown channels", async () => {
    const dataset = await turtle(`
      <description> notify:subscription <notify>, <unknown>, <missing>, "bad", [] .
      <other> notify:subscription <notify> .
      <notify> notify:channelType notify:WebSocketChannel2023, notify:StreamingHTTPChannel2023, "bad" ;
        notify:feature notify:state, "bad" ; <urn:extra:custom> "value" .
      <unknown> notify:channelType <urn:channel:unknown> .
    `);
    expect(parseSolidDescription(dataset, ROOT)).toEqual({
      services: [
        {
          type: [
            SSD.SolidNotificationService,
            NOTIFY.WebSocketChannel2023,
            NOTIFY.StreamingHTTPChannel2023,
          ],
          endpoint: `${ROOT}notify`,
          extra: {
            [NOTIFY.channelType]: [NOTIFY.WebSocketChannel2023, NOTIFY.StreamingHTTPChannel2023],
            [NOTIFY.feature]: [`${NOTIFY_NS}state`],
            "urn:extra:custom": "value",
          },
        },
        {
          type: [SSD.SolidNotificationService],
          endpoint: `${ROOT}unknown`,
          extra: { [NOTIFY.channelType]: "urn:channel:unknown", [NOTIFY.feature]: [] },
        },
        {
          type: [SSD.SolidNotificationService],
          endpoint: `${ROOT}missing`,
          extra: { [NOTIFY.feature]: [] },
        },
      ],
      capabilities: [],
    });
  });

  test("an unrecognised channel type cannot give a subscription another service type", async () => {
    const dataset = await turtle(`
      <description> notify:subscription <spoof> .
      <spoof> notify:channelType <${SSD.CrdtSyncService}>, notify:WebhookChannel2023 .
    `);
    expect(parseSolidDescription(dataset, ROOT).services).toEqual([
      {
        type: [SSD.SolidNotificationService, NOTIFY.WebhookChannel2023],
        endpoint: `${ROOT}spoof`,
        extra: {
          [NOTIFY.channelType]: [SSD.CrdtSyncService, NOTIFY.WebhookChannel2023],
          [NOTIFY.feature]: [],
        },
      },
    ]);
  });

  test("keeps cyclic blank-node extras finite", async () => {
    const dataset = await turtle(`
      <> lws:capability _:cap .
      _:cap a ssd:PatchSupport ; ssd:format _:format .
      _:format ssd:source "text/turtle" ; ssd:back _:cap .
    `);
    const result = parseSolidDescription(dataset, ROOT);
    expect(result.capabilities[0]?.extra).toEqual({
      [`${SSD_NS}format`]: {
        "@id": expect.stringMatching(/^_:/),
        [`${SSD_NS}source`]: "text/turtle",
        // The entry root is expanded once where nested; the cycle then ends in a reference.
        [`${SSD_NS}back`]: {
          "@id": expect.stringMatching(/^_:/),
          "http://www.w3.org/1999/02/22-rdf-syntax-ns#type": SSD.PatchSupport,
          [`${SSD_NS}format`]: { "@id": expect.stringMatching(/^_:/) },
        },
      },
    });
    expect(() => JSON.stringify(result)).not.toThrow();
  });

  test("bounds deeply nested extension data", async () => {
    const links = Array.from(
      { length: 40 },
      (_, index) => `_:n${index} <urn:next> _:n${index + 1} .`,
    ).join("\n");
    const dataset = await turtle(`<> lws:capability _:n0 . ${links}`);
    const result = parseSolidDescription(dataset, ROOT);
    let value: unknown = result.capabilities[0]?.extra;
    for (let index = 0; index < 32; index++) {
      value = (value as Record<string, unknown>)["urn:next"];
    }
    expect(value).toEqual({ "@id": expect.stringMatching(/^_:/) });
  });

  test.each([
    ["<urn:extension>", "ssd:format"],
    ["ssd:format", "<urn:extension>"],
  ])("resolves shared PatchSupport formats with %s before %s", async (first, second) => {
    const dataset = await turtle(`
      <> lws:capability [ a ssd:PatchSupport ; ${first} _:format ; ${second} _:format ] .
      _:format ssd:source "text/turtle" ; ssd:patchType "text/n3", "application/sparql-update" .
    `);
    // Resolve from plain serialized data, without relying on object identity or the dataset.
    const result = JSON.parse(JSON.stringify(parseSolidDescription(dataset, ROOT)));
    const extra = result.capabilities[0].extra;
    const format = extra[`${SSD_NS}format`];
    const extension = extra["urn:extension"];
    expect(format["@id"]).toMatch(/^_:/);
    expect(extension["@id"]).toBe(format["@id"]);
    const definition = Object.values(extra).find(
      (value) =>
        typeof value === "object" &&
        value !== null &&
        "@id" in value &&
        value["@id"] === format["@id"] &&
        `${SSD_NS}source` in value,
    );
    expect(definition).toEqual({
      "@id": format["@id"],
      [`${SSD_NS}source`]: "text/turtle",
      [`${SSD_NS}patchType`]: ["text/n3", "application/sparql-update"],
    });
  });

  test("expands named ssd:format nodes end to end (other named objects stay IRIs)", async () => {
    const dataset = await turtle(`
      <> lws:capability [ a ssd:PatchSupport ; ssd:format <#turtle>, <#empty> ; <urn:see> <#turtle> ] .
      <#turtle> ssd:source "text/turtle" ; ssd:patchType "application/sparql-update" .
    `);
    const result = parseSolidDescription(dataset, ROOT);
    const extra = result.capabilities[0]?.extra ?? {};
    expect(extra["urn:see"]).toBe(`${ROOT}#turtle`);
    expect(extra[`${SSD_NS}format`]).toEqual([
      {
        "@id": `${ROOT}#turtle`,
        [`${SSD_NS}source`]: "text/turtle",
        [`${SSD_NS}patchType`]: "application/sparql-update",
      },
      `${ROOT}#empty`,
    ]);
    const features = deriveFeatures({
      protocol: "solid",
      id: ROOT,
      root: ROOT,
      descriptionUrl: `${ROOT}.well-known/solid`,
      sources: ["solid-description"],
      fetchedAt: 0,
      etag: null,
      maxAgeMs: 0,
      verificationMethods: [],
      ...result,
    });
    expect(features.patch.detail.formats).toEqual({ "text/turtle": ["application/sparql-update"] });
  });

  test("a format node shared by many capabilities is expanded once (linear output)", async () => {
    const n = 400;
    const types = Array.from({ length: n }, (_, i) => `"application/x-p${i}"`).join(", ");
    const caps = Array.from(
      { length: n },
      (_, i) =>
        `<> lws:capability <#cap${i}> . <#cap${i}> a ssd:PatchSupport ; ssd:format <#shared> .`,
    ).join("\n");
    const dataset = await turtle(`${caps}
      <#shared> ssd:source "text/turtle" ; ssd:patchType ${types} .`);
    const started = performance.now();
    const result = parseSolidDescription(dataset, ROOT);
    expect(JSON.stringify(result).length).toBeLessThan(200_000);
    const features = deriveFeatures({
      protocol: "solid",
      id: ROOT,
      root: ROOT,
      descriptionUrl: `${ROOT}.well-known/solid`,
      sources: ["solid-description"],
      fetchedAt: 0,
      etag: null,
      maxAgeMs: 0,
      verificationMethods: [],
      ...result,
    });
    expect(features.patch.detail.formats["text/turtle"]).toHaveLength(n);
    expect(performance.now() - started).toBeLessThan(3000);
  });

  test.each([
    [
      "the format node is also a capability",
      "<#fmt> a ssd:PatchSupport ; ssd:format <#fmt> . <> lws:capability <#fmt> .",
    ],
    [
      "the format node is a blank capability first",
      "<> lws:capability _:f . _:f a ssd:PatchSupport ; ssd:format _:f .",
    ],
  ])("format references always resolve when %s", async (_name, body) => {
    const node = body.includes("_:f") ? "_:f" : "<#fmt>";
    const dataset = await turtle(`${body}
      <> lws:capability [ a ssd:PatchSupport ; ssd:format ${node} ] .
      ${node} ssd:source "text/turtle" ; ssd:patchType "application/sparql-update" .`);
    const result = parseSolidDescription(dataset, ROOT);
    const features = deriveFeatures({
      protocol: "solid",
      id: ROOT,
      root: ROOT,
      descriptionUrl: `${ROOT}.well-known/solid`,
      sources: ["solid-description"],
      fetchedAt: 0,
      etag: null,
      maxAgeMs: 0,
      verificationMethods: [],
      ...result,
    });
    expect(features.patch.detail.formats["text/turtle"]).toEqual(["application/sparql-update"]);
  });

  test("expands shared blank-node extensions once rather than multiplying their contents", async () => {
    const dataset = await turtle(`
      <> lws:capability _:cap .
      _:cap <urn:first> _:shared ; <urn:second> _:shared .
      _:shared <urn:value> "shared value" .
    `);
    expect(parseSolidDescription(dataset, ROOT).capabilities).toEqual([
      {
        type: [],
        extra: {
          "urn:first": {
            "@id": expect.stringMatching(/^_:/),
            "urn:value": "shared value",
          },
          "urn:second": { "@id": expect.stringMatching(/^_:/) },
        },
      },
    ]);
  });

  test("returns empty arrays for an empty dataset", async () => {
    expect(parseSolidDescription(await turtle(""), ROOT)).toEqual({
      services: [],
      capabilities: [],
    });
  });
});
