// AUTHORED-BY Claude Fable 5
/**
 * Adversarial suite for the redirect-refusal wrapper — the credentialed-fetch posture that
 * REFUSES (throws {@link RedirectRefusedError}) any redirect instead of following it. Covers:
 * force-manual (overriding a caller "follow"), every moved-3xx status, the browser
 * opaque-redirect shape, the 300/304 non-refusal boundary, body drain, userinfo redaction in
 * the message + fields, input-shape normalisation (string / URL / Request), credential
 * passthrough to the underlying fetch, the default-fetch path, and composition under the SSRF
 * guard.
 */
import { describe, expect, it, vi } from "vitest";
import {
  createGuardedFetch,
  RedirectRefusedError,
  refuseRedirects,
  SsrfError,
} from "../src/index.js";

const URL_A = "https://api.example/resource";

/** A real (Node/undici-shaped) manual-redirect response: readable 3xx status + Location. */
function movedTo(location: string, status = 302): Response {
  return new Response(null, { status, headers: { location } });
}

/**
 * A browser OPAQUE-REDIRECT filtered response: `type === "opaqueredirect"`, `status === 0`,
 * headers stripped. `new Response` cannot produce this shape (status 0 is disallowed, `type` is
 * read-only "default"), so we hand-roll the minimal surface the wrapper reads.
 */
function opaqueRedirect(): Response {
  return {
    type: "opaqueredirect",
    status: 0,
    headers: new Headers(),
    body: null,
    async text() {
      return "";
    },
  } as unknown as Response;
}

describe("refuseRedirects — pass-through of non-redirects", () => {
  it("returns a 200 response unchanged, body intact", async () => {
    const inner = vi.fn(async () => new Response("ok", { status: 200 }));
    const f = refuseRedirects(inner as unknown as typeof fetch);
    const res = await f(URL_A);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok"); // body was NOT drained
    expect(inner).toHaveBeenCalledTimes(1);
  });

  it.each([
    200, 201, 204, 400, 401, 403, 404, 500,
  ])("passes a non-redirect status %d through", async (status) => {
    const inner = vi.fn(async () => new Response(status === 204 ? null : "x", { status }));
    const f = refuseRedirects(inner as unknown as typeof fetch);
    const res = await f(URL_A);
    expect(res.status).toBe(status);
  });

  it.each([
    300, 304,
  ])("does NOT refuse a %d (not a moved 3xx: 300 Multiple Choices / 304 Not Modified)", async (status) => {
    const body = status === 304 ? null : "choices";
    const inner = vi.fn(async () => new Response(body, { status }));
    const f = refuseRedirects(inner as unknown as typeof fetch);
    const res = await f(URL_A);
    expect(res.status).toBe(status);
    expect(inner).toHaveBeenCalledTimes(1);
  });
});

describe("refuseRedirects — forces redirect:'manual'", () => {
  it("sets redirect:'manual' on the underlying fetch", async () => {
    const inner = vi.fn(async () => new Response("ok"));
    const f = refuseRedirects(inner as unknown as typeof fetch);
    await f(URL_A);
    const [, init] = inner.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.redirect).toBe("manual");
  });

  it("OVERRIDES a caller-supplied redirect:'follow' (no silent opt-out)", async () => {
    const inner = vi.fn(async () => new Response("ok"));
    const f = refuseRedirects(inner as unknown as typeof fetch);
    await f(URL_A, { redirect: "follow" });
    const [, init] = inner.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.redirect).toBe("manual");
  });

  it("OVERRIDES a Request's baked-in redirect:'follow'", async () => {
    const inner = vi.fn(async () => new Response("ok"));
    const f = refuseRedirects(inner as unknown as typeof fetch);
    await f(new Request(URL_A, { redirect: "follow" }));
    const [, init] = inner.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.redirect).toBe("manual");
  });
});

