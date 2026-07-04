// AUTHORED-BY Claude Fable 5
/**
 * Adversarial suite for the pod-scope guard — the UNION of the cases the eight consumer
 * copies (rxdb-solid, y-solid, n8n-nodes-solid, solid-mcp, unite, solid-components,
 * solid-granary, matrix-chat-to-pod) were each separately roborev-hardened against:
 * `/podfoo` string-prefix siblings, `..` / `%2e%2e` / backslash traversal, encoded path
 * delimiters, scheme-relative re-pointing, embedded credentials (+ error-message
 * redaction), origin (scheme/host/port) mismatches, non-http(s) schemes, root gating,
 * and the redirect-out-of-scope fetch escape.
 */
import { describe, expect, it, vi } from "vitest";
import {
  assertWithinPodScope,
  createPodScopedFetch,
  isContainerUrl,
  isWithinPodScope,
  normalizePodBase,
  PodScopeError,
  podScopedUrl,
  redactUserinfo,
} from "../src/index.js";

const BASE = "https://alice.pod.example/notes/";

describe("normalizePodBase", () => {
  it("accepts an https container URL and returns it canonicalised", () => {
    expect(normalizePodBase(BASE)).toBe(BASE);
  });

  it("adds the trailing slash to a slashless base", () => {
    expect(normalizePodBase("https://alice.pod.example/notes")).toBe(BASE);
  });

  it("trims surrounding whitespace", () => {
    expect(normalizePodBase(`  ${BASE}  `)).toBe(BASE);
  });

  it("strips a query and fragment (a base is a container address)", () => {
    expect(normalizePodBase("https://alice.pod.example/notes/?x=1#frag")).toBe(BASE);
  });

  it("accepts an origin-root base", () => {
    expect(normalizePodBase("https://alice.pod.example")).toBe("https://alice.pod.example/");
  });

  it("accepts http (scope ≠ transport policy; SSRF guard owns scheme hardening)", () => {
    expect(normalizePodBase("http://localhost:3000/pod")).toBe("http://localhost:3000/pod/");
  });

  it.each([
    "",
    "   ",
    "notes/",
    "/notes/",
    "//host/notes/",
    "not a url",
  ])("rejects a non-absolute base: %j", (base) => {
    expect(() => normalizePodBase(base)).toThrow(PodScopeError);
  });

  it.each([
    "file:///etc/",
    "ftp://h/x/",
    "data:text/plain,hi",
    "javascript:alert(1)",
  ])("rejects a non-http(s) base: %s", (base) => {
    expect(() => normalizePodBase(base)).toThrow(/http\(s\)|absolute/);
  });

  it("rejects a base with embedded credentials, without echoing them", () => {
    let caught: Error | undefined;
    try {
      normalizePodBase("https://user:hunter2@h/pod/");
    } catch (e) {
      caught = e as Error;
    }
    expect(caught).toBeInstanceOf(PodScopeError);
    expect(caught?.message).not.toContain("hunter2");
  });

  it.each([
    "https://h/pod%2Fsub/",
    "https://h/pod%2fsub/",
    "https://h/pod%5Csub/",
  ])("rejects a base containing an encoded path delimiter: %s", (base) => {
    expect(() => normalizePodBase(base)).toThrow(/encoded path delimiter/);
  });
});

