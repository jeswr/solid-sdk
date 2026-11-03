// AUTHORED-BY Codex GPT-6.1-Sol
import { fileURLToPath } from "node:url";
import { parseRdf } from "@jeswr/fetch-rdf";
import { createMemoryCache } from "@jeswr/storage-capabilities/cache";
import { expect, test } from "vitest";
import { createPodClient } from "./index.js";
import { createReplayFetch, loadFixtures } from "./testing.js";

const directory = fileURLToPath(new URL("../testing/fixtures/", import.meta.url));

async function css(scenario: string) {
  const setup = await loadFixtures(`${directory}css/baseline/setup`);
  let current = createReplayFetch(setup);
  const fetch: typeof globalThis.fetch = (input, init) => current(input, init);
  const root = setup[0]?.request.url as string;
  const client = await createPodClient({ storage: root, fetch, capabilities: createMemoryCache() });
  current.assertDone();
  current = createReplayFetch(await loadFixtures(`${directory}css/baseline/${scenario}`));
  return { ...client, replay: current };
}

test("real CSS discovery probes, N3 insert/delete preserves the graph, stale patches fail", async () => {
  const { storage, replay, description, features } = await css("SC-PATCH-rdf");
  expect(description.sources).toEqual(["solid-description"]);
  expect(features.patch.state).toBe("available");
  expect(features.patch.evidence).toBe("default:n3-patch");
  const before = '<https://example.org/item> <https://example.org/label> "before" .';
  const after = '<https://example.org/item> <https://example.org/label> "after" .';
  const parent = await storage.create(storage.root, null, { kind: "container", name: "patch-rdf" });
  const item = await storage.create(parent.url, before, {
    contentType: "text/turtle",
    name: "graph.ttl",
  });
  const etag = (await storage.head(item.url)).etag as string;
  const expected = await parseRdf(after, "text/turtle");
  const change = {
    kind: "rdf" as const,
    deletes: [...(await parseRdf(before, "text/turtle"))],
    inserts: [...expected],
  };
  const written = await storage.patch(item.url, change, { ifMatch: etag });
  expect(written.created).toBe(false);
  expect((await storage.head(written.url)).etag).not.toBe(etag);
  const read = await storage.readRdf(written.url);
  expect(read.dataset.size).toBe(1);
  expect([...expected].every((quad) => read.dataset.has(quad))).toBe(true);
  await expect(storage.patch(item.url, change, { ifMatch: etag })).rejects.toMatchObject({
    code: "precondition-failed",
    status: 412,
  });
  const unchanged = await storage.readRdf(written.url);
  expect(unchanged.dataset.size).toBe(1);
  expect([...expected].every((quad) => unchanged.dataset.has(quad))).toBe(true);
  replay.assertDone();
});

test("real CSS metadata without a validator refuses a conditional metadata edit", async () => {
  const { storage, replay } = await css("SC-META-links");
  const parent = await storage.create(storage.root, null, {
    kind: "container",
    name: "meta-links",
  });
  const item = await storage.create(parent.url, "first draft", {
    name: "note.txt",
    contentType: "text/plain",
  });
  expect((await storage.head(item.url)).parent).toBe(parent.url);
  expect(await storage.parentOf(item.url)).toBe(parent.url);
  const metadata = await storage.metadata(item.url);
  expect(metadata.url).toBe(`${item.url}.meta`);
  expect(metadata.etag).toBeNull();
  await expect(
    storage.setMetadata(
      item.url,
      [
        {
          op: "add",
          rel: "https://example.org/custom-relation",
          href: "https://example.org/related",
        },
      ],
      { ifMatch: '"missing-metadata-validator"' },
    ),
  ).rejects.toMatchObject({ code: "precondition-failed", status: 412, etag: null });
  expect(await (await storage.read(item.url)).text()).toBe("first draft");
  replay.assertDone();
});

test("recorded sparq provisioning reproduces its missing discovery link without network", async () => {
  const fixtures = await loadFixtures(`${directory}sparq-solid/baseline/setup`);
  const replay = createReplayFetch(fixtures);
  const root = fixtures[0]?.request.url as string;
  const provisioned = await replay(root, {
    method: "PUT",
    headers: {
      "Content-Type": "text/turtle",
      Link: '<http://www.w3.org/ns/ldp#BasicContainer>; rel="type"',
      "If-None-Match": "*",
    },
    body: "",
  });
  expect(provisioned.status).toBe(201);
  await expect(
    createPodClient({ storage: root, fetch: replay, capabilities: createMemoryCache() }),
  ).rejects.toMatchObject({ code: "no-storage-link" });
  replay.assertDone();
});
