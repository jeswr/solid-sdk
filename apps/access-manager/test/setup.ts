// AUTHORED-BY Claude Fable 5
// Shared vitest setup: reset module-level memos between tests.
import { beforeEach } from "vitest";
import { clearAgentDisplayCache } from "../src/lib/profile.js";

beforeEach(() => {
  clearAgentDisplayCache();
});
