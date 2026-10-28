// AUTHORED-BY Codex
import { describe, expect, it } from "vitest";
import { decodeRef, encodeRef, InvalidRefError } from "../src/lib/refs";

describe("route references", () => {
  it.each([
    "https://example.org/",
    "http://localhost:3210/drive/file?download=1#part",
    "HTTPS://EXAMPLE.ORG:443/a/../Café 💡.txt?q=日本語#résumé",
    "https://example.org/???~~~",
  ])("round-trips the canonical HTTP URL %s without padding", (input) => {
    const canonical = new URL(input).href;
    const ref = encodeRef(input);
    expect(ref).toBe(Buffer.from(canonical).toString("base64url"));
    expect(ref).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeRef(ref)).toBe(canonical);
  });

  it.each([
    "",
    "/relative",
    "not a URL",
    "ftp://example.org/file",
    "file:///tmp/file",
  ])("rejects encoding %j", (url) => expect(() => encodeRef(url)).toThrow(TypeError));

  it.each([
    "",
    "has padding=",
    "has+plus",
    "has/slash",
    "a",
    Buffer.from([0xff]).toString("base64url"),
    Buffer.from("not a URL").toString("base64url"),
    Buffer.from("ftp://example.org/").toString("base64url"),
    Buffer.from("http://EXAMPLE.org:80").toString("base64url"),
  ])("rejects invalid, non-UTF-8, non-HTTP and noncanonical reference %j", (ref) => {
    expect(() => decodeRef(ref)).toThrow(InvalidRefError);
    expect(() => decodeRef(ref)).toThrow(
      expect.objectContaining({
        ref,
        name: "InvalidRefError",
        message: "Not a valid resource reference",
      }),
    );
  });
});
