// AUTHORED-BY Claude Fable 5
/**
 * Adversarial pins for the container-scope guard (`./scope.ts`) — the store's
 * primary security surface. These cases pin the WHATWG-URL normalisation the
 * guard relies on (dot-segment + percent-encoded-dot-segment + backslash
 * resolution) and the userinfo refusal, so a regression in any of them fails a
 * named test rather than silently widening the scope.
 */
import { describe, expect, it } from "vitest";
import { assertWithinBase, normalizeContainer } from "./scope.js";

const CONTAINER = "https://alice.pod/memories/";

describe("assertWithinBase — path-traversal attempts are normalised then refused", () => {
  const escapers = [
    // Literal dot-segments resolve out of the container path.
    "https://alice.pod/memories/../secret",
    "https://alice.pod/memories/x/../../secret",
    // Percent-encoded dot-segments (%2e = ".") are treated as dot-segments by the
    // WHATWG URL parser and resolve out too.
    "https://alice.pod/memories/%2e%2e/secret",
    "https://alice.pod/memories/%2E%2E/secret",
    "https://alice.pod/memories/.%2e/secret",
    // Backslash is a path separator in special schemes — `..\` escapes like `../`.
    "https://alice.pod/memories/..\\secret",
  ];
  for (const url of escapers) {
    it(`refuses ${url}`, () => {
      expect(() => assertWithinBase(CONTAINER, url)).toThrow(/escapes container|container root/);
    });
  }

  it("still accepts a genuine descendant after dot-segment resolution", () => {
    // `a/../b` normalises to `b`, which is INSIDE the container — allowed.
    expect(() => assertWithinBase(CONTAINER, "https://alice.pod/memories/a/../b")).not.toThrow();
  });

  it("refuses a prefix-cousin path (no trailing-slash confusion)", () => {
    // The container path ends "/" so "/memoriesevil" is not a prefix match.
    expect(() => assertWithinBase(CONTAINER, "https://alice.pod/memoriesevil/x")).toThrow(
      /escapes container/,
    );
  });

  it("refuses a same-host different-port target (origin includes the port)", () => {
    expect(() => assertWithinBase(CONTAINER, "https://alice.pod:8443/memories/x")).toThrow(
      /escapes container origin/,
    );
  });
});

describe("userinfo (embedded credentials) is refused", () => {
  it("assertWithinBase refuses a target with user:pass even on the right host+path", () => {
    expect(() => assertWithinBase(CONTAINER, "https://user:pass@alice.pod/memories/x")).toThrow(
      /userinfo refused/,
    );
    expect(() => assertWithinBase(CONTAINER, "https://user@alice.pod/memories/x")).toThrow(
      /userinfo refused/,
    );
  });

  it("normalizeContainer refuses a container with embedded credentials", () => {
    expect(() => normalizeContainer("https://user:pass@alice.pod/memories/")).toThrow(
      /userinfo refused/,
    );
  });
});
