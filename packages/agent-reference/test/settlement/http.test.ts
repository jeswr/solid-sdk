// AUTHORED-BY Codex GPT-6
import { expect, it, vi } from "vitest";
import {
  base64,
  base64url,
  decodeBase64,
  decodeBase64url,
  decodeJson,
  encodeJson,
  header,
  strictJson,
} from "../../src/settlement/http.js";

it("looks up headers without case sensitivity and refuses ambiguous duplicates", () => {
  expect(header({ "pAyMeNt-ReSpOnSe": "value" }, "PAYMENT-RESPONSE")).toBe("value");
  expect(header({}, "Authorization")).toBeUndefined();
  expect(() => header({ X: "a", x: "a" }, "x")).toThrow("ambiguous");
});
it("round trips base64 JSON and unpadded base64url JSON byte for byte", () => {
  const text = '{"amount":"1.25","currency":"GBP","name":"£"}';
  expect(Buffer.from(decodeBase64(base64(text))).toString()).toBe(text);
  expect(Buffer.from(decodeBase64url(base64url(text))).toString()).toBe(text);
  for (const encoding of ["base64", "base64url"] as const)
    expect(decodeJson(encodeJson(JSON.parse(text), encoding), encoding)).toEqual(JSON.parse(text));
});
it.each(["Zg", "Zg=", "Zh==", "Zg==\n", "****", "Zm9v-"])("refuses invalid base64 %s", (value) => {
  expect(() => decodeBase64(value)).toThrow();
});
it.each(["Zg==", "Zh", "a", "Zm9v+", "x y"])("refuses invalid base64url %s", (value) => {
  expect(() => decodeBase64url(value)).toThrow();
});
it.each([
  '{"a":1,"a":2}',
  '{"a":1,"\\u0061":2}',
  '{"x":[{"b":1,"b":2}]}',
  '{"a":1} trailing',
  '{"a":1,}',
  '{"x":1e999}',
  "\uFEFF{}",
])("refuses ambiguous or invalid JSON %s", (value) => {
  expect(() => strictJson(value)).toThrow();
});
it("allows independent nested names and escaped punctuation", () => {
  expect(strictJson('{"x":{"a":1},"y":{"a":2},"text":"}\\"["}')).toEqual({
    x: { a: 1 },
    y: { a: 2 },
    text: '}"[',
  });
});
it("parses strings with ordinary content as well as escape sequences", () => {
  expect(strictJson('{"longKey":"ordinary text content"}')).toEqual({
    longKey: "ordinary text content",
  });
});
it("detects duplicate member names when whitespace precedes the colon", () => {
  expect(() => strictJson('{ "a" \t: 1, "a" \r\n: 2 }')).toThrow("duplicate JSON member");
});
it("enforces UTF-8 byte limits before parsing and refuses invalid UTF-8", () => {
  expect(() => strictJson('"£"', 3)).toThrow("too large");
  expect(() => strictJson(Uint8Array.of(0xff))).toThrow();
  expect(() => decodeBase64(base64("abc"), 2)).toThrow("too large");
  expect(() => decodeBase64url(base64url("abcd"), 1)).toThrow("too large");
  expect(() => strictJson("{}", 0)).toThrow("limit");
  expect(() => decodeBase64("", 0)).toThrow("limit");
});
it("refuses oversized encodings before allocating decoded bytes", () => {
  const encoded = "A".repeat(100);
  const decoder = vi.spyOn(Buffer, "from");
  try {
    expect(() => decodeBase64(encoded, 1)).toThrow("too large");
    expect(decoder.mock.calls.some(([input]) => input === encoded)).toBe(false);
  } finally {
    decoder.mockRestore();
  }
});
