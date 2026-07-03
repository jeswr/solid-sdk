// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate

import { describe, expect, it } from "vitest";
import {
  assertWithinPod,
  isContainerUrl,
  normalizePodBase,
  redactUserinfo,
  resolveTarget,
} from "../src/scope.js";

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

  // --- characterization pins (security review): WHATWG-parser quirks that COULD
  // re-point the request stay fail-closed because the COLLAPSED result is what
  // assertWithinPod validates. Each of these is an observed parser behaviour
  // (verified against Node's URL), pinned so a refactor cannot silently regress.

  it("refuses a BACKSLASH scheme-relative target (\\\\host — WHATWG treats \\ as /)", () => {
    // `\\evil.example/x` resolves to `https://evil.example/x` under a special
    // scheme — the `//` check misses it, but the origin re-validation refuses it.
    expect(() => resolveTarget(BASE, "\\\\evil.example/x.ttl")).toThrow(/escapes pod origin/);
  });

  it("refuses a single-backslash path (\\… — parser makes it origin-root-absolute)", () => {
    // `\evil.example/x` becomes `/evil.example/x` at the origin root — outside
    // the base sub-tree, refused by the path-prefix re-validation.
    expect(() => resolveTarget(BASE, "\\evil.example/x.ttl")).toThrow(/escapes pod path/);
  });

  it("refuses a one-slash absolute-ish target (https:/host — parsed as a relative path)", () => {
    // `https:/evil.example/x` fails the absolute-URL regex (needs `//`) and the
    // parser resolves it to `/evil.example/x` on the POD origin — refused by the
    // path check (it never reaches evil.example).
    expect(() => resolveTarget(BASE, "https:/evil.example/x.ttl")).toThrow(/escapes pod path/);
  });

  it("refuses an UPPERCASE-scheme absolute URL on a foreign origin", () => {
    expect(() => resolveTarget(BASE, "HTTPS://evil.example/x.ttl")).toThrow(/escapes pod origin/);
  });

  it("refuses a same-host DIFFERENT-PORT absolute URL (origin includes the port)", () => {
    expect(() => resolveTarget(BASE, "https://alice.pod.example:8443/data/x.ttl")).toThrow(
      /escapes pod origin/,
    );
  });

  it("refuses an http: target when the base is https: (scheme is part of the origin)", () => {
    expect(() => resolveTarget(BASE, "http://alice.pod.example/data/x.ttl")).toThrow(
      /escapes pod origin/,
    );
  });

  // --- encoded path delimiters (defence in depth, wave-3 review): the parser
  // leaves %2F/%5C un-decoded so `..%2f` passes the prefix check textually — but
  // a server that decodes before normalising would alias it above the base.
  // The ambiguity is refused outright.

  it("refuses an encoded-slash traversal that the parser does NOT collapse (..%2f)", () => {
    expect(() => resolveTarget(BASE, "..%2fsecret.ttl")).toThrow(/encoded path delimiter/);
    expect(() => resolveTarget(BASE, "..%2F..%2Fsecret.ttl")).toThrow(/encoded path delimiter/);
  });

  it("refuses any encoded slash or backslash in a target path", () => {
    expect(() => resolveTarget(BASE, "a%2fb.ttl")).toThrow(/encoded path delimiter/);
    expect(() => resolveTarget(BASE, "a%5Cb.ttl")).toThrow(/encoded path delimiter/);
    expect(() => resolveTarget(BASE, "https://alice.pod.example/data/a%2Fb.ttl")).toThrow(
      /encoded path delimiter/,
    );
  });

  it("refuses a non-http(s) absolute target (SSRF / scheme confusion)", () => {
    expect(() => resolveTarget(BASE, "file:///etc/passwd")).toThrow(/http\(s\)/);
  });

  it("refuses an empty target", () => {
    expect(() => resolveTarget(BASE, "")).toThrow(/non-empty/);
    expect(() => resolveTarget(BASE, "   ")).toThrow(/non-empty/);
  });

  it("refuses a same-origin target that embeds credentials (user:pass@)", () => {
    // Userinfo does not change the origin, so it would otherwise pass the
    // same-origin + path checks — but a pod address never carries credentials.
    expect(() => resolveTarget(BASE, "https://attacker@alice.pod.example/data/x.ttl")).toThrow(
      /must not embed credentials/,
    );
    expect(() => resolveTarget(BASE, "https://u:p@alice.pod.example/data/x.ttl")).toThrow(
      /must not embed credentials/,
    );
  });

  it("does NOT leak the embedded credentials into the thrown error message", () => {
    // The error is surfaced as item JSON under continueOnFail (and into logs), so
    // it must NOT echo the target — which contains the very secret we refuse.
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
    expect(message).not.toContain("@alice.pod.example");
  });

  // Every OTHER target-validation error path must also redact userinfo — a
  // malformed or scheme-relative target carrying `user:pass@` must not leak it.
  const Pass = "s3cr3t-p4ss";
  function messageOf(fn: () => unknown): string {
    try {
      fn();
    } catch (e) {
      return (e as Error).message;
    }
    throw new Error("expected the call to throw");
  }

  it("does NOT leak credentials from a scheme-relative target error", () => {
    const m = messageOf(() => resolveTarget(BASE, `//alice:${Pass}@evil.example/x.ttl`));
    expect(m).toMatch(/scheme-relative/);
    expect(m).not.toContain(Pass);
    expect(m).not.toContain("alice:");
  });

  it("does NOT leak credentials from a malformed (unparseable) target error", () => {
    // A control char makes `new URL` throw, hitting the invalid-target path which
    // echoes the target — it must be redacted.
    const m = messageOf(() => resolveTarget(BASE, `https://alice:${Pass}@ho st/x\x00`));
    expect(m).toMatch(/invalid/);
    expect(m).not.toContain(Pass);
  });

  it("does NOT leak credentials from a malformed pod-base error", () => {
    const m = messageOf(() => normalizePodBase(`ht!tp://alice:${Pass}@host/`));
    expect(m).toMatch(/absolute/);
    expect(m).not.toContain(Pass);
  });

  it("does NOT leak credentials with WHITESPACE in the userinfo (malformed target)", () => {
    // A space in the password makes `new URL` throw -> the invalid-target path
    // echoes the target. The redaction span must include whitespace, else this
    // leaks `alice:s3 cr3t`. (Regression for the security-review finding.)
    const m = messageOf(() => resolveTarget(BASE, "https://alice:s3 cr3t@ho st/x"));
    expect(m).toMatch(/invalid/);
    expect(m).not.toContain("s3 cr3t");
    expect(m).not.toContain("alice:");
  });
});

