// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Codex GPT-6.1-Sol
// Legacy HTTP fixtures isolate discovery. Protocol-neutral tests inject memory clients.
import { createSolidBackend } from "@jeswr/storage-client/solid";
import { vi } from "vitest";

// Scripted HTTPS fixture hosts do not exist in public DNS. Keep the real guard
// and its per-hop checks; substitute only DNS, never the guarded transport.
vi.mock("node:dns/promises", () => ({
  lookup: async (host: string) => [
    { address: host === "localhost" ? "127.0.0.1" : "93.184.216.34", family: 4 },
  ],
}));

vi.mock("@jeswr/storage-client", async (original) => ({
  ...(await original<object>()),
  createPodClient: async ({
    storage,
    fetch,
  }: {
    storage: string;
    fetch: typeof globalThis.fetch;
  }) => ({
    description: { id: new URL("/", storage).href },
    storage: createSolidBackend({ root: new URL("/", storage).href, fetch, etagFollowUp: false }),
  }),
}));
