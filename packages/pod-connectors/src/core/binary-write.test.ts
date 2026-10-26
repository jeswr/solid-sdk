// AUTHORED-BY Claude Opus 5.5
import { Store } from "n3";
import { describe, expect, it, vi } from "vitest";
import { ResourceWriteError } from "../pod/resource.js";
import { IntegrationSyncError } from "./errors.js";
import { runFileImport } from "./file-import.js";
import { runImport } from "./import-runner.js";
import { createFetchPodWriter } from "./pod-writer.js";
import {
  createMemoryPod,
  memoryFile,
  TEST_POD_ROOT,
  TEST_PROFILE_DOC,
  TEST_WEBID,
} from "./testing.js";
import type { BinaryDoc, IntegrationAdapter, PodWriter } from "./types.js";

const ROOT = `${TEST_POD_ROOT}integrations/toy/`;
const bytes = (text: string) => new TextEncoder().encode(text);
const eml: BinaryDoc = { slug: "mail/a.eml", contentType: "message/rfc822", body: bytes("A") };

function writer(fetch: typeof globalThis.fetch) {
  return createFetchPodWriter({
    adapterId: "toy",
    webId: TEST_WEBID,
    profileDocumentUrl: TEST_PROFILE_DOC,
    podRoot: TEST_POD_ROOT,
    fetch,
  });
}

describe("fetch-backed binary writes", () => {
  it("creates once and keeps an existing resource in create mode", async () => {
    const pod = createMemoryPod();
    const port = writer(pod.fetch);
    expect(await port.writeBinary?.(eml)).toEqual({ url: `${ROOT}mail/a.eml`, created: true });
    expect(pod.contentType(`${ROOT}mail/a.eml`)).toBe("message/rfc822");
    expect(await port.writeBinary?.({ ...eml, body: bytes("B") })).toEqual({
      url: `${ROOT}mail/a.eml`,
      created: false,
    });
    expect(new TextDecoder().decode(pod.bytes(`${ROOT}mail/a.eml`))).toBe("A");
    expect(pod.putCount).toBe(1);
  });

  it("replaces under the current ETag and creates when absent", async () => {
    const pod = createMemoryPod();
    const fetch = vi.fn(pod.fetch);
    const port = writer(fetch);
    await port.writeBinary?.({ ...eml, mode: "replace" });
    await port.writeBinary?.({ ...eml, body: bytes("B"), mode: "replace" });
    expect(new TextDecoder().decode(pod.bytes(`${ROOT}mail/a.eml`))).toBe("B");
    const puts = fetch.mock.calls.filter(([, init]) => init?.method === "PUT");
    expect(new Headers(puts[0]?.[1]?.headers).get("if-none-match")).toBe("*");
    expect(new Headers(puts[1]?.[1]?.headers).get("if-match")).toBe('"v1"');
  });

  it.each([
    [{}, "no ETag"],
    [{ etag: 'W/"1"' }, "a weak ETag"],
  ])("refuses to replace a resource with %o (%s)", async (headers) => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(null, { headers }));
    await expect(writer(fetch).writeBinary?.({ ...eml, mode: "replace" })).rejects.toBeInstanceOf(
      IntegrationSyncError,
    );
    expect(fetch.mock.calls.every(([, init]) => init?.method === "HEAD")).toBe(true);
  });

  it("surfaces HEAD and PUT failures as ResourceWriteError", async () => {
    const forbidden = async () => new Response(null, { status: 403 });
    await expect(
      writer(forbidden).writeBinary?.({ ...eml, mode: "replace" }),
    ).rejects.toBeInstanceOf(ResourceWriteError);
    await expect(writer(forbidden).writeBinary?.(eml)).rejects.toMatchObject({ status: 403 });
    const pod = createMemoryPod();
    const port = writer(pod.fetch);
    await port.writeBinary?.(eml);
    // A concurrent change between HEAD and PUT is a conflict, never a silent keep.
    const racing = writer(async (input, init) => {
      if (init?.method === "PUT") return new Response(null, { status: 412 });
      return pod.fetch(input, init);
    });
    await expect(racing.writeBinary?.({ ...eml, mode: "replace" })).rejects.toMatchObject({
      status: 412,
    });
  });

  it.each([
    "text/turtle",
    "application/ld+json; charset=utf-8",
    "text/n3",
    "message/rfc822\r\nx-injected: 1",
    "",
    "no-slash",
  ])("refuses content type %j before any transport", async (contentType) => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    await expect(writer(fetch).writeBinary?.({ ...eml, contentType })).rejects.toBeInstanceOf(
      IntegrationSyncError,
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("accepts parameters on non-RDF media types", async () => {
    const pod = createMemoryPod();
    await writer(pod.fetch).writeBinary?.({ ...eml, contentType: "text/plain; charset=utf-8" });
    expect(pod.contentType(`${ROOT}mail/a.eml`)).toBe("text/plain; charset=utf-8");
  });

  it.each([
    "../outside.eml",
    "https://foreign.test/x",
    "%2e%2e/x",
  ])("refuses escaping slug %s", async (slug) => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    await expect(writer(fetch).writeBinary?.({ ...eml, slug })).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("confines redirect hops to the connector root", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () => new Response(null, { status: 307, headers: { location: `${TEST_POD_ROOT}x` } }),
    );
    await expect(writer(fetch).writeBinary?.(eml)).rejects.toThrow();
    expect(fetch.mock.calls.map(([input]) => String(input))).toEqual([`${ROOT}mail/a.eml`]);
  });
});

