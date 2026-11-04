// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Codex GPT-6.1-Sol
// Legacy HTTP fixtures isolate discovery. Protocol-neutral tests inject memory clients.
import { createSolidBackend } from "@jeswr/storage-client/solid";
import { vi } from "vitest";

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
