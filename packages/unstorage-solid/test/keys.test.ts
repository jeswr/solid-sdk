// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate

import { describe, expect, it } from "vitest";
import {
  assertWithinBase,
  isContainerUrl,
  keyToContainerUrl,
  keyToUrl,
  normalizeBase,
  urlToKey,
} from "../src/keys.js";

const BASE = "https://pod.example/kv/";

describe("normalizeBase", () => {
  it("adds a trailing slash", () => {
    expect(normalizeBase("https://pod.example/kv")).toBe("https://pod.example/kv/");
  });
  it("keeps an existing trailing slash", () => {
    expect(normalizeBase("https://pod.example/kv/")).toBe("https://pod.example/kv/");
  });
  it("strips query and fragment", () => {
    expect(normalizeBase("https://pod.example/kv?x=1#y")).toBe("https://pod.example/kv/");
  });
  it("rejects a non-absolute URL", () => {
    expect(() => normalizeBase("/kv/")).toThrow(/absolute URL/);
  });
  it("rejects a non-http(s) protocol", () => {
    expect(() => normalizeBase("ftp://pod.example/kv/")).toThrow(/http\(s\)/);
  });
});

describe("keyToUrl / urlToKey round-trip", () => {
  it("maps a flat key to a resource URL", () => {
    expect(keyToUrl(BASE, "foo")).toBe("https://pod.example/kv/foo");
  });
  it("maps a colon-delimited key to a slash path", () => {
    expect(keyToUrl(BASE, "foo:bar:baz")).toBe("https://pod.example/kv/foo/bar/baz");
  });
  it("round-trips exactly", () => {
    for (const key of ["foo", "foo:bar", "a:b:c:d"]) {
      const url = keyToUrl(BASE, key);
      expect(urlToKey(BASE, url)).toBe(key);
    }
  });
  it("round-trips a key with a space and special chars", () => {
    const key = "my docs:report #1?draft";
    const url = keyToUrl(BASE, key);
    // The unsafe chars are percent-encoded in the URL.
    expect(url).toContain("my%20docs");
    expect(url).toContain("%231");
    expect(url).toContain("%3Fdraft");
    expect(urlToKey(BASE, url)).toBe(key);
  });
  it("refuses pre-encoded path delimiters in either case", () => {
    for (const delimiter of ["%2F", "%2f", "%5C", "%5c"]) {
      const key = `weird${delimiter}seg`;
      expect(() => keyToUrl(BASE, key)).toThrow(/\[unstorage-solid\].*encoded path delimiter/);
      expect(urlToKey(BASE, `${BASE}${key}`)).toBeUndefined();
    }
  });

  it("round-trips encoded colons and percent signs, refusing encoded slashes", () => {
    for (const literal of ["a:b", "100%done"]) {
      const url = `${BASE}${encodeURIComponent(literal)}`;
      const key = urlToKey(BASE, url);
      expect(key).toBeDefined();
      expect((key as string).includes(":")).toBe(false);
      expect(keyToUrl(BASE, key as string)).toBe(url);
    }
    for (const literal of ["a/b", "a\\b", "x:y/z\\w%q"]) {
      const segment = encodeURIComponent(literal);
      expect(urlToKey(BASE, `${BASE}${segment}`)).toBeUndefined();
      expect(() => keyToUrl(BASE, segment)).toThrow(/encoded path delimiter/);
    }
  });

  it("refuses a nested c/d segment while keeping encoded colon and percent round-trips", () => {
    const url = `${BASE}${encodeURIComponent("a:b")}/${encodeURIComponent("c/d")}`;
    expect(urlToKey(BASE, url)).toBeUndefined();
    expect(() => keyToUrl(BASE, "a%3Ab:c%2Fd")).toThrow(/encoded path delimiter/);
    const allowed = `${BASE}a%3Ab/100%25`;
    expect(urlToKey(BASE, allowed)).toBe("a%3Ab:100%25");
    expect(keyToUrl(BASE, "a%3Ab:100%25")).toBe(allowed);
  });

  it("returns undefined for a member URL with a malformed percent-escape", () => {
    // `%zz` is not valid percent-encoding — decodeURIComponent throws; we refuse.
    expect(urlToKey(BASE, `${BASE}bad%zzseg`)).toBeUndefined();
  });
});

