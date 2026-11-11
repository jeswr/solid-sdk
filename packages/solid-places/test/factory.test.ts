// AUTHORED-BY Codex (GPT-6.1 Sol)
import { createPodClient } from "@jeswr/storage-client";
import { createMemoryStorage } from "@jeswr/storage-client/memory";
import { expect, it, vi } from "vitest";
import { openPlacesRepository } from "../src/repository.js";

vi.mock("@jeswr/storage-client", async () => ({
  ...(await vi.importActual("@jeswr/storage-client")),
  createPodClient: vi.fn(),
}));
it("uses discovery for real storage and only the explicit fixture adapter for demo", async () => {
  const storage = createMemoryStorage({ root: "https://pod.example/" });
  const fetch = vi.fn();
  const owner = "https://pod.example/me";
  vi.mocked(createPodClient).mockResolvedValue({ storage } as Awaited<
    ReturnType<typeof createPodClient>
  >);
  expect(
    (await openPlacesRepository({ storageUrl: storage.root, owner, fetch, demo: false })).base,
  ).toBe("https://pod.example/places/");
  expect(createPodClient).toHaveBeenCalledWith({ fetch, storage: storage.root });
  vi.mocked(createPodClient).mockClear();
  expect(
    (await openPlacesRepository({ storageUrl: storage.root, owner, fetch, demo: true })).base,
  ).toBe("https://pod.example/places/");
  expect(createPodClient).not.toHaveBeenCalled();
});
it("propagates storage discovery errors before opening data", async () => {
  vi.mocked(createPodClient).mockRejectedValueOnce(new Error("Unavailable"));
  await expect(
    openPlacesRepository({
      storageUrl: "https://pod.example/",
      owner: "https://pod.example/me",
      fetch: vi.fn(),
      demo: false,
    }),
  ).rejects.toThrow("Unavailable");
});
