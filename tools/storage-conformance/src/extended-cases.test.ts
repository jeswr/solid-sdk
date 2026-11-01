// AUTHORED-BY Codex GPT-6.1-Sol

import { StorageError } from "@jeswr/storage-client";
import { createMemoryStorage } from "@jeswr/storage-client/memory";
import { expect, test, vi } from "vitest";
import { storageCases } from "./cases.js";
import { evaluateCase } from "./harness.js";
import { memoryTarget } from "./targets/memory.js";

function scenario(id: string) {
  const found = storageCases.find((item) => item.id === id);
  if (!found) throw new Error("Missing scenario");
  return found;
}

test("every unadvertised but working patch fails independently without probe name collisions", async () => {
  const target = await memoryTarget("solid").start();
  const features = await target.resolveFeatures?.();
  if (!features) throw new Error("Missing memory description");
  features.patch.state = "unknown";
  for (const item of storageCases.filter((item) => item.id.startsWith("SC-PATCH-"))) {
    const rows = await evaluateCase(item, target, features);
    expect(rows[0]).toMatchObject({ status: "fail", reason: "advertisement-missing:patch" });
  }
});

test("HTTP targets can refuse container writes locally without inventing an HTTP status", async () => {
  const target = await memoryTarget("solid").start();
  const write = target.storage.write.bind(target.storage);
  vi.spyOn(target.storage, "write").mockImplementation(async (url, body, options) => {
    if (url.endsWith("/")) throw new StorageError("method-not-allowed", { method: "PUT", url });
    return write(url, body, options);
  });
  await scenario("SC-ERR-common").run(target);
});

test("shared moves exercise native LWS and its non-preserved identifiers", async () => {
  const target = await memoryTarget("lws").start();
  target.storage = createMemoryStorage({ protocol: "lws", root: target.root, moveResource: true });
  await scenario("SC-MOVE-resource").run(target);
  await scenario("SC-MOVE-container-cycle").run(target);
});

test("move conformance rejects an incorrect identifier preservation claim", async () => {
  const target = await memoryTarget("solid").start();
  target.storage.features.move.detail.preservesIdentifier = true;
  await expect(scenario("SC-MOVE-resource").run(target)).rejects.toThrow();
});

test("container moves must refuse when container support is absent", async () => {
  const target = await memoryTarget("solid").start();
  target.storage.features.move.detail.containers = false;
  vi.spyOn(target.storage, "move").mockRejectedValue(
    new StorageError("unsupported", { method: "MOVE", url: target.root, feature: "move" }),
  );
  await scenario("SC-MOVE-container-cycle").run(target);
});

test("metadata without a describedby document must refuse both public operations", async () => {
  const target = await memoryTarget("solid").start();
  const head = target.storage.head.bind(target.storage);
  vi.spyOn(target.storage, "head").mockImplementation(async (url) => ({
    ...(await head(url)),
    metadataUrl: null,
  }));
  for (const key of ["metadata", "setMetadata"] as const)
    vi.spyOn(target.storage, key).mockRejectedValue(
      new StorageError("unsupported", { method: "GET", url: target.root }),
    );
  await scenario("SC-META-links").run(target);
});

test.each([
  415, 204, 401, 500,
])("JSON absence check independently tests the server (%i)", async (status) => {
  const target = await memoryTarget("solid").start();
  target.storage.features.patch.detail.formats = { "text/turtle": ["text/n3"] };
  vi.spyOn(target.storage, "patch").mockRejectedValue(
    new StorageError("unsupported", { method: "PATCH", url: target.root, feature: "patch" }),
  );
  const transport = vi.fn<typeof fetch>(async () => new Response(null, { status }));
  target.fetch = transport;
  const run = scenario("SC-PATCH-json").run(target);
  if (status === 415) await run;
  else
    await expect(run).rejects.toThrow(
      status === 204
        ? "advertisement-missing:patch-json"
        : "Unexpected JSON Patch absence response",
    );
  expect(transport).toHaveBeenCalledOnce();
});

test("unsupported patch combinations must fail before making a request", async () => {
  const target = await memoryTarget("solid").start();
  target.storage.features.patch.detail.formats = { "text/turtle": ["text/n3"] };
  let calls = 0;
  target.requestCount = () => calls;
  vi.spyOn(target.storage, "patch").mockImplementation(async () => {
    calls++;
    throw new StorageError("unsupported", { method: "PATCH", url: target.root });
  });
  await expect(scenario("SC-PATCH-json").run(target)).rejects.toThrow(
    "Unsupported combination sent an HTTP request",
  );
});

test.each([
  false,
  true,
])("SC-CAP checks %s complete advertisement and caching independently", async (complete) => {
  const target = await memoryTarget("solid").start();
  target.resolveFeatures = undefined;
  const transport = vi.fn<typeof fetch>(async (input, init) => {
    const request = new Request(input, init);
    if (request.method === "HEAD")
      return new Response(null, {
        headers: {
          Link: `<http://www.w3.org/ns/pim/space#Storage>; rel="type", <${target.root}.well-known/solid>; rel="http://www.w3.org/ns/solid/terms#storageDescription"`,
        },
      });
    if (request.method === "OPTIONS")
      return new Response(null, {
        headers: { "Accept-Patch": "text/n3", Link: `<${target.root}.acl>; rel="acl"` },
      });
    return new Response(
      `@prefix pim: <http://www.w3.org/ns/pim/space#>. @prefix lws: <https://www.w3.org/ns/lws#>. @prefix ssd: <https://jeswr.org/ns/solid-sd#>. </> a pim:Storage ${complete ? '; lws:capability [ a ssd:AccessControl; ssd:model ssd:WAC ], [ a ssd:PatchSupport; ssd:source "text/turtle"; ssd:patchType "text/n3" ]' : ""}.`,
      { headers: { "Content-Type": "text/turtle" } },
    );
  });
  target.fetch = transport;
  await scenario("SC-CAP-discovery-cache").run(target);
  expect(
    transport.mock.calls.filter(([input, init]) => new Request(input, init).method === "OPTIONS"),
  ).toHaveLength(complete ? 0 : 1);
});

test("RDF patch assertions detect a backend that acknowledges without changing the graph", async () => {
  const target = await memoryTarget("solid").start();
  vi.spyOn(target.storage, "patch").mockImplementation(async (url) => ({
    url,
    created: false,
    etag: '"pretend"',
  }));
  await expect(scenario("SC-PATCH-rdf").run(target)).rejects.toThrow();
});

test.each([
  "honors WHERE",
  "ignores WHERE",
  "mutates before rejecting WHERE",
])("WHERE conformance checks a backend that %s", async (behavior) => {
  const target = await memoryTarget("solid").start();
  target.resolveFeatures = undefined;
  const patch = target.storage.patch.bind(target.storage);
  vi.spyOn(target.storage, "patch").mockImplementation(async (url, change, options) => {
    if (change.kind !== "rdf") return patch(url, change, options);
    const { where, ...unconditional } = change;
    const { dataset } = await target.storage.readRdf(url);
    if (behavior !== "ignores WHERE" && where?.some((quad) => !dataset.has(quad))) {
      if (behavior === "mutates before rejecting WHERE") await patch(url, unconditional, options);
      throw new StorageError("conflict", { method: "PATCH", url, status: 409 });
    }
    return patch(url, unconditional, options);
  });
  const run = scenario("SC-PATCH-where").run(target);
  if (behavior === "honors WHERE") await run;
  else
    await expect(run).rejects.toThrow(
      behavior === "ignores WHERE"
        ? "Expected the operation to fail"
        : "RDF datasets are not isomorphic",
    );
});