describe("traversal + malformed guards", () => {
  it("rejects a `..` segment", () => {
    expect(() => keyToUrl(BASE, "foo:..:bar")).toThrow(/traversal/);
  });
  it("rejects a `.` segment", () => {
    expect(() => keyToUrl(BASE, "foo:.:bar")).toThrow(/traversal/);
  });
  it("rejects a URI-encoded `..` segment (%2e%2e)", () => {
    expect(() => keyToUrl(BASE, "foo:%2e%2e:bar")).toThrow(/traversal/);
  });
  it("rejects an empty segment (double colon)", () => {
    expect(() => keyToUrl(BASE, "foo::bar")).toThrow(/empty segment/);
  });
  it("rejects a leading colon", () => {
    expect(() => keyToUrl(BASE, ":foo")).toThrow(/empty segment/);
  });
  it("rejects a trailing colon", () => {
    expect(() => keyToUrl(BASE, "foo:")).toThrow(/empty segment/);
  });
  it("rejects a raw slash", () => {
    expect(() => keyToUrl(BASE, "foo/bar")).toThrow(/must not contain/);
  });
  it("rejects a raw backslash", () => {
    expect(() => keyToUrl(BASE, "foo\\bar")).toThrow(/must not contain/);
  });
  it("rejects an empty key", () => {
    expect(() => keyToUrl(BASE, "")).toThrow(/non-empty/);
  });
});

describe("assertWithinBase", () => {
  it("accepts the base itself", () => {
    expect(() => assertWithinBase(BASE, BASE)).not.toThrow();
  });
  it("accepts a descendant", () => {
    expect(() => assertWithinBase(BASE, "https://pod.example/kv/a/b")).not.toThrow();
  });
  it("rejects a different origin", () => {
    expect(() => assertWithinBase(BASE, "https://evil.example/kv/a")).toThrow(
      /escapes base origin/,
    );
  });
  it("rejects a sibling path outside base", () => {
    expect(() => assertWithinBase(BASE, "https://pod.example/other/a")).toThrow(
      /escapes base path/,
    );
  });
});

describe("urlToKey edge cases", () => {
  it("returns undefined for the base itself", () => {
    expect(urlToKey(BASE, BASE)).toBeUndefined();
  });
  it("returns undefined for a foreign origin", () => {
    expect(urlToKey(BASE, "https://evil.example/kv/x")).toBeUndefined();
  });
  it("strips a trailing slash (container member maps to same key)", () => {
    expect(urlToKey(BASE, "https://pod.example/kv/foo/")).toBe("foo");
  });
});

describe("keyToContainerUrl / isContainerUrl", () => {
  it("appends a trailing slash for a container", () => {
    expect(keyToContainerUrl(BASE, "foo:bar")).toBe("https://pod.example/kv/foo/bar/");
  });
  it("detects container URLs by trailing slash", () => {
    expect(isContainerUrl("https://pod.example/kv/foo/")).toBe(true);
    expect(isContainerUrl("https://pod.example/kv/foo")).toBe(false);
  });
  it("isContainerUrl falls back to a string check for an unparseable URL", () => {
    expect(isContainerUrl("not a url/")).toBe(true);
    expect(isContainerUrl("not a url")).toBe(false);
  });
});

describe("catch / invalid-input branches", () => {
  it("keyToUrl rejects a segment with a malformed percent-escape", () => {
    // `%` not followed by two hex digits makes decodeURIComponent throw.
    expect(() => keyToUrl(BASE, "foo:%zz")).toThrow(/valid URI-encodable text/);
  });
  it("assertWithinBase throws on an invalid resolved URL", () => {
    expect(() => assertWithinBase(BASE, "::::not a url")).toThrow(/invalid/);
  });
  it("urlToKey returns undefined for an unparseable member URL", () => {
    // A protocol-relative garbage string that does not resolve against base.
    expect(urlToKey(BASE, "http://")).toBeUndefined();
  });
  it("urlToKey returns undefined when the member equals base path (no trailing slash)", () => {
    expect(urlToKey(BASE, "https://pod.example/kv")).toBeUndefined();
  });
  it("urlToKey returns undefined for a path outside base", () => {
    expect(urlToKey(BASE, "https://pod.example/elsewhere/x")).toBeUndefined();
  });
});