describe("runner binary port", () => {
  const adapter = (doc: BinaryDoc): IntegrationAdapter => ({
    metadata: {
      id: "toy",
      name: "Toy",
      tier: "A",
      authKind: "oauth-pkce",
      scopes: [],
      categories: ["mail"],
      whatYouGet: "",
      requirements: [],
    },
    fixtures: () => [{ url: "https://source.test/", json: {} }],
    async import(ctx) {
      const stored = await ctx.writeBinary(doc);
      expect(stored.url).toBe(ctx.resolve(doc.slug));
      return {};
    },
  });

  it("delegates to the host writer in API and file imports", async () => {
    const pod = createMemoryPod();
    await runImport({ adapter: adapter(eml), podWriter: writer(pod.fetch), mode: "demo" });
    expect(pod.bytes(`${ROOT}mail/a.eml`)).toEqual(bytes("A"));
    await runFileImport({
      adapter: {
        metadata: { ...adapter(eml).metadata, authKind: "export-file", tier: "C" },
        accept: ".x",
        fileHint: "",
        async importFile(_file, ctx) {
          await ctx.writeBinary({ ...eml, slug: "mail/b.eml" });
          await ctx.write({
            slug: "mail/b.ttl",
            category: "mail",
            forClass: "https://schema.org/EmailMessage",
            dataset: new Store(),
          });
        },
      },
      file: memoryFile("x.x", "x"),
      podWriter: writer(pod.fetch),
    });
    expect(pod.bytes(`${ROOT}mail/b.eml`)).toEqual(bytes("A"));
  });

  it("fails clearly when the host writer has no binary port", async () => {
    const pod = createMemoryPod();
    const { writeBinary: _omitted, ...withoutBinary } = writer(pod.fetch);
    const port: PodWriter = withoutBinary;
    await expect(
      runImport({ adapter: adapter(eml), podWriter: port, mode: "demo" }),
    ).rejects.toThrow("This host cannot store binary resources.");
  });

  it("refuses the reserved provenance slug", async () => {
    const pod = createMemoryPod();
    await expect(
      runImport({
        adapter: adapter({ ...eml, slug: "_provenance.ttl" }),
        podWriter: writer(pod.fetch),
        mode: "demo",
      }),
    ).rejects.toThrow("Reserved connector provenance slug.");
  });
});
