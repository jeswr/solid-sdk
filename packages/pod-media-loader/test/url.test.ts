// AUTHORED-BY Claude Sonnet 5.5
import { describe, expect, test } from "vitest";
import { codeOfStorageError, fail, MediaFailure, ok } from "../src/errors.js";
import { canonicalMediaUrl, scopeTest } from "../src/url.js";

describe("canonicalMediaUrl", () => {
  test("canonicalises a plain https URL", () => {
    expect(canonicalMediaUrl("HTTPS://Pod.Example:443/media/a%20b.png")).toBe(
      "https://pod.example/media/a%20b.png",
    );
    expect(canonicalMediaUrl("http://localhost:3000/a.png")).toBe("http://localhost:3000/a.png");
  });

  test("collapses dot segments before anything is checked", () => {
    expect(canonicalMediaUrl("https://pod.example/media/../private/x.png")).toBe(
      "https://pod.example/private/x.png",
    );
  });

  test.each([
    ["not a string", 42],
    ["undefined", undefined],
    ["empty", ""],
    ["too long", `https://pod.example/${"a".repeat(2100)}`],
    ["relative", "/media/a.png"],
    ["not a URL", "https://"],
    ["query", "https://pod.example/a.png?token=secret"],
    ["empty query", "https://pod.example/a.png?"],
    ["fragment", "https://pod.example/a.png#frag"],
    ["credentials", "https://user:pw@pod.example/a.png"],
    ["username only", "https://user@pod.example/a.png"],
    ["password only", "https://:pw@pod.example/a.png"],
    ["data URL", "data:image/png;base64,AAAA"],
    ["blob URL", "blob:https://pod.example/1"],
    ["javascript URL", "javascript:alert(1)"],
    ["file URL", "file:///etc/passwd"],
    ["ftp", "ftp://pod.example/a.png"],
    ["whitespace", "https://pod.example/a b.png"],
    ["tab", "https://pod.example/a\t.png"],
    ["newline", "https://pod.example/a\n.png"],
    ["control character", "https://pod.example/a\u0001.png"],
    ["backslash", "https://pod.example/media\\a.png"],
    ["encoded slash", "https://pod.example/media/..%2Fsecret.png"],
    ["encoded backslash", "https://pod.example/media/..%5Csecret.png"],
    ["encoded dot", "https://pod.example/media/%2e%2e/secret.png"],
    ["encoded question mark", "https://pod.example/a%3Fb.png"],
    ["encoded hash", "https://pod.example/a%23b.png"],
    ["encoded NUL", "https://pod.example/a%00.png"],
    ["encoded DEL", "https://pod.example/a%7F.png"],
  ])("refuses %s", (_name, input) => {
    expect(canonicalMediaUrl(input)).toBeUndefined();
  });
});

describe("scopeTest", () => {
  test("a predicate sees the canonical URL and must return exactly true", () => {
    const seen: string[] = [];
    const test1 = scopeTest((url) => {
      seen.push(url);
      return true;
    });
    expect(test1("https://pod.example/a.png")).toBe(true);
    expect(seen).toEqual(["https://pod.example/a.png"]);
    expect(scopeTest(() => 1 as unknown as boolean)("https://pod.example/a")).toBe(false);
    expect(scopeTest(() => undefined as unknown as boolean)("https://pod.example/a")).toBe(false);
  });

  test("a throwing predicate fails closed", () => {
    expect(
      scopeTest(() => {
        throw new Error("boom");
      })("https://pod.example/a"),
    ).toBe(false);
  });

  test("containers admit strict descendants only, on a segment boundary", () => {
    const inScope = scopeTest(["https://pod.example/media/", "https://other.example/pics"]);
    expect(inScope("https://pod.example/media/a.png")).toBe(true);
    expect(inScope("https://pod.example/media/sub/a.png")).toBe(true);
    expect(inScope("https://other.example/pics/a.png")).toBe(true);
    expect(inScope("https://pod.example/media/")).toBe(false);
    expect(inScope("https://pod.example/media")).toBe(false);
    expect(inScope("https://pod.example/media-evil/a.png")).toBe(false);
    expect(inScope("https://pod.example/private/a.png")).toBe(false);
    expect(inScope("http://pod.example/media/a.png")).toBe(false);
    expect(inScope("https://evil.example/media/a.png")).toBe(false);
  });

  test("an empty container list admits nothing; an invalid container throws at creation", () => {
    expect(scopeTest([])("https://pod.example/media/a.png")).toBe(false);
    expect(() => scopeTest(["not a url"])).toThrow();
    expect(() => scopeTest(["https://user:pw@pod.example/"])).toThrow();
  });
});

describe("errors", () => {
  test("messages are fixed per code and never carry caller data", () => {
    const codes = [
      "out-of-scope",
      "not-found",
      "forbidden",
      "too-large",
      "unsupported-type",
      "offline",
      "aborted",
      "purged",
      "failed",
    ] as const;
    for (const code of codes) {
      const result = fail(code);
      expect(result.error.code).toBe(code);
      expect(result.error.message).not.toMatch(/https?:|\?|@/);
      expect(Object.isFrozen(result.error)).toBe(true);
    }
    expect(ok(1)).toEqual({ ok: true, value: 1 });
    expect(new MediaFailure("failed").code).toBe("failed");
  });

  test("storage error codes map onto the closed set", () => {
    const code = (value: unknown) => codeOfStorageError({ code: value });
    expect(code("not-found")).toBe("not-found");
    expect(code("forbidden")).toBe("forbidden");
    expect(code("unauthenticated")).toBe("forbidden");
    expect(code("payload-too-large")).toBe("too-large");
    expect(code("scope")).toBe("out-of-scope");
    expect(code("network")).toBe("offline");
    expect(code("server")).toBe("failed");
    expect(code("anything-else")).toBe("failed");
    expect(codeOfStorageError(null)).toBe("failed");
    expect(codeOfStorageError("text")).toBe("failed");
    expect(codeOfStorageError(new Error("x"))).toBe("failed");
  });
});
