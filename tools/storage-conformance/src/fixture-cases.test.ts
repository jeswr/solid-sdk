// AUTHORED-BY Codex GPT-6.1-Sol
import { fileURLToPath } from "node:url";
import { createMemoryCache } from "@jeswr/storage-capabilities/cache";
import { createPodClient } from "@jeswr/storage-client";
import { createReplayFetch, loadFixtures } from "@jeswr/storage-client/testing";
import { expect, test } from "vitest";
import { storageCases } from "./cases.js";

const directory = fileURLToPath(
  new URL("../../../packages/storage-client/testing/fixtures/css/baseline/", import.meta.url),
);

for (const id of [
  "SC-PATCH-rdf",
  "SC-PATCH-json",
  "SC-PATCH-where",
  "SC-MOVE-resource",
  "SC-META-links",
  "SC-CAP-discovery-cache",
]) {
  test(`recorded CSS replays shared ${id} offline`, async () => {
    const setup = await loadFixtures(`${directory}/setup`);
    let current = createReplayFetch(setup);
    const fetch: typeof globalThis.fetch = (input, init) => current(input, init);
    const root = setup[0]?.request.url;
    expect(root).toBeTypeOf("string");
    const { storage } = await createPodClient({
      storage: root as string,
      fetch,
      capabilities: createMemoryCache(),
    });
    current.assertDone();
    current = createReplayFetch(await loadFixtures(`${directory}/${id}`));
    const scenario = storageCases.find((item) => item.id === id);
    expect(scenario).toBeDefined();
    await scenario?.run({
      root: storage.root,
      webId: "https://identity.example/alice#me",
      storage,
      fetch,
      claims: {},
      authFetchFor: async () => fetch,
      stop: async () => {},
    });
    current.assertDone();
  });
}
