// AUTHORED-BY Codex GPT-6.1-Sol
import * as memory from "@jeswr/pkg-memory";
import { createMemoryPodPort } from "@jeswr/pkg-memory/testing";
import { afterEach, expect, it, vi } from "vitest";
import { correctHealthFact, projectHealthFacts } from "../src/index.js";
import { batch, claim, owner } from "./helpers.js";

// Keep real implementations; the facade must refuse a broken dependency contract before put.
vi.mock("@jeswr/pkg-memory", async (original) => ({
  ...(await original<typeof import("@jeswr/pkg-memory")>()),
}));
afterEach(() => vi.restoreAllMocks());
it("refuses an empty original returned by a broken store without writing", async () => {
  const original = await batch([claim("one")]);
  const store = new memory.NanopubStore(
    createMemoryPodPort({ root: "https://example.org/pod/", webId: owner }),
  );
  vi.spyOn(store, "get").mockResolvedValue({ ...original, nanopubs: [] });
  const put = vi.spyOn(store, "put");
  await expect(
    correctHealthFact(
      store,
      "urn:uuid:12345678-1234-4234-8234-123456789abc",
      { template: "condition", value: { id: "https://example.org/condition", name: "Fictional" } },
      { clientId: "https://example.org/client", batchId: "broken" },
    ),
  ).rejects.toMatchObject({ code: "invalid-correction" });
  expect(put).not.toHaveBeenCalled();
});
it.each([
  "correction",
  "previous",
])("refuses a builder result missing %s before any put", async (missing) => {
  const original = await batch([claim("one")]);
  const build = memory.buildNanopublications;
  const store = new memory.NanopubStore(
    createMemoryPodPort({ root: "https://example.org/pod/", webId: owner }),
  );
  vi.spyOn(store, "get").mockResolvedValue(original);
  const put = vi.spyOn(store, "put");
  vi.spyOn(memory, "buildNanopublications").mockImplementation(async (...args) => {
    const result = await build(...args);
    return {
      ...result,
      nanopubs: result.nanopubs.filter((np) => !np.identifier.endsWith(`/${missing}`)),
    };
  });
  await expect(
    correctHealthFact(
      store,
      original.nanopubs[0]?.id as string,
      { template: "condition", value: { id: "https://example.org/condition", name: "Fictional" } },
      { clientId: "https://example.org/client", batchId: "broken" },
    ),
  ).rejects.toMatchObject({ code: "invalid-correction" });
  expect(put).not.toHaveBeenCalled();
});
it("does not invent a category-only fact from a missing assertion graph", async () => {
  const value = await batch([claim("one")]);
  const assertion = value.nanopubs[0]?.assertionId;
  if (!assertion) throw new Error("Missing fixture");
  value.dataset.removeQuads(value.dataset.getQuads(null, null, null, assertion));
  const result = projectHealthFacts(value, { owner });
  expect(result.facts).toEqual([]);
  expect(result.unrecognised).toEqual([]);
});