describe("assertWithinPodScope — in-scope acceptance", () => {
  it("accepts a direct child and returns the canonical URL", () => {
    expect(assertWithinPodScope(BASE, `${BASE}doc.ttl`)).toBe(`${BASE}doc.ttl`);
  });

  it("accepts a nested descendant", () => {
    expect(assertWithinPodScope(BASE, `${BASE}a/b/c`)).toBe(`${BASE}a/b/c`);
  });

  it("accepts the base itself by default (allowRoot defaults to true)", () => {
    expect(assertWithinPodScope(BASE, BASE)).toBe(BASE);
  });

  it("accepts the SLASHLESS form of the base as the root (server aliasing)", () => {
    expect(assertWithinPodScope(BASE, "https://alice.pod.example/notes")).toBe(
      "https://alice.pod.example/notes",
    );
  });

  it("accepts a query/fragment on a descendant (scope is origin+path)", () => {
    expect(assertWithinPodScope(BASE, `${BASE}doc.ttl?v=2#it`)).toBe(`${BASE}doc.ttl?v=2#it`);
  });

  it("resolves a relative reference against the base", () => {
    expect(assertWithinPodScope(BASE, "doc.ttl")).toBe(`${BASE}doc.ttl`);
    expect(assertWithinPodScope(BASE, "./sub/doc.ttl")).toBe(`${BASE}sub/doc.ttl`);
  });

  it("accepts a non-normalised base (slashless) transparently", () => {
    expect(assertWithinPodScope("https://alice.pod.example/notes", `${BASE}doc.ttl`)).toBe(
      `${BASE}doc.ttl`,
    );
  });

  it("accepts in-scope `..` traversal that stays under the base once collapsed", () => {
    expect(assertWithinPodScope(BASE, `${BASE}a/../b`)).toBe(`${BASE}b`);
  });

  it("treats an origin-root base as scoping the whole origin", () => {
    expect(assertWithinPodScope("https://h.example/", "https://h.example/anything/x")).toBe(
      "https://h.example/anything/x",
    );
  });

  it("is case-insensitive on scheme+host (WHATWG canonicalisation)", () => {
    expect(assertWithinPodScope(BASE, "HTTPS://ALICE.POD.EXAMPLE/notes/doc")).toBe(`${BASE}doc`);
  });
});

describe("assertWithinPodScope — path escapes (fail-closed)", () => {
  it("rejects the /podfoo string-prefix sibling (segment boundary, not string prefix)", () => {
    expect(() => assertWithinPodScope("https://h/pod/", "https://h/podfoo/doc")).toThrow(
      PodScopeError,
    );
    expect(isWithinPodScope("https://h/pod/", "https://h/podfoo")).toBe(false);
  });

  it("rejects a sibling container", () => {
    expect(isWithinPodScope(BASE, "https://alice.pod.example/other/doc")).toBe(false);
  });

  it("rejects the parent container", () => {
    expect(isWithinPodScope(BASE, "https://alice.pod.example/")).toBe(false);
  });

  it("rejects raw `..` traversal that escapes the base", () => {
    expect(() => assertWithinPodScope(BASE, `${BASE}../secret`)).toThrow(/escapes pod path/);
    expect(isWithinPodScope(BASE, `${BASE}a/../../secret`)).toBe(false);
  });

  it("rejects relative `..` traversal that escapes the base", () => {
    expect(isWithinPodScope(BASE, "../secret")).toBe(false);
    expect(isWithinPodScope(BASE, "a/../../../secret")).toBe(false);
  });

  it("rejects percent-encoded dot-segment traversal (%2e%2e), collapsed by the parser", () => {
    // WHATWG collapses %2e%2e as a dot segment BEFORE we validate — the collapsed result
    // escapes the base and fails the prefix check.
    expect(isWithinPodScope(BASE, `${BASE}%2e%2e/secret`)).toBe(false);
    expect(isWithinPodScope(BASE, `${BASE}%2E%2E/secret`)).toBe(false);
    expect(isWithinPodScope(BASE, `${BASE}.%2e/secret`)).toBe(false);
  });

  it("rejects backslash-written traversal (WHATWG treats \\ as / in special schemes)", () => {
    expect(isWithinPodScope(BASE, `${BASE}..\\secret`)).toBe(false);
    expect(isWithinPodScope(BASE, `${BASE}a\\..\\..\\secret`)).toBe(false);
  });

  it("rejects an encoded path delimiter surviving in the resolved path (%2F / %5C)", () => {
    // `..%2f` is NOT collapsed by the parser — the request URL stays under the base, but a
    // server decoding before normalisation would alias it above. Refused outright.
    expect(() => assertWithinPodScope(BASE, `${BASE}..%2fsecret`)).toThrow(
      /encoded path delimiter/,
    );
    expect(isWithinPodScope(BASE, `${BASE}..%2Fsecret`)).toBe(false);
    expect(isWithinPodScope(BASE, `${BASE}..%5csecret`)).toBe(false);
    expect(isWithinPodScope(BASE, `${BASE}a%2f..%2f..%2fsecret`)).toBe(false);
  });

  it("does NOT silently re-root a root-absolute reference under the base", () => {
    // `/x` resolves at the ORIGIN root; unless the base is the origin root, that is an
    // escape and must be refused — not quietly rewritten to `${BASE}x`.
    expect(isWithinPodScope(BASE, "/secret")).toBe(false);
    expect(isWithinPodScope(BASE, "/notes-evil/doc")).toBe(false);
    // …but a root-absolute ref that genuinely lands inside the base is fine.
    expect(assertWithinPodScope(BASE, "/notes/doc")).toBe(`${BASE}doc`);
  });
});

