// AUTHORED-BY Codex GPT-6.1-Sol
import { expect, test } from "vitest";
import * as entry1 from "./cache.js";
import * as entry0 from "./index.js";
import * as entry3 from "./testing.js";
import * as entry2 from "./vocab.js";

test("scaffold entry points load without exposing an implementation", () => {
  for (const entry of [entry0, entry1, entry2, entry3]) {
    expect(Object.keys(entry)).toEqual([]);
  }
});
