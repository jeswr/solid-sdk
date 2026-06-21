// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate

import { describe, expect, it } from "vitest";
import { assertWithinPod, isContainerUrl, normalizePodBase, resolveTarget } from "../src/scope.js";

const BASE = "https://alice.pod.example/data/";

describe("normalizePodBase", () => {
  it("adds exactly one trailing slash", () => {
    expect(normalizePodBase("https://alice.pod.example/data")).toBe(
      "https://alice.pod.example/data/",
    );
    expect(normalizePodBase("https://alice.pod.example/data/")).toBe(
      "https://alice.pod.example/data/",
    );
  });

  it("strips query and fragment", () => {
    expect(normalizePodBase("https://alice.pod.example/data/?x=1#y")).toBe(
      "https://alice.pod.example/data/",
    );
  });

  it("rejects a non-absolute base", () => {
    expect(() => normalizePodBase("/data/")).toThrow(/absolute/);
    expect(() => normalizePodBase("")).toThrow(/non-empty/);
  });

  it("rejects a non-http(s) scheme", () => {
    expect(() => normalizePodBase("file:///etc/passwd")).toThrow(/http\(s\)/);
    expect(() => normalizePodBase("ftp://host/data/")).toThrow(/http\(s\)/);
  });
});

describe("resolveTarget — accepted targets", () => {
  it("resolves a relative path under the base", () => {
    expect(resolveTarget(BASE, "notes/today.ttl")).toEqual({
      url: "https://alice.pod.example/data/notes/today.ttl",
      container: false,
    });
  });

  it("resolves a leading-slash path RELATIVE to the base (does not escape to origin root)", () => {
    expect(resolveTarget(BASE, "/notes/today.ttl").url).toBe(
      "https://alice.pod.example/data/notes/today.ttl",
    );
  });

  it("accepts an absolute URL that is under the base", () => {
    expect(resolveTarget(BASE, "https://alice.pod.example/data/x.ttl").url).toBe(
      "https://alice.pod.example/data/x.ttl",
    );
  });

  it("recognises a container target (trailing slash)", () => {
    expect(resolveTarget(BASE, "sub/")).toEqual({
      url: "https://alice.pod.example/data/sub/",
      container: true,
    });
  });
});

describe("resolveTarget — refused targets (scope guard)", () => {
  it("refuses a path that traverses above the base", () => {
    expect(() => resolveTarget(BASE, "../secret.ttl")).toThrow(/escapes pod path/);
    expect(() => resolveTarget(BASE, "../../etc/passwd")).toThrow(/escapes pod path/);
  });

  it("refuses an encoded traversal that collapses above the base", () => {
    // %2e%2e decodes to ".." — the URL parser collapses it, then the validator
    // catches the escape.
    expect(() => resolveTarget(BASE, "%2e%2e/secret.ttl")).toThrow(/escapes pod/);
  });

  it("refuses an absolute URL on a different origin", () => {
    expect(() => resolveTarget(BASE, "https://evil.example/data/x.ttl")).toThrow(
      /escapes pod origin/,
    );
  });

  it("refuses an absolute URL under the same origin but outside the base path", () => {
    expect(() => resolveTarget(BASE, "https://alice.pod.example/other/x.ttl")).toThrow(
      /escapes pod path/,
    );
  });

  it("refuses a scheme-relative target (//host) that would re-point origin", () => {
    expect(() => resolveTarget(BASE, "//evil.example/x.ttl")).toThrow(/scheme-relative/);
  });

  it("refuses a non-http(s) absolute target (SSRF / scheme confusion)", () => {
    expect(() => resolveTarget(BASE, "file:///etc/passwd")).toThrow(/http\(s\)/);
  });

  it("refuses an empty target", () => {
    expect(() => resolveTarget(BASE, "")).toThrow(/non-empty/);
    expect(() => resolveTarget(BASE, "   ")).toThrow(/non-empty/);
  });
});

describe("assertWithinPod", () => {
  it("accepts the base itself and strict descendants", () => {
    expect(() => assertWithinPod(BASE, BASE)).not.toThrow();
    expect(() => assertWithinPod(BASE, `${BASE}a/b/c.ttl`)).not.toThrow();
  });

  it("rejects a sibling-path prefix trick (data2 is not under data/)", () => {
    // Path-prefix check is on the normalised base ending in "/", so "data2"
    // cannot masquerade as a child of "data/".
    expect(() => assertWithinPod(BASE, "https://alice.pod.example/data2/x.ttl")).toThrow(
      /escapes pod path/,
    );
  });
});

describe("isContainerUrl", () => {
  it("is true for a trailing-slash path, false otherwise", () => {
    expect(isContainerUrl("https://x.example/a/")).toBe(true);
    expect(isContainerUrl("https://x.example/a")).toBe(false);
  });
});
