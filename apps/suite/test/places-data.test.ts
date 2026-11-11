// AUTHORED-BY Codex (GPT-6.1 Sol)
import { openPlacesRepository } from "@jeswr/solid-places";
import { expect, it, vi } from "vitest";
import { openPlaces } from "../src/apps/places/lib/data";
import type { PodSession } from "../src/lib/session/pod-session";

vi.mock("@jeswr/solid-places", () => ({ openPlacesRepository: vi.fn() }));
it.each([
  "demo",
  "solid",
  "extension",
] as const)("uses the selected %s account transport, owner and storage", async (mode) => {
  const session = {
    mode,
    fetch: vi.fn(),
    storageUrl: "https://pod.example/",
    webId: "https://pod.example/me",
  } as unknown as PodSession;
  await openPlaces(session);
  expect(openPlacesRepository).toHaveBeenCalledWith({
    fetch: session.fetch,
    storageUrl: session.storageUrl,
    owner: session.webId,
    demo: mode === "demo",
  });
});
it("propagates storage discovery failures", async () => {
  vi.mocked(openPlacesRepository).mockRejectedValueOnce(new Error("Offline"));
  await expect(openPlaces({} as PodSession)).rejects.toThrow("Offline");
});
