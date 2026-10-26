// AUTHORED-BY Claude Opus 5.5
import { describe, expect, test } from "vitest";
import { applyJsonPatch, JsonPatchError, jsonEqual } from "./json-patch.js";
import type { JsonPatchOp } from "./types.js";

type Case = [name: string, doc: unknown, patch: unknown[], expected: unknown];

// RFC 6902 Appendix A: every example (A.1–A.16).
const rfcSuccess: Case[] = [
  [
    "A.1 add an object member",
    { foo: "bar" },
    [{ op: "add", path: "/baz", value: "qux" }],
    { baz: "qux", foo: "bar" },
  ],
  [
    "A.2 add an array element",
    { foo: ["bar", "baz"] },
    [{ op: "add", path: "/foo/1", value: "qux" }],
    { foo: ["bar", "qux", "baz"] },
  ],
  [
    "A.3 remove an object member",
    { baz: "qux", foo: "bar" },
    [{ op: "remove", path: "/baz" }],
    { foo: "bar" },
  ],
  [
    "A.4 remove an array element",
    { foo: ["bar", "qux", "baz"] },
    [{ op: "remove", path: "/foo/1" }],
    { foo: ["bar", "baz"] },
  ],
  [
    "A.5 replace a value",
    { baz: "qux", foo: "bar" },
    [{ op: "replace", path: "/baz", value: "boo" }],
    { baz: "boo", foo: "bar" },
  ],
  [
    "A.6 move a value",
    { foo: { bar: "baz", waldo: "fred" }, qux: { corge: "grault" } },
    [{ op: "move", from: "/foo/waldo", path: "/qux/thud" }],
    { foo: { bar: "baz" }, qux: { corge: "grault", thud: "fred" } },
  ],
  [
    "A.7 move an array element",
    { foo: ["all", "grass", "cows", "eat"] },
    [{ op: "move", from: "/foo/1", path: "/foo/3" }],
    { foo: ["all", "cows", "eat", "grass"] },
  ],
  [
    "A.8 testing a value: success",
    { baz: "qux", foo: ["a", 2, "c"] },
    [
      { op: "test", path: "/baz", value: "qux" },
      { op: "test", path: "/foo/1", value: 2 },
    ],
    { baz: "qux", foo: ["a", 2, "c"] },
  ],
  [
    "A.10 adding a nested member object",
    { foo: "bar" },
    [{ op: "add", path: "/child", value: { grandchild: {} } }],
    { foo: "bar", child: { grandchild: {} } },
  ],
  [
    "A.11 ignoring unrecognized elements",
    { foo: "bar" },
    [{ op: "add", path: "/baz", value: "qux", xyz: 123 }],
    { foo: "bar", baz: "qux" },
  ],
  [
    "A.14 ~ escape ordering",
    { "/": 9, "~1": 10 },
    [{ op: "test", path: "/~01", value: 10 }],
    { "/": 9, "~1": 10 },
  ],
  [
    "A.16 adding an array value",
    { foo: ["bar"] },
    [{ op: "add", path: "/foo/-", value: ["abc", "def"] }],
    { foo: ["bar", ["abc", "def"]] },
  ],
];

const rfcFailure: [name: string, doc: unknown, patch: unknown[], kind: "invalid" | "conflict"][] = [
  [
    "A.9 testing a value: error",
    { baz: "qux" },
    [{ op: "test", path: "/baz", value: "bar" }],
    "conflict",
  ],
  [
    "A.12 adding to a nonexistent target",
    { foo: "bar" },
    [{ op: "add", path: "/baz/bat", value: "qux" }],
    "conflict",
  ],
  [
    "A.15 comparing strings and numbers",
    { "/": 9, "~1": 10 },
    [{ op: "test", path: "/~01", value: "10" }],
    "conflict",
  ],
];

describe("RFC 6902 Appendix A", () => {
  test.each(rfcSuccess)("%s", (_name, doc, patch, expected) => {
    expect(applyJsonPatch(doc, patch as JsonPatchOp[])).toEqual(expected);
  });

  test.each(rfcFailure)("%s", (_name, doc, patch, kind) => {
    expect(() => applyJsonPatch(doc, patch as JsonPatchOp[])).toThrow(
      expect.objectContaining({ name: "JsonPatchError", kind }),
    );
  });

  test("A.13 invalid JSON Patch document (duplicate op members collapse in JSON.parse)", () => {
    const patch = JSON.parse('[{ "op": "add", "path": "/baz", "value": "qux", "op": "remove" }]');
    expect(() => applyJsonPatch({ foo: "bar" }, patch)).toThrow(JsonPatchError);
  });
});