describe("assertWithinPodScope — origin escapes (fail-closed)", () => {
  it("rejects a different host", () => {
    expect(() => assertWithinPodScope(BASE, "https://evil.example/notes/doc")).toThrow(
      /escapes pod origin/,
    );
  });

  it("rejects a subdomain of the base host", () => {
    expect(isWithinPodScope(BASE, "https://evil.alice.pod.example/notes/doc")).toBe(false);
  });

  it("rejects a different port", () => {
    expect(isWithinPodScope(BASE, "https://alice.pod.example:8443/notes/doc")).toBe(false);
    expect(isWithinPodScope("https://h:8443/pod/", "https://h/pod/doc")).toBe(false);
  });

  it("rejects a scheme mismatch in both directions", () => {
    expect(isWithinPodScope(BASE, "http://alice.pod.example/notes/doc")).toBe(false);
    expect(isWithinPodScope("http://h/pod/", "https://h/pod/doc")).toBe(false);
  });

  it("rejects a scheme-relative candidate outright", () => {
    expect(() => assertWithinPodScope(BASE, "//evil.example/notes/doc")).toThrow(/scheme-relative/);
    // Even one that names the RIGHT host — the form itself is refused.
    expect(isWithinPodScope(BASE, "//alice.pod.example/notes/doc")).toBe(false);
  });

  it("rejects a trailing-dot host variant (origins differ — fail-closed)", () => {
    expect(isWithinPodScope(BASE, "https://alice.pod.example./notes/doc")).toBe(false);
  });
});

describe("assertWithinPodScope — scheme + credential guards", () => {
  it.each([
    "file:///etc/passwd",
    "data:text/plain,hi",
    "blob:https://alice.pod.example/x",
    "javascript:alert(1)",
    "ftp://alice.pod.example/notes/doc",
  ])("rejects a non-http(s) candidate: %s", (url) => {
    expect(isWithinPodScope(BASE, url)).toBe(false);
  });

  it("rejects embedded credentials even when origin+path match", () => {
    // Userinfo does NOT change the WHATWG origin — this would otherwise pass.
    expect(() => assertWithinPodScope(BASE, "https://u:p@alice.pod.example/notes/doc")).toThrow(
      /embed credentials/,
    );
  });

  it("never echoes embedded credentials in the refusal message", () => {
    let caught: Error | undefined;
    try {
      assertWithinPodScope(BASE, "https://alice:sup3rs3cret@alice.pod.example/notes/doc");
    } catch (e) {
      caught = e as Error;
    }
    expect(caught).toBeInstanceOf(PodScopeError);
    expect(caught?.message).not.toContain("sup3rs3cret");
  });

  it("redacts credentials from MALFORMED-input error messages too", () => {
    let caught: Error | undefined;
    try {
      // Malformed (space in host) AND credential-bearing: the invalid-URL path must scrub.
      assertWithinPodScope(BASE, "https://alice:s3 cr3t@ho st/x");
    } catch (e) {
      caught = e as Error;
    }
    expect(caught).toBeInstanceOf(PodScopeError);
    expect(caught?.message).not.toContain("s3 cr3t");
  });

  it("rejects empty / non-string candidates", () => {
    expect(() => assertWithinPodScope(BASE, "")).toThrow(/non-empty/);
    expect(() => assertWithinPodScope(BASE, "   ")).toThrow(/non-empty/);
    expect(isWithinPodScope(BASE, undefined as unknown as string)).toBe(false);
  });
});

