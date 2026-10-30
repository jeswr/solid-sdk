// AUTHORED-BY Codex GPT-6.1-Sol
import { expect, test } from "vitest";
import { emptyPolicy, readAcp, readWac, translatePolicy, writeAcp, writeWac } from "./index.js";
import * as testing from "./testing.js";

test("exposes the translation core and keeps the testing entry point reserved", () => {
  expect(emptyPolicy()).toEqual({ grants: [], denials: [] });
  for (const operation of [readAcp, readWac, translatePolicy, writeAcp, writeWac]) {
    expect(operation).toBeTypeOf("function");
  }
  expect(Object.keys(testing)).toEqual([]);
});
