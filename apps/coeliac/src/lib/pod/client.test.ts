// AUTHORED-BY Codex GPT-6.1-Sol
import { createPodClient, type PodClient } from "@jeswr/storage-client";
import { createMemoryStorage } from "@jeswr/storage-client/memory";
import { beforeEach, expect, it, vi } from "vitest";
import { createSessionStorage, resolvePodStorage } from "./client";

vi.mock("@jeswr/storage-client", async (original) => ({
  ...await original<typeof import("@jeswr/storage-client")>(),
  createPodClient: vi.fn(),
}));

const ROOT = "https://alice.example/";

beforeEach(() => vi.mocked(createPodClient).mockReset());

it("lazily shares one factory client between concurrent operations and guards its transport", async () => {
  const storage = createMemoryStorage({ root: ROOT });
  vi.mocked(createPodClient).mockResolvedValue({ storage } as PodClient);
  const fetch = vi.fn(async () => new Response(null, { status: 200 }));
  const sessionStorage = createSessionStorage(fetch, ROOT);
  expect(createPodClient).not.toHaveBeenCalled();
  expect(await Promise.all([resolvePodStorage(sessionStorage), resolvePodStorage(sessionStorage)]))
    .toEqual([storage, storage]);
  expect(await resolvePodStorage(sessionStorage)).toBe(storage);
  expect(createPodClient).toHaveBeenCalledTimes(1);
  const options = vi.mocked(createPodClient).mock.calls[0][0];
  expect(options.storage).toBe(ROOT);
  await expect(options.fetch("https://foreign.example/private")).rejects.toThrow();
  expect(fetch).not.toHaveBeenCalled();
  await options.fetch(`${ROOT}notes/`);
  expect(fetch).toHaveBeenCalledWith(`${ROOT}notes/`, expect.objectContaining({ redirect: "manual" }));
});

it("retries failed discovery without a backend fallback and then reuses the successful client", async () => {
  const storage = createMemoryStorage({ root: ROOT });
  const offline = new Error("offline discovery");
  vi.mocked(createPodClient).mockRejectedValueOnce(offline).mockResolvedValue({ storage } as PodClient);
  const fetch = vi.fn();
  const sessionStorage = createSessionStorage(fetch, ROOT);
  await expect(resolvePodStorage(sessionStorage)).rejects.toBe(offline);
  expect(await resolvePodStorage(sessionStorage)).toBe(storage);
  expect(await resolvePodStorage(sessionStorage)).toBe(storage);
  expect(createPodClient).toHaveBeenCalledTimes(2);
  expect(fetch).not.toHaveBeenCalled();
});

it("rejects LWS before exposing its client for fixed-URL writes or WAC ACLs", async () => {
  const storage = createMemoryStorage({ root: ROOT, protocol: "lws" });
  vi.mocked(createPodClient).mockResolvedValue({ storage } as PodClient);
  const write = vi.spyOn(storage, "write");
  const create = vi.spyOn(storage, "create");
  const sessionStorage = createSessionStorage(vi.fn(), ROOT);
  await expect(resolvePodStorage(sessionStorage)).rejects.toMatchObject({
    name: "UnsupportedStorageError",
    code: "unsupported-storage",
    message: "This diary requires Solid storage with fixed URLs and owner-only WAC ACLs. LWS storage is not supported.",
  });
  expect(write).not.toHaveBeenCalled();
  expect(create).not.toHaveBeenCalled();
});