describe("assertWithinPodScope — root gating (allowRoot)", () => {
  const strict = { allowRoot: false } as const;

  it("rejects the base itself under allowRoot:false (slash form)", () => {
    expect(() => assertWithinPodScope(BASE, BASE, strict)).toThrow(/pod base itself/);
  });

  it("rejects the slashless root form under allowRoot:false", () => {
    expect(isWithinPodScope(BASE, "https://alice.pod.example/notes", strict)).toBe(false);
  });

  it("rejects query/fragment variants of the root under allowRoot:false", () => {
    expect(isWithinPodScope(BASE, `${BASE}?x=1`, strict)).toBe(false);
    expect(isWithinPodScope(BASE, `${BASE}#frag`, strict)).toBe(false);
  });

  it("rejects a `..` round-trip back to the root under allowRoot:false", () => {
    expect(isWithinPodScope(BASE, `${BASE}a/..`, strict)).toBe(false);
  });

  it("still accepts a strict descendant under allowRoot:false", () => {
    expect(assertWithinPodScope(BASE, `${BASE}doc`, strict)).toBe(`${BASE}doc`);
  });
});

describe("isWithinPodScope / podScopedUrl", () => {
  it("isWithinPodScope returns false (not a throw) on an invalid BASE — fail-closed", () => {
    expect(isWithinPodScope("not a url", "https://h/x")).toBe(false);
    expect(isWithinPodScope("file:///pod/", "file:///pod/x")).toBe(false);
  });

  it("podScopedUrl returns the canonical URL in scope, undefined out of scope", () => {
    expect(podScopedUrl(BASE, "doc.ttl")).toBe(`${BASE}doc.ttl`);
    expect(podScopedUrl(BASE, "https://evil.example/doc")).toBeUndefined();
    expect(podScopedUrl(BASE, `${BASE}../secret`)).toBeUndefined();
    expect(podScopedUrl("garbage", "https://h/x")).toBeUndefined();
  });

  it("podScopedUrl threads allowRoot through", () => {
    expect(podScopedUrl(BASE, BASE)).toBe(BASE);
    expect(podScopedUrl(BASE, BASE, { allowRoot: false })).toBeUndefined();
  });
});

describe("redactUserinfo", () => {
  it("redacts a well-formed userinfo", () => {
    expect(redactUserinfo("https://u:p@h/x")).toBe("https://<redacted>@h/x");
  });

  it("redacts whitespace / embedded-@ userinfo in malformed strings", () => {
    expect(redactUserinfo("https://alice:s3 cr3t@ho st/x")).not.toContain("s3 cr3t");
    expect(redactUserinfo("https://a@b:c@h/x")).toBe("https://<redacted>@h/x");
  });

  it("leaves a credential-free URL alone", () => {
    expect(redactUserinfo("https://h/a/b?q=1")).toBe("https://h/a/b?q=1");
  });

  it("redacts every authority in the string (global)", () => {
    expect(redactUserinfo("go //u:p@h1/ then //x:y@h2/")).toBe(
      "go //<redacted>@h1/ then //<redacted>@h2/",
    );
  });
});

