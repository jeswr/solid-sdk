// AUTHORED-BY Claude Opus 5.5
import { createMemoryStorage } from "@jeswr/storage-client/memory";
import { afterEach, expect, it, vi } from "vitest";

const pod = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock("@jeswr/storage-client", async (original) => ({
  ...(await original<typeof import("@jeswr/storage-client")>()),
  createPodClient: pod.open,
}));

import { openDeckRepository } from "../src/repository.js";

const root = "https://pod.example/";
const profile = `${root}profile#me`;
const undescribed = Object.assign(new Error("no-storage-link"), {
  code: "no-storage-link",
  url: root,
});
afterEach(() => pod.open.mockReset());

it("opens the backend storage discovery chose, including LWS", async () => {
  const storage = createMemoryStorage({ root, protocol: "lws" });
  pod.open.mockResolvedValue({ storage });
  const fetch = vi.fn();
  const repo = await openDeckRepository({ fetch, storageUrl: root, profile });
  expect(pod.open).toHaveBeenCalledWith({ storage: root, fetch, signal: undefined });
  expect(repo.container).toBe(`${root}slides/`);
});
it("treats an undescribed storage as Solid only when the caller says it is", async () => {
  pod.open.mockRejectedValue(undescribed);
  const fetch = vi.fn(async () => {
    throw new Error("offline");
  });
  await expect(openDeckRepository({ fetch, storageUrl: root, profile })).rejects.toBe(undescribed);
  const repo = await openDeckRepository({
    fetch,
    storageUrl: root,
    profile,
    assumeSolidWhenUndescribed: true,
  });
  expect(repo.container).toBe(`${root}slides/`);
  await expect(repo.initialise()).rejects.toThrow();
  expect(fetch).toHaveBeenCalled();
});
it("propagates every other discovery failure", async () => {
  for (const error of [
    new Error("offline"),
    Object.assign(new Error("x"), { code: "no-storage-link", url: "https://other.example/" }),
    Object.assign(new Error("x"), { code: "description-invalid", url: root }),
    "not an error",
  ]) {
    pod.open.mockRejectedValueOnce(error);
    await expect(
      openDeckRepository({
        fetch: vi.fn(),
        storageUrl: root,
        profile,
        assumeSolidWhenUndescribed: true,
      }),
    ).rejects.toBe(error);
  }
});
