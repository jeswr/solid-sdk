// AUTHORED-BY Claude Opus 5.5
import { expect, it } from "vitest";
import {
  decodeIdentifierRef,
  decodeRef,
  encodeIdentifierRef,
  encodeRef,
  InvalidRefError,
} from "../src/lib/refs";

it("round-trips an RDF identifier exactly, without URL normalization", () => {
  const id = "https://bob.example/chat/room/2026/11/03.ttl#café";
  expect(decodeIdentifierRef(encodeIdentifierRef(id))).toBe(id);
  // encodeRef normalizes, so the literal subject would no longer match.
  expect(decodeRef(encodeRef(id))).toBe("https://bob.example/chat/room/2026/11/03.ttl#caf%C3%A9");
  // Already-normal IRIs encode identically, so existing links keep working.
  const plain = "https://alice.example/chat/rooms/a/2026/11/03.ttl#m-1";
  expect(encodeIdentifierRef(plain)).toBe(encodeRef(plain));
});

it("refuses non-http identifiers and malformed references", () => {
  expect(() => encodeIdentifierRef("urn:example:1")).toThrow();
  expect(() =>
    decodeIdentifierRef(encodeIdentifierRef("https://a.example/#x").slice(1) + "%"),
  ).toThrow(InvalidRefError);
  const urn = btoa("urn:example:1").replace(/=+$/, "");
  expect(() => decodeIdentifierRef(urn)).toThrow(InvalidRefError);
  const invalidUtf8 = btoa(String.fromCharCode(0xff, 0xfe)).replace(/=+$/, "");
  expect(() => decodeIdentifierRef(invalidUtf8)).toThrow(InvalidRefError);
});
