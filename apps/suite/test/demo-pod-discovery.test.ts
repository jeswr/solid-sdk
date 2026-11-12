// AUTHORED-BY Codex (GPT-6.1 Sol)
import { parseRdf } from "@jeswr/fetch-rdf";
import { parseLinkHeaders } from "@jeswr/storage-capabilities";
import { createMemoryCache } from "@jeswr/storage-capabilities/cache";
import { createPodClient } from "@jeswr/storage-client";
import { DataFactory, Writer } from "n3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import { DEMO_ROOT } from "../src/lib/demo-pod/seed";

const STORAGE_DESCRIPTION = "http://www.w3.org/ns/solid/terms#storageDescription";
const STORAGE = "http://www.w3.org/ns/pim/space#Storage";
const TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const CONTAINS = "http://www.w3.org/ns/ldp#contains";
const { namedNode } = DataFactory;

afterEach(() => vi.restoreAllMocks());

describe.each([DEMO_ROOT, `${DEMO_ROOT}alice/`])("demo storage discovery at %s", (root) => {
  const descriptionUrl = new URL("/.well-known/solid", root).href;
  const seed = [{ path: "notes/hello.txt", body: "Hello demo", contentType: "text/plain" }];

  it.each([
    "HEAD",
    "GET",
  ])("advertises a separate storage description on every %s", async (method) => {
    const pod = createDemoPod({ root, seed });
    await pod.fetch(`${root}.acl`, { method: "PUT", body: "" });
    for (const url of [
      root,
      `${root}notes/`,
      `${root}notes/hello.txt`,
      `${root}.acl`,
      descriptionUrl,
    ]) {
      const response = await pod.fetch(url, { method });
      expect(response.status).toBe(200);
      const links = parseLinkHeaders(response.headers.get("link"), url);
      expect(links.filter((link) => link.rel.includes(STORAGE_DESCRIPTION.toLowerCase()))).toEqual([
        expect.objectContaining({ target: descriptionUrl, context: url }),
      ]);
      if (method === "HEAD") expect(await response.text()).toBe("");
    }
    expect(descriptionUrl).not.toBe(root);
  });

  it("discovers the Solid backend and lists and reads its containers and files", async () => {
    const pod = createDemoPod({ root, seed });
    // Each case must discover through the demo transport rather than a shared cache hit.
    const { storage, description, features } = await createPodClient({
      storage: root,
      fetch: pod.fetch,
      capabilities: createMemoryCache(),
    });
    expect(storage.protocol).toBe("solid");
    expect(storage.root).toBe(root);
    expect(description).toMatchObject({
      protocol: "solid",
      id: root,
      root,
      descriptionUrl,
      sources: ["solid-description"],
      services: [],
      capabilities: [],
    });
    expect(description.evidence ?? []).not.toContain("assumed-origin-root");
    expect(features.liveUpdates.state).toBe("unknown");
    expect((await storage.list(root)).items.map((item) => item.url)).toEqual([`${root}notes/`]);
    expect((await storage.list(`${root}notes/`)).items).toEqual([
      expect.objectContaining({
        url: `${root}notes/hello.txt`,
        kind: "resource",
        contentType: "text/plain",
      }),
    ]);
    const container = await storage.read(`${root}notes/`);
    expect(container.kind).toBe("container");
    const dataset = await parseRdf(await container.text(), container.contentType, {
      baseIRI: `${root}notes/`,
    });
    expect(dataset.match(namedNode(`${root}notes/`), namedNode(CONTAINS)).size).toBe(1);
    expect(await (await storage.read(`${root}notes/hello.txt`)).text()).toBe("Hello demo");

    // Discovery from a nested resource must find the same verified root.
    const nested = await createPodClient({
      storage: `${root}notes/hello.txt`,
      fetch: pod.fetch,
      capabilities: createMemoryCache(),
    });
    expect(nested.description.root).toBe(root);
    expect(nested.description.evidence ?? []).not.toContain("assumed-origin-root");
  });

  it("serves minimal RDF metadata without adding files or changing saved state", async () => {
    const pod = createDemoPod({ root, seed });
    const before = pod.snapshot();
    const changed = vi.fn();
    pod.subscribe(changed);
    const response = await pod.fetch(descriptionUrl);
    const head = await pod.fetch(descriptionUrl, { method: "HEAD" });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/turtle");
    expect([...head.headers]).toEqual([...response.headers]);
    const dataset = await parseRdf(await response.text(), "text/turtle", {
      baseIRI: descriptionUrl,
    });
    expect(dataset.size).toBe(1);
    expect(dataset.match(namedNode(root), namedNode(TYPE), namedNode(STORAGE)).size).toBe(1);
    expect(pod.has(descriptionUrl)).toBe(true);
    expect(pod.snapshot()).toEqual(before);
    expect(changed).not.toHaveBeenCalled();
    const restored = createDemoPod({ root, snapshot: before });
    expect((await restored.fetch(descriptionUrl)).status).toBe(200);
    expect(restored.snapshot()).toEqual(before);
    expect((await pod.fetch(new URL("/.well-known/other", root))).status).toBe(404);
    expect((await pod.fetch("https://other.example/.well-known/solid")).status).toBe(404);
  });

  it("keeps the server description read-only", async () => {
    const pod = createDemoPod({ root, seed });
    const before = pod.snapshot();
    const options = await pod.fetch(descriptionUrl, { method: "OPTIONS" });
    expect(options.status).toBe(204);
    expect(options.headers.get("allow")).toBe("GET, HEAD, OPTIONS");
    for (const method of ["PUT", "POST", "PATCH", "DELETE", "TRACE"]) {
      const response = await pod.fetch(descriptionUrl, { method, body: "overwrite" });
      expect(response.status).toBe(405);
      expect(response.headers.get("allow")).toBe("GET, HEAD, OPTIONS");
    }
    expect(pod.snapshot()).toEqual(before);
  });
});

it("propagates storage description serialization failures", async () => {
  const pod = createDemoPod({ root: DEMO_ROOT });
  const error = new Error("description serialization failed");
  vi.spyOn(Writer.prototype, "end").mockImplementationOnce((callback) => callback?.(error, ""));
  await expect(pod.fetch(new URL("/.well-known/solid", DEMO_ROOT))).rejects.toBe(error);
});
