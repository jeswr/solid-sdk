// AUTHORED-BY Codex GPT-6.1-Sol
import { expect, it, vi } from "vitest";
import { composeDaemon } from "../src/daemon.js";
import { createMemoryState } from "../src/testing.js";
import type { DaemonOptions } from "../src/types.js";

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  storage: vi.fn(),
  notifications: vi.fn(),
}));
vi.mock("@jeswr/pod-auth/node", () => ({ forClientCredentials: mocks.authenticate }));
vi.mock("@jeswr/storage-client", () => ({ createPodClient: mocks.storage }));
vi.mock("@jeswr/pod-notifications", () => ({ createNotifications: mocks.notifications }));

it("uses only pod-auth client-credentials DPoP fetch for storage and notifications, and logs out on prepare failure", async () => {
  const io = vi.fn(async () => new Response(null, { status: 404 }));
  const logout = vi.fn(async () => undefined);
  const auth = { fetch: io, logout };
  mocks.authenticate.mockResolvedValue(auth);
  mocks.storage.mockResolvedValue({ storage: { root: "https://pod.example/" } });
  mocks.notifications.mockReturnValue({});
  const credentials = {
    issuer: "https://issuer.example/",
    clientId: "fixture",
    clientSecret: "synthetic-fixture",
    boundary: ["https://pod.example/"],
  };
  const options = {
    credentials,
    storageRoot: "https://pod.example/",
    ownerWebId: "https://pod.example/profile#me",
    privateTypeIndex: "https://pod.example/privateTypeIndex.ttl",
    prepare: async () => {
      throw new Error("secret /private/path");
    },
  };
  await expect(composeDaemon(options)).rejects.toThrow("Daemon composition failed");
  expect(mocks.authenticate).toHaveBeenCalledWith(credentials);
  expect(mocks.storage).toHaveBeenCalledWith({ fetch: io, storage: options.storageRoot });
  expect(logout).toHaveBeenCalledOnce();
  const state = createMemoryState();
  const composition = await composeDaemon({
    ...options,
    prepare: async () =>
      ({
        accounts: [],
        ...state,
        agentWebId: "https://pod.example/agent#me",
        executor: {
          status: vi.fn(async () => "running" as const),
          drain: vi.fn(),
          runOutboxOnce: vi.fn(),
          onApprovalChange: vi.fn(),
          onControlOrMandateChange: vi.fn(),
          transmit: vi.fn(),
        },
        gateway: { reader: { extract: vi.fn() }, proposer: { propose: vi.fn() } },
        proposerContext: {
          instructions: "fixture",
          memoryRecall: vi.fn(),
          pod: {
            root: options.storageRoot,
            webId: options.ownerWebId,
            read: vi.fn(),
            list: vi.fn(),
            write: vi.fn(),
            delete: vi.fn(),
          },
        },
        isFlagged: async () => false,
        proposalWritten: vi.fn(),
        audit: { append: vi.fn(), entries: () => [], sync: vi.fn() },
      }) satisfies Omit<DaemonOptions, "workspace" | "notifications" | "ownerWebId">,
  });
  expect(mocks.notifications).toHaveBeenCalledWith({
    fetch: io,
    storage: { root: options.storageRoot },
  });
  await composition.close();
  expect(logout).toHaveBeenCalledTimes(2);
});
