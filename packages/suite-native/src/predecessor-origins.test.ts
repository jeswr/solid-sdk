// AUTHORED-BY Codex GPT-6
import { describe, expect, it } from "vitest";
import { validatePredecessorOrigins } from "./predecessor-origins.js";

describe("validatePredecessorOrigins", () => {
  it("accepts empty plans and preserves exact origins, order and duplicates without mutation", () => {
    expect(validatePredecessorOrigins([])).toEqual({ valid: true, origins: [] });
    const origins = Object.freeze([
      "https://old.example",
      "https://other.example:8443",
      "https://old.example",
      "https://old.example:1",
      "https://old.example:65535",
      "https://127.0.0.1",
      "https://[::1]:8443",
    ]);
    expect(validatePredecessorOrigins(origins)).toEqual({ valid: true, origins });
  });

  it("bounds the original list at 32 entries even when all entries are duplicates", () => {
    const origins = Array(32).fill("https://old.example");
    expect(validatePredecessorOrigins(origins)).toEqual({ valid: true, origins });
    expect(validatePredecessorOrigins([...origins, "https://old.example"])).toEqual({
      valid: false,
      reason: "list",
    });
  });

  it.each([
    undefined,
    null,
    true,
    1,
    {},
    "https://old.example",
  ])("rejects a non-array plan %j", (value) => {
    expect(validatePredecessorOrigins(value)).toEqual({ valid: false, reason: "list" });
  });

  it.each([
    "http://old.example",
    "capacitor://localhost",
    "https://localhost",
    "https://a.localhost",
    "https://a.b.localhost:8443",
    "https://localhost:443",
    "https://old.example/",
    "https://old.example/path",
    "https://old.example/../",
    "https://old.example?",
    "https://old.example?x=y",
    "https://old.example#",
    "https://old.example#fragment",
    "https://user@old.example",
    "https://user:secret@old.example",
    "https://:secret@old.example",
    "https://@old.example",
    " https://old.example",
    "https://old.example\n",
    "https://old.example\\path",
    "https://OLD.example",
    "HTTPS://old.example",
    "https://%6fld.example",
    "https://old.example:443",
    "https://old.example:0",
    "https://old.example:00080",
    "https://old.example:65536",
    "file:///etc/passwd",
    "not a URL",
    "",
    null,
    1,
    true,
    {},
    [],
  ])("rejects the entire plan containing hostile entry %j", (entry) => {
    expect(validatePredecessorOrigins(["https://valid.example", entry])).toEqual({
      valid: false,
      reason: "origin",
    });
  });

  it("checks entries after duplicates and rejects sparse arrays", () => {
    expect(
      validatePredecessorOrigins([
        "https://old.example",
        "https://old.example",
        "https://bad.example/path",
      ]),
    ).toEqual({ valid: false, reason: "origin" });
    expect(validatePredecessorOrigins(Array(1))).toEqual({ valid: false, reason: "origin" });
  });
});
