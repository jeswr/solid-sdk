// AUTHORED-BY Codex GPT-6.1-Sol
import { Buffer } from "node:buffer";
import { createPodClient } from "@jeswr/storage-client";
import { createSolidPod, type SolidPod } from "@sparq-org/solid-server";
import { afterEach, expect, test, vi } from "vitest";
import { memoryTarget } from "./memory.js";
import { sparqSolidTarget } from "./sparq-solid.js";

// Lifecycle unit tests only; conformance.test.ts uses the actual WASM server and discovery.
vi.mock("@sparq-org/solid-server", () => ({ createSolidPod: vi.fn() }));
vi.mock("@jeswr/storage-client", async (original) => ({
  ...(await original<typeof import("@jeswr/storage-client")>()),
  createPodClient: vi.fn(),
}));
afterEach(() => vi.resetAllMocks());

function pod(status = 201): SolidPod {
  return {
    baseUrl: "http://sparq-solid.example",
    ownerWebid: "https://identity.example/alice#me",
    free: vi.fn(),
    dispatch: vi.fn(async () => ({ status, headers: [], body: Buffer.from([]) })),
  };
}

test("starts fixed-owner pod, provisions root, injects transport, refuses impersonation and frees", async () => {
  const wasm = pod();
  const memory = await memoryTarget("solid").start();
  vi.mocked(createSolidPod).mockResolvedValue(wasm);
  vi.mocked(createPodClient).mockResolvedValue({
    storage: memory.storage,
    features: memory.storage.features,
    description: {} as never,
  });
  const running = await sparqSolidTarget.start();
  expect(createSolidPod).toHaveBeenCalledWith({
    baseUrl: running.root,
    ownerWebid: running.webId,
    oidc: false,
  });
  expect(createPodClient).toHaveBeenCalledWith({
    storage: running.root,
    fetch: running.fetch,
    capabilities: expect.any(Object),
  });
  expect(wasm.dispatch).toHaveBeenCalledWith(expect.objectContaining({ method: "PUT", url: "/" }));
  expect(running.claims.move?.state).toBe("available");
  expect(await running.authFetchFor(running.webId)).toBe(running.fetch);
  await expect(running.authFetchFor("https://id.example/bob#me")).rejects.toMatchObject({
    code: "unsupported",
  });
  await running.stop();
  expect(wasm.free).toHaveBeenCalledOnce();
});

test("frees WASM after failed provisioning or failed client discovery", async () => {
  const refused = pod(403);
  vi.mocked(createSolidPod).mockResolvedValue(refused);
  await expect(sparqSolidTarget.start()).rejects.toThrow("Root provisioning failed");
  expect(refused.free).toHaveBeenCalledOnce();
  expect(createPodClient).not.toHaveBeenCalled();
  const undiscovered = pod();
  vi.mocked(createSolidPod).mockResolvedValue(undiscovered);
  vi.mocked(createPodClient).mockRejectedValue(new Error("discovery failed"));
  await expect(sparqSolidTarget.start()).rejects.toThrow("discovery failed");
  expect(undiscovered.free).toHaveBeenCalledOnce();
});
