import { describe, it, expect } from "vitest";
import { isOwnPodUrl, isOwnPodWebSocketUrl } from "./own-pod";

const STORAGE = ["https://pod.example/alice/"];

describe("isOwnPodUrl", () => {
  it("accepts a URL within the user's own storage", () => {
    expect(isOwnPodUrl("https://pod.example/alice/issues/", STORAGE)).toBe(true);
    expect(isOwnPodUrl("https://pod.example/alice/inbox/n1.ttl", STORAGE)).toBe(true);
    expect(isOwnPodUrl("https://pod.example/alice/", STORAGE)).toBe(true);
  });

  it("rejects a foreign origin (SSRF guard)", () => {
    expect(isOwnPodUrl("https://evil.example/alice/issues/", STORAGE)).toBe(false);
    expect(isOwnPodUrl("https://pod.attacker/alice/inbox/n1.ttl", STORAGE)).toBe(false);
  });

  it("rejects a sibling pod on the SAME host (path-prefix scoped)", () => {
    // /bob/ is a different pod on the same server — not the user's own.
    expect(isOwnPodUrl("https://pod.example/bob/inbox/n1.ttl", STORAGE)).toBe(false);
  });

  it("rejects a path-prefix near-match that is not actually under the storage", () => {
    // "/alice-evil/" must NOT match the "/alice/" storage prefix.
    expect(isOwnPodUrl("https://pod.example/alice-evil/x.ttl", STORAGE)).toBe(false);
  });

  it("rejects a percent-encoded traversal that escapes the prefix", () => {
    // The URL parser normalises ../ — a candidate that resolves above the storage
    // root is rejected.
    expect(isOwnPodUrl("https://pod.example/alice/../bob/x.ttl", STORAGE)).toBe(false);
  });

  it("rejects non-http(s) schemes (data:/file:/javascript:/blob:)", () => {
    expect(isOwnPodUrl("data:text/turtle,<a>", STORAGE)).toBe(false);
    expect(isOwnPodUrl("file:///etc/passwd", STORAGE)).toBe(false);
    expect(isOwnPodUrl("javascript:alert(1)", STORAGE)).toBe(false);
  });

  it("rejects everything with no own-storage allow-list (fail-closed)", () => {
    expect(isOwnPodUrl("https://pod.example/alice/issues/", [])).toBe(false);
  });

  it("rejects null/undefined/malformed input", () => {
    expect(isOwnPodUrl(null, STORAGE)).toBe(false);
    expect(isOwnPodUrl(undefined, STORAGE)).toBe(false);
    expect(isOwnPodUrl("not a url", STORAGE)).toBe(false);
  });

  it("matches against any of several storage roots", () => {
    const roots = ["https://a.example/me/", "https://b.example/me/"];
    expect(isOwnPodUrl("https://b.example/me/x.ttl", roots)).toBe(true);
    expect(isOwnPodUrl("https://c.example/me/x.ttl", roots)).toBe(false);
  });
});

describe("isOwnPodWebSocketUrl", () => {
  it("accepts a wss URL on the same origin as an https storage", () => {
    expect(isOwnPodWebSocketUrl("wss://pod.example/.notifications/abc?auth=x", STORAGE)).toBe(true);
  });

  it("accepts a ws URL on the same host as an http storage", () => {
    expect(isOwnPodWebSocketUrl("ws://localhost:3000/socket", ["http://localhost:3000/alice/"])).toBe(true);
  });

  it("rejects a wss URL on a FOREIGN host (SSRF guard)", () => {
    expect(isOwnPodWebSocketUrl("wss://evil.example/socket", STORAGE)).toBe(false);
  });

  it("rejects a scheme mismatch (ws against an https-only storage)", () => {
    // An insecure ws:// socket must not be accepted for an https pod.
    expect(isOwnPodWebSocketUrl("ws://pod.example/socket", STORAGE)).toBe(false);
  });

  it("rejects non-ws(s) schemes", () => {
    expect(isOwnPodWebSocketUrl("https://pod.example/alice/issues/", STORAGE)).toBe(false);
    expect(isOwnPodWebSocketUrl("javascript:alert(1)", STORAGE)).toBe(false);
  });

  it("rejects everything with no own-storage allow-list (fail-closed)", () => {
    expect(isOwnPodWebSocketUrl("wss://pod.example/socket", [])).toBe(false);
  });
});
