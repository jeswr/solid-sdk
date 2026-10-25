// AUTHORED-BY Codex GPT-6.1-Sol
import { RdfFetchError } from "@jeswr/fetch-rdf";
import { Store } from "n3";
import { describe, expect, it, vi } from "vitest";
import { ResourceWriteError } from "../pod/resource.js";
import { createFetchPodWriter } from "./pod-writer.js";
import { createMemoryPod, TEST_POD_ROOT, TEST_WEBID } from "./testing.js";
import type { NormalisedDoc } from "./types.js";

const doc: NormalisedDoc = {
  slug: "media/items.ttl",
  category: "media",
  forClass: "https://schema.org/Thing",
  dataset: new Store(),
};
function writer(fetch: typeof globalThis.fetch) {
  return createFetchPodWriter({
    adapterId: "toy",
    webId: TEST_WEBID,
    podRoot: TEST_POD_ROOT,
    fetch,
  });
}

describe("fetch-backed PodWriter", () => {
  it("round-trips RDF and preserves read ETags and conditional writes", async () => {
    const pod = createMemoryPod();
    const port = writer(pod.fetch);
    expect(await port.read(doc.slug)).toBeUndefined();
    const written = await port.write(doc, { ifNoneMatch: "*" });
    expect(written.url).toBe(port.resolve(doc.slug));
    const existing = await port.read(doc.slug);
    expect(existing?.dataset.size).toBe(0);
    expect(existing?.etag).toBe('"v1"');
    await expect(port.write(doc, { ifNoneMatch: "*" })).rejects.toMatchObject({ status: 412 });
    await port.write(doc, { ifMatch: existing!.etag! });
    await expect(port.write(doc, { ifMatch: existing!.etag! })).rejects.toBeInstanceOf(
      ResourceWriteError,
    );
    expect((await port.read(doc.slug))?.etag).toBe('"v2"');
  });

  it("propagates unreadable and invalid RDF instead of treating it as absent", async () => {
    await expect(
      writer(async () => new Response(null, { status: 403 })).read(doc.slug),
    ).rejects.toBeInstanceOf(RdfFetchError);
    await expect(
      writer(
        async () => new Response("not turtle {", { headers: { "content-type": "text/turtle" } }),
      ).read(doc.slug),
    ).rejects.toThrow();
  });

  it.each([
    "../outside.ttl",
    "https://foreign.test/leak.ttl",
    "/alice/elsewhere.ttl",
    ".",
    "%2e%2e/out.ttl",
    "media%2fescape.ttl",
  ])("refuses escaping slug %s before any transport is used", async (slug) => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const port = writer(fetch);
    expect(() => port.resolve(slug)).toThrow();
    await expect(port.write({ ...doc, slug })).rejects.toThrow();
    await expect(port.read(slug)).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("refuses an unsafe adapter id", () => {
    expect(() =>
      createFetchPodWriter({
        adapterId: "../other",
        webId: TEST_WEBID,
        podRoot: TEST_POD_ROOT,
        fetch: vi.fn(),
      }),
    ).toThrow();
  });

  it("bootstraps and reuses the same Type Index registration", async () => {
    const pod = createMemoryPod();
    const port = writer(pod.fetch);
    const registrations = [{ forClass: doc.forClass, container: port.resolve("media/") }];
    const first = await port.registerType(registrations);
    const putCount = pod.putCount;
    expect(pod.get(first.indexUrl)).toContain(doc.forClass);
    expect(await port.registerType(registrations)).toMatchObject({ indexUrl: first.indexUrl });
    expect(pod.putCount).toBe(putCount);
  });

  it("refuses a profile-linked foreign Type Index before sending Pod credentials", async () => {
    const pod = createMemoryPod();
    const seen: string[] = [];
    const fetch: typeof globalThis.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      seen.push(url);
      if ((init?.method ?? "GET") === "GET" && url.split("#")[0] === TEST_WEBID.split("#")[0]) {
        return new Response(
          `<${TEST_WEBID}> <http://www.w3.org/ns/solid/terms#privateTypeIndex> <https://foreign.test/index> .`,
          { headers: { "content-type": "text/turtle" } },
        );
      }
      return pod.fetch(input, init);
    };
    await expect(writer(fetch).registerType([])).rejects.toThrow();
    expect(seen).not.toContain("https://foreign.test/index");
  });
});
