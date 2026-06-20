// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
import { assertSafeUrl, SsrfError } from "@jeswr/guarded-fetch";
import { describe, expect, it, vi } from "vitest";
import { iterateObjects } from "../src/granary.js";
import { fetchGranary, GranaryFetchError } from "../src/remote.js";
import { rssFeed } from "./fixtures.js";

/** A stubbed (already-SSRF-safe) fetch returning a granary AS2 JSON body. */
function jsonFetch(body: unknown, status = 200, contentType = "application/activity+json") {
  return vi.fn(
    async () =>
      new Response(typeof body === "string" ? body : JSON.stringify(body), {
        status,
        headers: { "content-type": contentType },
      }),
  ) as unknown as typeof globalThis.fetch;
}

describe("fetchGranary", () => {
  it("returns the parsed AS2 payload from a granary endpoint", async () => {
    const payload = await fetchGranary("https://granary.io/url?output=as2", {
      fetch: jsonFetch(rssFeed),
    });
    expect([...iterateObjects(payload)]).toHaveLength(2);
  });

  it("sends an AS2-preferring Accept header", async () => {
    const f = jsonFetch(rssFeed);
    await fetchGranary("https://granary.io/x", { fetch: f });
    const init = (f as unknown as { mock: { calls: [unknown, RequestInit][] } }).mock.calls[0]?.[1];
    expect((init?.headers as Record<string, string>).accept).toContain("application/activity+json");
  });

  it("throws GranaryFetchError on a non-2xx status", async () => {
    await expect(
      fetchGranary("https://granary.io/x", { fetch: jsonFetch({}, 502) }),
    ).rejects.toBeInstanceOf(GranaryFetchError);
  });

  it("throws GranaryFetchError on unparseable JSON", async () => {
    await expect(
      fetchGranary("https://granary.io/x", { fetch: jsonFetch("<<not json>>") }),
    ).rejects.toMatchObject({ name: "GranaryFetchError" });
  });

  it("throws GranaryFetchError on a non-object payload", async () => {
    await expect(
      fetchGranary("https://granary.io/x", { fetch: jsonFetch("42") }),
    ).rejects.toMatchObject({ name: "GranaryFetchError" });
  });

  it("enforces the parse-time byte cap", async () => {
    const huge = JSON.stringify({ type: "Note", content: "x".repeat(2000) });
    await expect(
      fetchGranary("https://granary.io/x", { fetch: jsonFetch(huge), maxBytes: 100 }),
    ).rejects.toMatchObject({ message: expect.stringContaining("exceeds") });
  });

  it("the byte cap counts ENCODED utf-8 bytes, not utf-16 code units", async () => {
    // 60 emoji = 60 code units (text.length) but 240 utf-8 bytes. A cap between the
    // two (100) must REJECT — proving we measure bytes, not code units.
    const emoji = "😀".repeat(60);
    const body = JSON.stringify({ type: "Note", content: emoji });
    expect(body.length).toBeLessThan(new TextEncoder().encode(body).length);
    await expect(
      fetchGranary("https://granary.io/x", { fetch: jsonFetch(body), maxBytes: 150 }),
    ).rejects.toMatchObject({ message: expect.stringContaining("exceeds") });
  });

  it("wraps a thrown network error as GranaryFetchError", async () => {
    const f = vi.fn(async () => {
      throw new Error("boom");
    }) as unknown as typeof globalThis.fetch;
    await expect(fetchGranary("https://granary.io/x", { fetch: f })).rejects.toBeInstanceOf(
      GranaryFetchError,
    );
  });
});

describe("SSRF guard wiring (the real @jeswr/guarded-fetch policy)", () => {
  // These prove the guard we route through actually refuses dangerous targets — so
  // the default path (nodeGuardedFetch) cannot reach private/loopback/metadata hosts.
  it("refuses the cloud-metadata address", async () => {
    await expect(assertSafeUrl("https://169.254.169.254/latest/meta-data/")).rejects.toBeInstanceOf(
      SsrfError,
    );
  });
  it("refuses loopback", async () => {
    await expect(assertSafeUrl("https://127.0.0.1/")).rejects.toBeInstanceOf(SsrfError);
  });
  it("refuses a private RFC1918 literal", async () => {
    await expect(assertSafeUrl("https://10.0.0.5/")).rejects.toBeInstanceOf(SsrfError);
  });
  it("refuses a non-https scheme", async () => {
    await expect(assertSafeUrl("http://granary.io/")).rejects.toBeInstanceOf(SsrfError);
  });
  it("refuses userinfo in the URL", async () => {
    await expect(assertSafeUrl("https://user:pass@granary.io/")).rejects.toBeInstanceOf(SsrfError);
  });
});
