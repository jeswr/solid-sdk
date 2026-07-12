// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate

import { describe, expect, it } from "vitest";
import { allowedOriginsFor, isAllowedOrigin, normaliseOrigin } from "../../src/protocol/index.js";

describe("normaliseOrigin", () => {
  it("keeps a plain https origin", () => {
    expect(normaliseOrigin("https://app.example")).toBe("https://app.example");
  });

  it("strips any path, query and fragment", () => {
    expect(normaliseOrigin("https://app.example/clientid.jsonld?a=1#x")).toBe(
      "https://app.example",
    );
  });

  it("lowercases scheme and host", () => {
    expect(normaliseOrigin("HTTPS://App.Example.COM")).toBe("https://app.example.com");
  });

  it("elides the default https port (443)", () => {
    expect(normaliseOrigin("https://app.example:443")).toBe("https://app.example");
  });

  it("elides the default http port (80)", () => {
    expect(normaliseOrigin("http://app.example:80")).toBe("http://app.example");
  });

  it("keeps a non-default port", () => {
    expect(normaliseOrigin("https://app.example:8443")).toBe("https://app.example:8443");
    expect(normaliseOrigin("http://localhost:3000")).toBe("http://localhost:3000");
  });

  it("does not elide port 443 for http", () => {
    expect(normaliseOrigin("http://app.example:443")).toBe("http://app.example:443");
  });

  it("throws on a non-URL", () => {
    expect(() => normaliseOrigin("not a url")).toThrow();
  });
});

describe("allowedOriginsFor", () => {
  it("returns the single normalised origin of the client_id URI (v1)", () => {
    expect(allowedOriginsFor("https://app.example/clientid.jsonld")).toEqual([
      "https://app.example",
    ]);
  });

  it("normalises case and default port from the client_id origin", () => {
    expect(allowedOriginsFor("HTTPS://App.Example:443/id.jsonld")).toEqual(["https://app.example"]);
  });

  it("preserves a non-default port from the client_id", () => {
    expect(allowedOriginsFor("https://app.example:8443/id")).toEqual(["https://app.example:8443"]);
  });

  it("throws on a non-URL client_id", () => {
    expect(() => allowedOriginsFor("clientid")).toThrow();
  });
});

describe("isAllowedOrigin", () => {
  it("accepts the matching origin (path on the client_id ignored)", () => {
    expect(isAllowedOrigin("https://app.example", "https://app.example/id.jsonld")).toBe(true);
  });

  it("accepts differing default-port / case forms", () => {
    expect(isAllowedOrigin("https://APP.example:443", "https://app.example/id.jsonld")).toBe(true);
  });

  it("rejects a different host (the phishing gate)", () => {
    expect(isAllowedOrigin("https://evil.example", "https://app.example/id.jsonld")).toBe(false);
  });

  it("rejects a different scheme", () => {
    expect(isAllowedOrigin("http://app.example", "https://app.example/id.jsonld")).toBe(false);
  });

  it("rejects a different (non-default) port", () => {
    expect(isAllowedOrigin("https://app.example:8443", "https://app.example/id.jsonld")).toBe(
      false,
    );
  });

  it("fails closed on a malformed origin", () => {
    expect(isAllowedOrigin("not-an-origin", "https://app.example/id.jsonld")).toBe(false);
  });

  it("fails closed on a malformed client_id", () => {
    expect(isAllowedOrigin("https://app.example", "not-a-url")).toBe(false);
  });
});
