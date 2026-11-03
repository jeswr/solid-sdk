// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { expect, expectTypeOf, test } from "vitest";
import {
  ACL,
  type AccessClient,
  type AccessGrant,
  type AccessMode,
  emptyPolicy,
  type Grant,
  type Mode,
  readAcp,
  readModes,
  readWac,
  translatePolicy,
  writeAcp,
  writeWac,
} from "./index.js";
import * as testing from "./testing.js";

test("keeps sharing grants distinct from translation rules in the public API", () => {
  expectTypeOf<Parameters<AccessClient["share"]>[1]>().toEqualTypeOf<AccessGrant>();
  expectTypeOf<Awaited<ReturnType<AccessClient["share"]>>>().toEqualTypeOf<AccessGrant>();
  expectTypeOf<Awaited<ReturnType<AccessClient["grants"]>>>().toEqualTypeOf<
    readonly AccessGrant[]
  >();
  expectTypeOf<AccessGrant["modes"]>().toEqualTypeOf<readonly AccessMode[]>();
  expectTypeOf<Grant["modes"]>().toEqualTypeOf<Set<Mode>>();
  expectTypeOf<Grant>().not.toExtend<AccessGrant>();
  expectTypeOf<AccessGrant>().not.toExtend<Grant>();
});

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
