// AUTHORED-BY Claude Sonnet 5
//
// Tests for the n8n-SPECIFIC pod-scope wrapper (`src/scope.ts`). The generic
// pod-scope behaviour (origin/path/traversal/encoded-delimiter/credentials/
// scheme-relative/redaction) is now owned + exhaustively tested by
// `@jeswr/guarded-fetch`'s own suite, so this file only characterises the thin
// wrapper this repo keeps on top of it:
//   - `resolveTarget` — including the ONE genuinely repo-specific convenience: a
//     leading-slash target re-roots RELATIVE TO THE BASE PATH (not the origin root);
//   - that `resolveTarget` returns the CANONICAL URL and still fails closed by
//     delegating to the shared primitive;
//   - that the pure re-exports (`isContainerUrl`/`normalizePodBase`/`redactUserinfo`)
//     are wired through from `@jeswr/guarded-fetch`;
//   - the `assertWithinPod` back-compat void wrapper.

import { describe, expect, it } from "vitest";
import {
  assertWithinPod,
  isContainerUrl,
  normalizePodBase,
  redactUserinfo,
  resolveTarget,
} from "../src/scope.js";

const BASE = "https://alice.pod.example/data/";

describe("resolveTarget — accepted targets (returns the canonical in-scope URL)", () => {
  it("resolves a relative path under the base", () => {
    expect(resolveTarget(BASE, "notes/today.ttl")).toEqual({
      url: "https://alice.pod.example/data/notes/today.ttl",
      container: false,
    });
  });

  it("re-roots a LEADING-SLASH path RELATIVE to the base (the n8n-specific convenience)", () => {
    // This is the one behaviour the shared `assertWithinPodScope` deliberately does
    // NOT provide (a root-absolute ref there resolves at the origin root and is
    // refused). The wrapper strips the leading slash so it re-roots under the base.
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

  it("accepts the base itself (allowRoot — the node never rejected the pod root)", () => {
    expect(resolveTarget(BASE, BASE).url).toBe(BASE);
  });
});

describe("resolveTarget — refused targets (delegates to the shared guard, fail-closed)", () => {
  it("refuses an empty target (the wrapper's own guard)", () => {
    expect(() => resolveTarget(BASE, "")).toThrow(/non-empty/);
    expect(() => resolveTarget(BASE, "   ")).toThrow(/non-empty/);
  });

  it("refuses a scheme-relative target (//host) — checked BEFORE the leading-slash strip", () => {
    expect(() => resolveTarget(BASE, "//evil.example/x.ttl")).toThrow(/scheme-relative/);
  });

  it("refuses a path that traverses above the base", () => {
    expect(() => resolveTarget(BASE, "../secret.ttl")).toThrow(/escapes pod path/);
    expect(() => resolveTarget(BASE, "../../etc/passwd")).toThrow(/escapes pod path/);
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

  it("refuses an encoded path delimiter (%2F/%5C)", () => {
    expect(() => resolveTarget(BASE, "..%2fsecret.ttl")).toThrow(/encoded path delimiter/);
    expect(() => resolveTarget(BASE, "a%5Cb.ttl")).toThrow(/encoded path delimiter/);
  });

  it("refuses a non-http(s) absolute target (SSRF / scheme confusion)", () => {
    expect(() => resolveTarget(BASE, "file:///etc/passwd")).toThrow(/http\(s\)/);
  });

  it("refuses a same-origin target that embeds credentials, without leaking them", () => {
    const secret = "https://alice:s3cr3t-p4ss@alice.pod.example/data/x.ttl";
    let message = "";
    try {
      resolveTarget(BASE, secret);
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toMatch(/must not embed credentials/);
    expect(message).not.toContain("s3cr3t-p4ss");
    expect(message).not.toContain("alice:");
  });

  it("does NOT leak credentials from the wrapper's own scheme-relative error", () => {
    let message = "";
    try {
      resolveTarget(BASE, "//alice:s3cr3t-p4ss@evil.example/x.ttl");
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toMatch(/scheme-relative/);
    expect(message).not.toContain("s3cr3t-p4ss");
    expect(message).not.toContain("alice:");
  });
});

describe("assertWithinPod (back-compat void wrapper over assertWithinPodScope)", () => {
  it("accepts the base itself and strict descendants", () => {
    expect(() => assertWithinPod(BASE, BASE)).not.toThrow();
    expect(() => assertWithinPod(BASE, `${BASE}a/b/c.ttl`)).not.toThrow();
  });

  it("rejects a sibling-path prefix trick (data2 is not under data/)", () => {
    expect(() => assertWithinPod(BASE, "https://alice.pod.example/data2/x.ttl")).toThrow(
      /escapes pod path/,
    );
  });
});

describe("re-exports are wired through from @jeswr/guarded-fetch", () => {
  it("normalizePodBase normalises to a single trailing slash and strips query/fragment", () => {
    expect(normalizePodBase("https://alice.pod.example/data")).toBe(BASE);
    expect(normalizePodBase("https://alice.pod.example/data/?x=1#y")).toBe(BASE);
    expect(() => normalizePodBase("file:///etc/passwd")).toThrow(/http\(s\)/);
  });

  it("isContainerUrl reflects the LDP trailing-slash convention", () => {
    expect(isContainerUrl("https://x.example/a/")).toBe(true);
    expect(isContainerUrl("https://x.example/a")).toBe(false);
  });

  it("redactUserinfo scrubs embedded userinfo (incl. whitespace/embedded @)", () => {
    expect(redactUserinfo("https://u:p@host/x")).toBe("https://<redacted>@host/x");
    expect(redactUserinfo("https://alice:s3 cr3t@ho st/x")).toBe("https://<redacted>@ho st/x");
    expect(redactUserinfo("https://host/a@b")).toBe("https://host/a@b");
  });
});