describe("applyJsonPatch semantics", () => {
  test("is atomic and does not mutate its input", () => {
    const doc = { a: [1, 2], b: { c: 1 } };
    expect(() =>
      applyJsonPatch(doc, [
        { op: "add", path: "/a/-", value: 3 },
        { op: "test", path: "/b/c", value: 2 },
      ]),
    ).toThrow(JsonPatchError);
    expect(doc).toEqual({ a: [1, 2], b: { c: 1 } });
  });

  test("whole-document operations", () => {
    expect(applyJsonPatch({ a: 1 }, [{ op: "replace", path: "", value: [1] }])).toEqual([1]);
    expect(applyJsonPatch({ a: 1 }, [{ op: "add", path: "", value: "x" }])).toBe("x");
    expect(applyJsonPatch({ a: 1 }, [{ op: "test", path: "", value: { a: 1 } }])).toEqual({ a: 1 });
    expect(() => applyJsonPatch({ a: 1 }, [{ op: "remove", path: "" }])).toThrow(/whole document/);
  });

  test("copy duplicates, replace requires existence, move rejects moving into a child", () => {
    expect(applyJsonPatch({ a: { b: 1 } }, [{ op: "copy", from: "/a", path: "/c" }])).toEqual({
      a: { b: 1 },
      c: { b: 1 },
    });
    expect(() => applyJsonPatch({}, [{ op: "replace", path: "/x", value: 1 }])).toThrow(
      expect.objectContaining({ kind: "conflict" }),
    );
    expect(() =>
      applyJsonPatch({ a: { b: 1 } }, [{ op: "move", from: "/a", path: "/a/b/c" }]),
    ).toThrow(/children/);
    expect(applyJsonPatch({ a: 1 }, [{ op: "move", from: "/a", path: "/a" }])).toEqual({ a: 1 });
    expect(applyJsonPatch([1, 2, 3], [{ op: "replace", path: "/1", value: 9 }])).toEqual([1, 9, 3]);
  });

  test("array index rules (RFC 6901)", () => {
    expect(() => applyJsonPatch([1], [{ op: "add", path: "/01", value: 0 }])).toThrow(
      /Invalid array index/,
    );
    expect(() => applyJsonPatch([1], [{ op: "add", path: "/2", value: 0 }])).toThrow(
      /out of bounds/,
    );
    expect(() => applyJsonPatch([1], [{ op: "remove", path: "/1" }])).toThrow(/out of bounds/);
    expect(() => applyJsonPatch([1], [{ op: "remove", path: "/-" }])).toThrow(
      /Invalid array index/,
    );
    expect(applyJsonPatch([1], [{ op: "add", path: "/1", value: 2 }])).toEqual([1, 2]);
    expect(applyJsonPatch({ a: [[1]] }, [{ op: "test", path: "/a/0/0", value: 1 }])).toEqual({
      a: [[1]],
    });
  });

  test("path errors", () => {
    expect(() => applyJsonPatch({}, [{ op: "remove", path: "/missing" }])).toThrow(
      /Path not found/,
    );
    expect(() => applyJsonPatch({ a: 1 }, [{ op: "test", path: "/a/b", value: 1 }])).toThrow(
      /Path not found/,
    );
    expect(() => applyJsonPatch({ a: 1 }, [{ op: "add", path: "/a/b", value: 1 }])).toThrow(
      /not a container/,
    );
    expect(() => applyJsonPatch({}, [{ op: "add", path: "a", value: 1 }])).toThrow(/JSON Pointer/);
    expect(() => applyJsonPatch({}, [{ op: "add", path: "/~2", value: 1 }])).toThrow(
      /Invalid escape/,
    );
    expect(() => applyJsonPatch({}, [{ op: "copy", path: "/a" } as JsonPatchOp])).toThrow(
      /from must be a string/,
    );
    expect(() =>
      applyJsonPatch({ toString: 1 }, [{ op: "remove", path: "/toString" }]),
    ).not.toThrow();
    expect(() => applyJsonPatch({}, [{ op: "test", path: "/toString", value: 1 }])).toThrow(
      /Path not found/,
    );
  });

  test("malformed operations are invalid", () => {
    const invalid = (patch: unknown) =>
      expect(() => applyJsonPatch({}, patch as JsonPatchOp[])).toThrow(
        expect.objectContaining({ kind: "invalid" }),
      );
    invalid({});
    invalid([null]);
    invalid([{ op: "add", path: "/a" }]);
    invalid([{ op: "replace", path: "/a" }]);
    invalid([{ op: "test", path: "/a" }]);
    invalid([{ op: "frobnicate", path: "/a" }]);
    invalid([{ op: "add", path: 5, value: 1 }]);
    invalid([{ op: "add", path: "/a", value: undefined }]);
    invalid([{ op: "add", path: "/a", value: 10n }]);
  });

  test("__proto__ is an ordinary member name", () => {
    const result = applyJsonPatch({}, [
      { op: "add", path: "/__proto__", value: { polluted: true } },
    ]);
    expect(Object.hasOwn(result as object, "__proto__")).toBe(true);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe("jsonEqual", () => {
  test.each([
    [{ a: 1, b: [1, { c: 2 }] }, { b: [1, { c: 2 }], a: 1 }, true],
    [[1, 2], [1, 2, 3], false],
    [[1], { 0: 1 }, false],
    [{ a: 1 }, { b: 1 }, false],
    [{ a: 1 }, { a: 1, b: 2 }, false],
    [null, {}, false],
    [1, "1", false],
    ["x", "x", true],
  ])("%j vs %j", (a, b, equal) => {
    expect(jsonEqual(a, b)).toBe(equal);
  });
});