describe("refuseRedirects — refuses moved redirects (3xx)", () => {
  it.each([301, 302, 303, 307, 308])("refuses a %d and never follows it", async (status) => {
    const inner = vi.fn(async () => movedTo("https://elsewhere.example/x", status));
    const f = refuseRedirects(inner as unknown as typeof fetch);
    const err = (await f(URL_A).catch((e: unknown) => e)) as RedirectRefusedError;
    expect(err).toBeInstanceOf(RedirectRefusedError);
    expect(err).toBeInstanceOf(Error);
    expect(err.status).toBe(status);
    expect(err.location).toBe("https://elsewhere.example/x");
    expect(err.url).toBe(URL_A);
    expect(inner).toHaveBeenCalledTimes(1); // issued once, never followed
  });

  it("refuses a moved 3xx even with NO Location header (location undefined)", async () => {
    const inner = vi.fn(async () => new Response(null, { status: 302 }));
    const f = refuseRedirects(inner as unknown as typeof fetch);
    const err = (await f(URL_A).catch((e: unknown) => e)) as RedirectRefusedError;
    expect(err).toBeInstanceOf(RedirectRefusedError);
    expect(err.status).toBe(302);
    expect(err.location).toBeUndefined();
  });

  it("refuses a browser opaque-redirect (status 0, location undefined)", async () => {
    const inner = vi.fn(async () => opaqueRedirect());
    const f = refuseRedirects(inner as unknown as typeof fetch);
    const err = (await f(URL_A).catch((e: unknown) => e)) as RedirectRefusedError;
    expect(err).toBeInstanceOf(RedirectRefusedError);
    expect(err.status).toBe(0);
    expect(err.location).toBeUndefined();
    expect(err.message).toContain("opaque redirect");
  });

  it("drains the refused redirect's body (cancel called) before throwing", async () => {
    const cancel = vi.fn(async () => {});
    const redirectRes = {
      type: "default",
      status: 307,
      headers: new Headers({ location: "https://elsewhere.example/x" }),
      body: { cancel },
    } as unknown as Response;
    const inner = vi.fn(async () => redirectRes);
    const f = refuseRedirects(inner as unknown as typeof fetch);
    await expect(f(URL_A)).rejects.toBeInstanceOf(RedirectRefusedError);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("swallows a body.cancel() rejection and still throws the refusal", async () => {
    const redirectRes = {
      type: "default",
      status: 302,
      headers: new Headers({ location: "https://elsewhere.example/x" }),
      body: {
        cancel: async () => {
          throw new Error("already consumed");
        },
      },
    } as unknown as Response;
    const inner = vi.fn(async () => redirectRes);
    const f = refuseRedirects(inner as unknown as typeof fetch);
    await expect(f(URL_A)).rejects.toBeInstanceOf(RedirectRefusedError);
  });
});

describe("refuseRedirects — credential/userinfo redaction", () => {
  it("redacts userinfo in the redirect LOCATION (message + .location field)", async () => {
    const inner = vi.fn(async () => movedTo("https://user:s3cr3t@evil.example/steal"));
    const f = refuseRedirects(inner as unknown as typeof fetch);
    const err = (await f(URL_A).catch((e: unknown) => e)) as RedirectRefusedError;
    expect(err.message).not.toContain("s3cr3t");
    expect(err.location).not.toContain("s3cr3t");
    expect(err.location).toContain("<redacted>");
  });

  it("redacts userinfo in the REQUEST url (message + .url field)", async () => {
    const inner = vi.fn(async () => movedTo("https://elsewhere.example/x"));
    const f = refuseRedirects(inner as unknown as typeof fetch);
    const err = (await f("https://alice:hunter2@api.example/x").catch(
      (e: unknown) => e,
    )) as RedirectRefusedError;
    expect(err.message).not.toContain("hunter2");
    expect(err.url).not.toContain("hunter2");
  });
});

describe("refuseRedirects — input normalisation + credential passthrough", () => {
  it("accepts a string input", async () => {
    const inner = vi.fn(async () => new Response("ok"));
    const f = refuseRedirects(inner as unknown as typeof fetch);
    await f(URL_A);
    expect(inner.mock.calls[0]?.[0]).toBe(URL_A);
  });

  it("accepts a URL input, passed through to the underlying fetch", async () => {
    const inner = vi.fn(async () => new Response("ok"));
    const f = refuseRedirects(inner as unknown as typeof fetch);
    const target = new URL(URL_A);
    await f(target);
    // The input is passed THROUGH untouched (a URL), not reconstructed to a string.
    expect(String(inner.mock.calls[0]?.[0])).toBe(URL_A);
    expect((inner.mock.calls[0]?.[1] as RequestInit).redirect).toBe("manual");
  });

  it("passes a Request input THROUGH untouched, forwarding method + credential headers", async () => {
    const inner = vi.fn(async () => new Response("ok"));
    const f = refuseRedirects(inner as unknown as typeof fetch);
    const req = new Request(URL_A, {
      method: "POST",
      body: "payload",
      headers: { authorization: "DPoP tok", "content-type": "text/turtle" },
    });
    await f(req);
    // The Request is handed to the underlying fetch as-is (first arg), with only a
    // redirect:"manual" override in the init (second arg) — no reconstruction.
    const passed = inner.mock.calls[0]?.[0] as Request;
    expect(passed).toBeInstanceOf(Request);
    expect(passed.url).toBe(URL_A);
    expect(passed.method).toBe("POST");
    expect(passed.headers.get("authorization")).toBe("DPoP tok");
    expect((inner.mock.calls[0]?.[1] as RequestInit).redirect).toBe("manual");
  });

  it("does NOT drop policy-bearing Request fields (mode / integrity / cache / referrerPolicy)", async () => {
    // Regression for the reconstruction gap: routing a Request through a subset-copy would
    // silently drop mode:"same-origin" / integrity / cache, weakening the caller's fetch policy.
    // Passing the Request THROUGH preserves them all.
    const inner = vi.fn(async () => new Response("ok"));
    const f = refuseRedirects(inner as unknown as typeof fetch);
    const req = new Request(URL_A, {
      mode: "same-origin",
      integrity: "sha256-abc",
      cache: "no-store",
      referrerPolicy: "no-referrer",
      headers: { authorization: "DPoP tok" },
    });
    await f(req);
    const passed = inner.mock.calls[0]?.[0] as Request;
    expect(passed).toBe(req); // the SAME object — passed through, not reconstructed
    expect(passed.mode).toBe("same-origin");
    expect(passed.integrity).toBe("sha256-abc");
    expect(passed.cache).toBe("no-store");
    expect(passed.referrerPolicy).toBe("no-referrer");
    expect(passed.headers.get("authorization")).toBe("DPoP tok");
    expect((inner.mock.calls[0]?.[1] as RequestInit).redirect).toBe("manual");
  });

  it("forwards an init's credential header to the underlying (authed) fetch unchanged", async () => {
    const inner = vi.fn(async () => new Response("ok"));
    const f = refuseRedirects(inner as unknown as typeof fetch);
    await f(URL_A, { headers: { authorization: "Bearer abc" } });
    const [, init] = inner.mock.calls[0] as unknown as [string, RequestInit];
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer abc");
  });
});

describe("refuseRedirects — default underlying fetch", () => {
  it("uses globalThis.fetch when no fetch is supplied", async () => {
    const original = globalThis.fetch;
    const spy = vi.fn(async () => new Response("global"));
    globalThis.fetch = spy as unknown as typeof fetch;
    try {
      const f = refuseRedirects();
      const res = await f(URL_A);
      expect(await res.text()).toBe("global");
      expect(spy).toHaveBeenCalledTimes(1);
      expect((spy.mock.calls[0] as unknown as [string, RequestInit])[1].redirect).toBe("manual");
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe("refuseRedirects — composition with the SSRF guard", () => {
  it("nested under createGuardedFetch: the redirect is refused (surfaced as SsrfError w/ RedirectRefusedError cause)", async () => {
    const inner = vi.fn(async () => movedTo("https://elsewhere.example/x"));
    const composed = createGuardedFetch({
      // IP-literal target so the guard needs no DNS resolver; refuseRedirects wraps the inner.
      fetch: refuseRedirects(inner as unknown as typeof fetch),
    });
    const err = (await composed("https://93.184.216.34/x").catch(
      (e: unknown) => e,
    )) as SsrfError & {
      cause?: unknown;
    };
    expect(err).toBeInstanceOf(SsrfError);
    expect(err.cause).toBeInstanceOf(RedirectRefusedError);
    expect(inner).toHaveBeenCalledTimes(1); // issued once, redirect never followed
  });

  it("nested under createGuardedFetch: a non-redirect passes through", async () => {
    const inner = vi.fn(async () => new Response("ok"));
    const composed = createGuardedFetch({
      fetch: refuseRedirects(inner as unknown as typeof fetch),
    });
    const res = await composed("https://93.184.216.34/x");
    expect(res.status).toBe(200);
  });
});
