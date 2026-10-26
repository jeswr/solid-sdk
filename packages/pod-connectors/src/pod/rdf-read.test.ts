// AUTHORED-BY Codex GPT-6
import { RdfFetchError } from "@jeswr/fetch-rdf";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RemoteContextRefusedError } from "../core/errors.js";
import { createFetchPodWriter } from "../core/pod-writer.js";
import { createMemoryPod, TEST_POD_ROOT, TEST_PROFILE_DOC, TEST_WEBID } from "../core/testing.js";
import { freshRdf } from "./rdf-read.js";
import { readTypeIndex } from "./type-index.js";

const contextUrl = "https://foreign.test/context.jsonld";
const context = { name: "https://schema.org/name" };
const jsonLdResponse = (document: unknown) =>
  new Response(JSON.stringify(document), {
    headers: { "content-type": "application/ld+json; charset=utf-8", etag: '"v1"' },
  });

afterEach(() => vi.unstubAllGlobals());

describe("connector RDF HTTP failures", () => {
  it.each([
    401, 403, 404, 500,
  ])("preserves the canonical error class and HTTP %s status", async (status) => {
    const url = `${TEST_POD_ROOT}notes/note.ttl.acl`;
    const failure = await freshRdf(
      url,
      async () =>
        new Response("missing or inaccessible", {
          status,
          headers: { "content-type": "text/plain" },
        }),
    ).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(RdfFetchError);
    expect(failure).toMatchObject({ status, url, contentType: "text/plain" });
  });
});

