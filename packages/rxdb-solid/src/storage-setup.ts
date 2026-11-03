// AUTHORED-BY Codex GPT-6.1-Sol
// The legacy HTTP contract tests isolate discovery; factory integration is tested separately.
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
    storage: createSolidBackend({ root: storage, fetch, etagFollowUp: false }),
  }),
}));
