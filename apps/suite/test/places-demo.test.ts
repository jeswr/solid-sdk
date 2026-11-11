// AUTHORED-BY Codex (GPT-6.1 Sol)
import { ownerPolicy, writeWac } from "@jeswr/pod-access";
import { expect, it, vi } from "vitest";
import { openPlaces } from "../src/apps/places/lib/data";
import { placesController } from "../src/apps/places/state/controller";
import { createDemoPod } from "../src/lib/demo-pod/pod";

it("opens the real in-browser pod and persists a fictional week through the production data path", async () => {
  const root = "https://places.demo.pod/",
    webId = `${root}profile/card#me`;
  const pod = createDemoPod({
    root,
    seed: [
      {
        path: ".acl",
        contentType: "text/turtle",
        body: await writeWac(ownerPolicy(webId, true), root, `${root}.acl`),
      },
      {
        path: "profile/card",
        contentType: "text/turtle",
        body: `<${webId}> <http://www.w3.org/ns/solid/terms#privateTypeIndex> <${root}settings/privateTypeIndex.ttl>.`,
      },
      {
        path: "settings/privateTypeIndex.ttl",
        contentType: "text/turtle",
        body: `<${root}settings/privateTypeIndex.ttl> a <http://www.w3.org/ns/solid/terms#TypeIndex>.`,
      },
    ],
  });
  const repo = await openPlaces({
    mode: "demo",
    webId,
    storageUrl: root,
    fetch: pod.fetch,
    subscribe: pod.subscribe,
    displayName: "Fictional traveller",
    reset: async () => {},
  });
  await repo.initialize();
  const controller = placesController(repo, true, vi.fn());
  await controller.open();
  expect(controller.getSnapshot().error).toBeNull();
  expect(controller.getSnapshot().status).toBe("ready");
  expect(controller.getSnapshot().snapshot.places).toHaveLength(4);
  expect(controller.getSnapshot().snapshot.visits).toHaveLength(15);
  expect(controller.getSnapshot().snapshot.journeys).toHaveLength(7);
  const again = placesController(repo, true, vi.fn());
  await again.open();
  expect(again.getSnapshot().snapshot.visits).toHaveLength(15);
});
