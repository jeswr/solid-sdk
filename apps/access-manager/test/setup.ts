// AUTHORED-BY Claude Fable 5
// Shared vitest setup: reset browser state and module-level memos between tests.
import { beforeEach } from "vitest";
import { clearAgentDisplayCache } from "../src/lib/profile.js";

beforeEach(() => {
  if (typeof window !== "undefined") {
    window.localStorage.clear();
  }
  clearAgentDisplayCache();
});
