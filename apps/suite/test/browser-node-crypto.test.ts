// AUTHORED-BY Codex GPT-6.2-Sol
import { createHash as createNodeHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createHash } from "../src/lib/browser-node-crypto";

describe.each(["sha1", "sha256"])("%s", (algorithm) => {
  it.each(["abc", "", "café 東京 🐈", "\ud800"])("matches Node's hex digest for %j", (input) => {
    expect(createHash(algorithm).update(input).digest("hex")).toBe(
      createNodeHash(algorithm).update(input).digest("hex"),
    );
  });

  it("matches Node's hex digest for chained text and byte updates", () => {
    const bytes = Uint8Array.of(0, 128, 255);
    expect(createHash(algorithm).update("café").update(bytes).update("東京").digest("hex")).toBe(
      createNodeHash(algorithm).update("café").update(bytes).update("東京").digest("hex"),
    );
  });

  it("returns a Buffer when the encoding is omitted", () => {
    const digest = createHash(algorithm).update("abc").digest();
    expect(Buffer.isBuffer(digest)).toBe(true);
    expect(digest).toEqual(createNodeHash(algorithm).update("abc").digest());
  });
});

it("rejects unsupported hash algorithms", () => {
  expect(() => createHash("md5")).toThrow("Unsupported hash algorithm: md5");
});

it("rejects unsupported digest encodings", () => {
  expect(() => createHash("sha256").digest("base64")).toThrow(
    "Unsupported digest encoding: base64",
  );
});

it("accepts only UTF-8 as an input encoding", () => {
  expect(createHash("sha256").update("café", "utf8").digest("hex")).toBe(
    createNodeHash("sha256").update("café", "utf8").digest("hex"),
  );
  expect(createHash("sha1").update("café", "utf-8").digest("hex")).toBe(
    createNodeHash("sha1").update("café", "utf-8").digest("hex"),
  );
  expect(() => createHash("sha256").update("00ff", "hex")).toThrow(
    "Unsupported input encoding: hex",
  );
});
