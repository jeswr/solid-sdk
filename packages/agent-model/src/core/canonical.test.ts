// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it } from "vitest";
import { canonicalJson, derivedUrn, digestOf, isIri } from "./canonical.js";

describe("RFC 8785 content identity", () => {
  it("sorts recursively even when toJSON is an ordinary JSON property", () => {
    const left = { toJSON: null, z: [{ b: 2, a: 1 }], a: { z: 0, a: true } };
    const right = { a: { a: true, z: 0 }, z: [{ a: 1, b: 2 }], toJSON: null };
    const expected = '{"a":{"a":true,"z":0},"toJSON":null,"z":[{"a":1,"b":2}]}';
    expect(canonicalJson(left)).toBe(expected);
    expect(canonicalJson(right)).toBe(expected);
    expect(digestOf(left)).toBe(digestOf(right));
    expect(derivedUrn("terms", left)).toBe(derivedUrn("terms", right));
    expect(canonicalJson({ toJSON: "opaque", b: 2, a: 1 })).toBe('{"a":1,"b":2,"toJSON":"opaque"}');
  });

  it("uses ECMAScript number and string encoding", () => {
    expect(
      canonicalJson(JSON.parse("[333333333.33333329,1e30,4.50,2e-3,1e-27,-0,5e-324,1e21,1e-6]")),
    ).toBe("[333333333.3333333,1e+30,4.5,0.002,1e-27,0,5e-324,1e+21,0.000001]");
    expect(canonicalJson('€\u000f\n"\\/😀')).toBe('"€\\u000f\\n\\"\\\\/😀"');
    expect(canonicalJson([null, true, false])).toBe("[null,true,false]");
    expect(digestOf({ b: 2, a: 1 })).toBe(
      "sha-256:43258cff783fe7036d8a43033f830adfc60ec037382473548ac742b888292777",
    );
  });

  it("orders raw property names by UTF-16 code units, including numeric keys", () => {
    expect(canonicalJson(JSON.parse('{"€":1,"\\r":2,"דּ":3,"1":4,"😀":5,"\u0080":6,"ö":7}'))).toBe(
      '{"\\r":2,"1":4,"\u0080":6,"ö":7,"€":1,"😀":5,"דּ":3}',
    );
    expect(canonicalJson({ "2": 2, "10": 10 })).toBe('{"10":10,"2":2}');
    expect(canonicalJson(JSON.parse('{"é":1,"e\u0301":2}'))).toBe('{"e\u0301":2,"é":1}');
  });

  it("preserves own __proto__ properties and permits repeated noncyclic values", () => {
    const value = JSON.parse('{"__proto__":{"z":1,"a":2},"constructor":null}');
    expect(canonicalJson(value)).toBe('{"__proto__":{"a":2,"z":1},"constructor":null}');
    const shared = Object.assign(Object.create(null), { b: 2, a: 1 });
    expect(canonicalJson([shared, shared])).toBe('[{"a":1,"b":2},{"a":1,"b":2}]');
  });

  it.each([
    undefined,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    1n,
    Symbol("invalid"),
    () => null,
    "\ud800",
    "\udfff",
    "x\ud800x",
  ])("rejects invalid primitives at every depth: %s", (value) => {
    for (const input of [value, { nested: { value } }, [0, [value]]]) {
      expect(() => canonicalJson(input)).toThrow(TypeError);
      expect(() => digestOf(input)).toThrow(TypeError);
    }
  });

  it("rejects malformed keys, cycles, holes and values outside the JSON data model", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const arrayCycle: unknown[] = [];
    arrayCycle.push(arrayCycle);
    const sparse = [0, 1];
    Reflect.deleteProperty(sparse, "0");
    for (const value of [
      { "\ud800": 1 },
      cyclic,
      arrayCycle,
      new Array(2),
      sparse,
      Object.assign([1], { extra: 2 }),
      Object.assign(new Array(1), { extra: 2 }),
      { [Symbol("key")]: 1 },
      Object.defineProperty({}, "hidden", { value: 1 }),
      new Date("2026-10-26T00:00:00Z"),
      new Map(),
      new Set(),
      new Uint8Array([1]),
      Object(1),
    ]) {
      expect(() => canonicalJson(value)).toThrow(TypeError);
    }
  });

  it("rejects accessors and toJSON functions without executing them", () => {
    let calls = 0;
    const hook = () => {
      calls++;
      return { b: 2, a: 1 };
    };
    for (const value of [
      { toJSON: hook },
      Object.defineProperty({}, "value", { enumerable: true, get: hook }),
      Object.defineProperty([1], "0", { enumerable: true, get: hook }),
    ]) {
      expect(() => canonicalJson(value)).toThrow(TypeError);
    }
    expect(calls).toBe(0);
  });
});

describe("IRI identifiers", () => {
  it.each([
    ...Array.from({ length: 32 }, (_, code) => code),
    0x7f,
  ])("rejects control character U+%i", (code) => {
    for (const prefix of ["urn:example:", "https://record.example/"]) {
      expect(isIri(`${prefix}before${String.fromCharCode(code)}after`)).toBe(false);
    }
  });
  it("continues to accept Unicode IRIs and valid fragments", () => {
    for (const value of ["urn:example:identifier", "https://record.example/é/😀#it"]) {
      expect(isIri(value)).toBe(true);
    }
  });
});
