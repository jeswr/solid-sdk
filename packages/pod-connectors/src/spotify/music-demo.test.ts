// AUTHORED-BY Codex GPT-6.1-Sol

import { expect, it } from "vitest";
import { importSpotifyFixture } from "../../../../apps/suite/src/apps/music/demo/spotify";
import { createMemoryPod, TEST_POD_ROOT } from "../core/testing.js";

// Ports the direct-caller review probe through the actual Music demo entry point.
it("imports the Spotify fixture through a budgeted context", async () => {
  const pod = createMemoryPod();
  await expect(importSpotifyFixture(pod.fetch, TEST_POD_ROOT)).resolves.toBeUndefined();
  expect(
    pod.urls().some((url) => url.includes("integrations/spotify/") && url.endsWith(".ttl")),
  ).toBe(true);
});
