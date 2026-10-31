// AUTHORED-BY Codex GPT-6.1-Sol
import { expect, test } from "vitest";
import {
  ACL,
  emptyPolicy,
  readAcp,
  readModes,
  readWac,
  translatePolicy,
  writeAcp,
  writeWac,
} from "./index.js";
import * as testing from "./testing.js";

test("exposes the translation core and keeps the testing entry point reserved", () => {
  expect(emptyPolicy()).toEqual({ grants: [], denials: [] });
  for (const operation of [readAcp, readWac, translatePolicy, writeAcp, writeWac]) {
    expect(operation).toBeTypeOf("function");
  }
  expect(Object.keys(testing)).toEqual([]);
});

test.each([
  [[], []],
  [[`${ACL}Write`], ["write", "append"]],
  [[`${ACL}Append`], ["append"]],
  [
    [`${ACL}Control`, "urn:unknown-mode", `${ACL}Read`, `${ACL}Write`, `${ACL}Read`],
    ["read", "append", "write", "control"],
  ],
])("reads mode iterable %j in one pass", (iris, expected) => {
  expect(readModes(new Set(iris).values())).toEqual(new Set(expected));
  expect(readModes(iris)).toEqual(new Set(expected));
});
