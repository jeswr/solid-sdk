// AUTHORED-BY Codex GPT-6.1-Sol
import { expect, test } from "vitest";
import * as cache from "./cache.js";
import * as api from "./index.js";
import * as testing from "./testing.js";

test("type-only public API and reserved runtime entry points load", () => {
  expect(Object.keys(api)).toEqual([]);
  expect(Object.keys(cache)).toEqual([]);
  expect(Object.keys(testing)).toEqual([]);
});
