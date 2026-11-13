// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Fable 5
// Shared vitest setup: reset browser state and module-level memos between tests.
import { Blob } from "node:buffer";
import { beforeEach, vi } from "vitest";

// jsdom supplies its own Blob, while Response remains Node/Undici. Keep their body types compatible.
vi.stubGlobal("Blob", Blob);

import { clearAgentDisplayCache } from "../src/lib/profile.js";

beforeEach(() => {
  if (typeof window !== "undefined") {
    window.localStorage.clear();
  }
  clearAgentDisplayCache();
});