describe("redactUserinfo", () => {
  it("redacts user:pass@ from an absolute URL", () => {
    expect(redactUserinfo("https://u:p@host/x")).toBe("https://<redacted>@host/x");
  });
  it("redacts user@ (no password)", () => {
    expect(redactUserinfo("https://u@host/x")).toBe("https://<redacted>@host/x");
  });
  it("redacts a scheme-relative //user:pass@host", () => {
    expect(redactUserinfo("//u:p@host/x")).toBe("//<redacted>@host/x");
  });
  it("leaves a credential-free URL unchanged", () => {
    expect(redactUserinfo("https://host/x?a=b#c")).toBe("https://host/x?a=b#c");
  });
  it("does not treat an @ later in the path as userinfo", () => {
    expect(redactUserinfo("https://host/a@b")).toBe("https://host/a@b");
  });
  it("redacts userinfo containing WHITESPACE (malformed input)", () => {
    expect(redactUserinfo("https://alice:s3 cr3t@ho st/x")).toBe("https://<redacted>@ho st/x");
  });
  it("redacts userinfo containing an embedded @", () => {
    expect(redactUserinfo("https://a@b@host/x")).toBe("https://<redacted>@host/x");
  });
  it("does not treat an @ in the query as userinfo", () => {
    expect(redactUserinfo("https://host/p?u=x@y")).toBe("https://host/p?u=x@y");
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