describe("connector RDF context boundary", () => {
  it.each([
    "document",
    "profile",
    "index",
    "discovery",
  ] as const)("refuses remote contexts during %s reads without calling global fetch or writing", async (target) => {
    const pod = createMemoryPod();
    const indexUrl = `${TEST_POD_ROOT}settings/privateTypeIndex.ttl`;
    const documentUrl = `${TEST_POD_ROOT}integrations/toy/items.jsonld`;
    // Seed a linked index so the registration regression reaches its read without bootstrapping.
    if (target === "index") {
      await pod.fetch(TEST_PROFILE_DOC, {
        method: "PUT",
        body: `${pod.get(TEST_PROFILE_DOC)}\n<${TEST_WEBID}> <http://www.w3.org/ns/solid/terms#privateTypeIndex> <${indexUrl}> .`,
      });
    }
    const targetUrl =
      target === "profile" ? TEST_PROFILE_DOC : target === "document" ? documentUrl : indexUrl;
    const scopedFetch = vi.fn<typeof fetch>(async (input, init) =>
      String(input) === targetUrl
        ? jsonLdResponse({ "@context": contextUrl, "@id": "#item", name: "Example" })
        : pod.fetch(input, init),
    );
    // A usable response makes a regression observable without any real network request.
    const globalFetch = vi.fn<typeof fetch>(async () => jsonLdResponse({ "@context": context }));
    vi.stubGlobal("fetch", globalFetch);
    const writer = createFetchPodWriter({
      adapterId: "toy",
      webId: TEST_WEBID,
      profileDocumentUrl: TEST_PROFILE_DOC,
      podRoot: TEST_POD_ROOT,
      fetch: scopedFetch,
    });
    const putsBefore = pod.putCount;
    const operation =
      target === "document"
        ? writer.read("items.jsonld")
        : target === "discovery"
          ? readTypeIndex(indexUrl, scopedFetch)
          : writer.registerType([
              { forClass: "https://schema.org/Thing", container: writer.resolve("media/") },
            ]);
    const failure = await operation.catch((error: unknown) => error);
    expect(globalFetch).not.toHaveBeenCalled();
    expect(failure).toBeInstanceOf(RdfFetchError);
    expect(failure).toBeInstanceOf(RemoteContextRefusedError);
    expect(failure).toMatchObject({ name: "RemoteContextRefusedError", url: contextUrl });
    expect(scopedFetch.mock.calls.map(([input]) => String(input))).toEqual(
      target === "index" ? [TEST_PROFILE_DOC, indexUrl] : [targetUrl],
    );
    expect(pod.putCount).toBe(putsBefore);
  });

  it.each([
    { "@context": [context, contextUrl] },
    { "https://schema.org/item": { "@context": contextUrl, name: "Example" } },
    { "@context": { "@import": contextUrl } },
    { "@context": { item: { "@id": "https://schema.org/Thing", "@context": contextUrl } } },
    { "@context": `${TEST_POD_ROOT}private/context.jsonld` },
    { "@context": "./context.jsonld" },
  ])("refuses context URLs in every JSON-LD context form: %j", async (document) => {
    const globalFetch = vi.fn<typeof fetch>(async () => jsonLdResponse({ "@context": context }));
    vi.stubGlobal("fetch", globalFetch);
    const scopedFetch = vi.fn<typeof fetch>(async () => jsonLdResponse(document));
    const failure = await freshRdf(`${TEST_POD_ROOT}items.jsonld`, scopedFetch).catch(
      (error: unknown) => error,
    );
    expect(globalFetch).not.toHaveBeenCalled();
    expect(failure).toBeInstanceOf(RemoteContextRefusedError);
    expect(failure).toMatchObject({ name: "RemoteContextRefusedError" });
    expect(scopedFetch).toHaveBeenCalledTimes(1);
  });

  it("parses inline contexts with relative IRIs and preserves validators and response metadata", async () => {
    const globalFetch = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", globalFetch);
    const response = jsonLdResponse({ "@context": context, "@id": "#item", name: "Example" });
    const scopedFetch = vi.fn<typeof fetch>(async () => response);
    const url = `${TEST_POD_ROOT}items.jsonld`;
    const result = await freshRdf(url, scopedFetch);
    expect(
      [...result.dataset].map((quad) => [
        quad.subject.value,
        quad.predicate.value,
        quad.object.value,
      ]),
    ).toEqual([[`${url}#item`, context.name, "Example"]]);
    expect(result).toMatchObject({
      etag: '"v1"',
      contentType: "application/ld+json",
      response,
      url,
    });
    expect(result.headers).toBe(response.headers);
    const headers = new Headers(scopedFetch.mock.calls[0]?.[1]?.headers);
    expect(headers.get("cache-control")).toBe("no-cache");
    expect(headers.get("accept")).toContain("application/ld+json");
    expect(globalFetch).not.toHaveBeenCalled();
  });

  it("registers through JSON-LD profile and index documents with inline contexts", async () => {
    const pod = createMemoryPod();
    const indexUrl = `${TEST_POD_ROOT}settings/privateTypeIndex.ttl`;
    const globalFetch = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", globalFetch);
    const scopedFetch = vi.fn<typeof fetch>(async (input, init) => {
      if ((init?.method ?? "GET") === "GET") {
        if (String(input) === TEST_PROFILE_DOC) {
          return jsonLdResponse({
            "@context": {
              storage: { "@id": "http://www.w3.org/ns/pim/space#storage", "@type": "@id" },
              index: { "@id": "http://www.w3.org/ns/solid/terms#privateTypeIndex", "@type": "@id" },
            },
            "@id": TEST_WEBID,
            storage: TEST_POD_ROOT,
            index: indexUrl,
          });
        }
        if (String(input) === indexUrl) {
          return jsonLdResponse({
            "@id": indexUrl,
            "@type": "http://www.w3.org/ns/solid/terms#TypeIndex",
          });
        }
      }
      return pod.fetch(input, init);
    });
    // Back the JSON-LD representation with a resource so the conditional update can succeed.
    await pod.fetch(indexUrl, { method: "PUT", body: "" });
    const writer = createFetchPodWriter({
      adapterId: "toy",
      webId: TEST_WEBID,
      profileDocumentUrl: TEST_PROFILE_DOC,
      podRoot: TEST_POD_ROOT,
      fetch: scopedFetch,
    });
    const container = writer.resolve("media/");
    expect(
      await writer.registerType([{ forClass: "https://schema.org/Thing", container }]),
    ).toEqual({
      indexUrl,
      added: 1,
      bootstrapped: false,
    });
    expect(pod.get(indexUrl)).toContain(container);
    expect(new Headers(scopedFetch.mock.calls.at(-1)?.[1]?.headers).get("if-match")).toBe('"v1"');
    expect(globalFetch).not.toHaveBeenCalled();
  });

  it("keeps malformed JSON-LD failures typed without using a network loader", async () => {
    const globalFetch = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", globalFetch);
    const url = `${TEST_POD_ROOT}items.jsonld`;
    const failure = await freshRdf(
      url,
      async () =>
        new Response("{invalid", {
          headers: { "content-type": "application/ld+json" },
        }),
    ).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(RdfFetchError);
    expect(failure).not.toBeInstanceOf(RemoteContextRefusedError);
    expect(failure).toMatchObject({ url, contentType: "application/ld+json" });
    expect(globalFetch).not.toHaveBeenCalled();
  });
});