describe("isContainerUrl", () => {
  it("true for a trailing-slash path, false otherwise", () => {
    expect(isContainerUrl("https://h/pod/")).toBe(true);
    expect(isContainerUrl("https://h/pod")).toBe(false);
  });

  it("decides on the PATH — a query/fragment cannot fool it", () => {
    expect(isContainerUrl("https://h/pod/?x=/")).toBe(true);
    expect(isContainerUrl("https://h/pod?x=/")).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------
// createPodScopedFetch — the redirect-out-of-scope escape (the solid-mcp scopedFetch cases)
// ---------------------------------------------------------------------------------------

function redirectTo(location: string, status = 302): Response {
  return new Response(null, { status, headers: { location } });
}

describe("createPodScopedFetch", () => {
  it("throws at CONFIG time on an invalid base", () => {
    expect(() => createPodScopedFetch("not a url")).toThrow(PodScopeError);
  });

  it("passes an in-scope request through with redirect:'manual' and canonical URL", async () => {
    const inner = vi.fn(async () => new Response("ok"));
    const f = createPodScopedFetch(BASE, { fetch: inner as unknown as typeof fetch });
    const res = await f("doc.ttl"); // relative → canonicalised against the base
    expect(await res.text()).toBe("ok");
    expect(inner).toHaveBeenCalledTimes(1);
    const [url, init] = inner.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${BASE}doc.ttl`);
    expect(init.redirect).toBe("manual");
  });

  it("refuses an out-of-scope initial URL WITHOUT calling the underlying fetch", async () => {
    const inner = vi.fn(async () => new Response("ok"));
    const f = createPodScopedFetch(BASE, { fetch: inner as unknown as typeof fetch });
    await expect(f("https://evil.example/doc")).rejects.toThrow(PodScopeError);
    await expect(f(`${BASE}../secret`)).rejects.toThrow(PodScopeError);
    expect(inner).not.toHaveBeenCalled();
  });

  it("follows an in-scope redirect (relative Location resolved against the hop)", async () => {
    const inner = vi
      .fn()
      .mockResolvedValueOnce(redirectTo("moved.ttl"))
      .mockResolvedValueOnce(new Response("final"));
    const f = createPodScopedFetch(BASE, { fetch: inner as unknown as typeof fetch });
    const res = await f(`${BASE}doc.ttl`);
    expect(await res.text()).toBe("final");
    expect(inner.mock.calls[1]?.[0]).toBe(`${BASE}moved.ttl`);
  });

  it("REFUSES a redirect out of the pod scope (foreign origin) — the SSRF re-open case", async () => {
    const inner = vi.fn().mockResolvedValueOnce(redirectTo("https://evil.example/steal"));
    const f = createPodScopedFetch(BASE, { fetch: inner as unknown as typeof fetch });
    await expect(f(`${BASE}doc.ttl`)).rejects.toThrow(/escapes pod origin/);
    expect(inner).toHaveBeenCalledTimes(1); // never followed
  });

  it("REFUSES a redirect above the base (same origin, out of path scope)", async () => {
    const inner = vi
      .fn()
      .mockResolvedValueOnce(redirectTo("https://alice.pod.example/other/steal"));
    const f = createPodScopedFetch(BASE, { fetch: inner as unknown as typeof fetch });
    await expect(f(`${BASE}doc.ttl`)).rejects.toThrow(/escapes pod path/);
    expect(inner).toHaveBeenCalledTimes(1);
  });

  it("REFUSES a scheme-downgrade redirect (https base → http Location is out of origin)", async () => {
    const inner = vi.fn().mockResolvedValueOnce(redirectTo("http://alice.pod.example/notes/doc"));
    const f = createPodScopedFetch(BASE, { fetch: inner as unknown as typeof fetch });
    await expect(f(`${BASE}doc.ttl`)).rejects.toThrow(/escapes pod origin/);
  });

  it("throws on a malformed Location, redacting any credentials in it", async () => {
    const inner = vi.fn().mockResolvedValueOnce(redirectTo("https://u:s3cr3t@ho st/x"));
    const f = createPodScopedFetch(BASE, { fetch: inner as unknown as typeof fetch });
    const err = await f(`${BASE}doc.ttl`).catch((e: unknown) => e as Error);
    expect(err).toBeInstanceOf(PodScopeError);
    expect((err as Error).message).not.toContain("s3cr3t");
  });

  it("detects a redirect loop", async () => {
    const inner = vi.fn(async () => redirectTo(`${BASE}doc.ttl`));
    const f = createPodScopedFetch(BASE, { fetch: inner as unknown as typeof fetch });
    await expect(f(`${BASE}doc.ttl`)).rejects.toThrow(/redirect loop/);
  });

  it("bounds the redirect chain (maxRedirects)", async () => {
    let n = 0;
    const inner = vi.fn(async () => {
      n += 1;
      return redirectTo(`${BASE}hop-${n}`);
    });
    const f = createPodScopedFetch(BASE, {
      fetch: inner as unknown as typeof fetch,
      maxRedirects: 2,
    });
    await expect(f(`${BASE}doc.ttl`)).rejects.toThrow(/too many redirects/);
    expect(inner).toHaveBeenCalledTimes(3); // initial + 2 followed hops
  });

  it("returns a 3xx WITHOUT a Location as-is (not followable)", async () => {
    const inner = vi.fn(async () => new Response(null, { status: 302 }));
    const f = createPodScopedFetch(BASE, { fetch: inner as unknown as typeof fetch });
    const res = await f(`${BASE}doc.ttl`);
    expect(res.status).toBe(302);
  });

  it("applies Fetch redirect semantics: a 303 switches to GET and drops the body", async () => {
    const inner = vi
      .fn()
      .mockResolvedValueOnce(redirectTo("created.ttl", 303))
      .mockResolvedValueOnce(new Response("done"));
    const f = createPodScopedFetch(BASE, { fetch: inner as unknown as typeof fetch });
    await f(`${BASE}doc.ttl`, {
      method: "POST",
      body: "payload",
      headers: { "content-type": "text/turtle", authorization: "DPoP tok" },
    });
    const [, init] = inner.mock.calls[1] as unknown as [string, RequestInit];
    expect(init.method).toBe("GET");
    expect(init.body).toBeUndefined();
    // Same-origin (in-scope) hop: the credential header SURVIVES; content-type is dropped.
    const headers = new Headers(init.headers);
    expect(headers.get("authorization")).toBe("DPoP tok");
    expect(headers.get("content-type")).toBeNull();
  });

  it("preserves method + body + credentials across an in-scope 307", async () => {
    const inner = vi
      .fn()
      .mockResolvedValueOnce(redirectTo("elsewhere.ttl", 307))
      .mockResolvedValueOnce(new Response("done"));
    const f = createPodScopedFetch(BASE, { fetch: inner as unknown as typeof fetch });
    await f(`${BASE}doc.ttl`, {
      method: "PUT",
      body: "payload",
      headers: { authorization: "DPoP tok" },
    });
    const [, init] = inner.mock.calls[1] as unknown as [string, RequestInit];
    expect(init.method).toBe("PUT");
    expect(init.body).toBe("payload");
    expect(new Headers(init.headers).get("authorization")).toBe("DPoP tok");
  });

  it("gates the base root per allowRoot", async () => {
    const inner = vi.fn(async () => new Response("ok"));
    const open = createPodScopedFetch(BASE, { fetch: inner as unknown as typeof fetch });
    await expect(open(BASE)).resolves.toBeInstanceOf(Response); // default: root allowed
    const strict = createPodScopedFetch(BASE, {
      fetch: inner as unknown as typeof fetch,
      allowRoot: false,
    });
    await expect(strict(BASE)).rejects.toThrow(/pod base itself/);
  });

  it("accepts URL and Request inputs (normalised like fetch)", async () => {
    const inner = vi.fn(async () => new Response("ok"));
    const f = createPodScopedFetch(BASE, { fetch: inner as unknown as typeof fetch });
    await f(new URL(`${BASE}doc.ttl`));
    expect(inner.mock.calls[0]?.[0]).toBe(`${BASE}doc.ttl`);
    await expect(f(new Request("https://evil.example/x"))).rejects.toThrow(PodScopeError);
  });
});
