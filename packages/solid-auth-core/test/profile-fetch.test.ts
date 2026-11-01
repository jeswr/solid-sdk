// AUTHORED-BY Claude Opus 5.5
//
// The profile read that proves a WebID↔issuer binding must never cross plaintext:
// secureRedirectFetch follows redirects by hand and refuses any non-https hop.
import { describe, expect, it, vi } from "vitest";
import { secureRedirectFetch } from "../src/controller.js";

const redirect = (location: string, status = 302) =>
  new Response(null, { status, headers: { location } });
const turtle = () =>
  new Response("<#me> a <#Agent> .", { headers: { "content-type": "text/turtle" } });

function scripted(responses: Record<string, Response>) {
  return vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const response = responses[String(input)];
    if (!response) throw new Error(`unexpected fetch ${String(input)}`);
    return response;
  });
}

describe("secureRedirectFetch", () => {
  it("refuses an https → http redirect hop before requesting it", async () => {
    const base = scripted({ "https://alice.example/card": redirect("http://alice.example/card") });
    const fetch = secureRedirectFetch(base as unknown as typeof globalThis.fetch, false);
    await expect(fetch("https://alice.example/card")).rejects.toThrow(/https/i);
    expect(base).toHaveBeenCalledTimes(1);
  });

  it("does not echo the refused redirect target (it may carry secrets)", async () => {
    const base = scripted({
      "https://alice.example/card": redirect("http://alice.example/card?access_token=s3cret"),
    });
    const fetch = secureRedirectFetch(base as unknown as typeof globalThis.fetch, false);
    await expect(fetch("https://alice.example/card")).rejects.toThrow(
      expect.objectContaining({ message: expect.not.stringContaining("s3cret") }),
    );
  });

  it("refuses a redirect hop carrying userinfo without requesting or echoing it", async () => {
    const base = scripted({
      "https://alice.example/card": redirect("https://user:pa55@cdn.example/card?signature=s3cret"),
    });
    const fetch = secureRedirectFetch(base as unknown as typeof globalThis.fetch, false);
    const error = await fetch("https://alice.example/card").catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toMatch(/pa55|s3cret/);
    expect(base).toHaveBeenCalledTimes(1);
  });

  it("replaces a transport error (which can embed the hop URL) with a generic one", async () => {
    const base = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "https://alice.example/card")
        return redirect("https://cdn.example/card?signature=s3cret");
      throw new TypeError(`fetch failed for ${String(input)}`);
    });
    const fetch = secureRedirectFetch(base as unknown as typeof globalThis.fetch, false);
    await expect(fetch("https://alice.example/card")).rejects.toThrow(
      expect.objectContaining({ message: expect.not.stringContaining("s3cret") }),
    );
  });

  it("keeps an abort as an AbortError", async () => {
    const base = vi.fn(async () => {
      throw new DOMException("aborted", "AbortError");
    });
    const fetch = secureRedirectFetch(base as unknown as typeof globalThis.fetch, false);
    await expect(fetch("https://alice.example/card")).rejects.toMatchObject({ name: "AbortError" });
  });

  it("follows https redirects (303 for a slash WebID, cross-origin permanent ids)", async () => {
    const base = scripted({
      "https://w3id.example/alice": redirect("https://alice.example/card", 303),
      "https://alice.example/card": turtle(),
    });
    const fetch = secureRedirectFetch(base as unknown as typeof globalThis.fetch, false);
    const response = await fetch("https://w3id.example/alice");
    expect(response.status).toBe(200);
    expect(base.mock.calls.map(([url, init]) => [String(url), init?.redirect])).toEqual([
      ["https://w3id.example/alice", "manual"],
      ["https://alice.example/card", "manual"],
    ]);
  });

  it("allows a loopback http hop only with allowInsecureLoopback", async () => {
    const responses = () => ({
      "http://localhost:3000/alice/card": turtle(),
    });
    const strict = secureRedirectFetch(
      scripted(responses()) as unknown as typeof globalThis.fetch,
      false,
    );
    await expect(strict("http://localhost:3000/alice/card")).rejects.toThrow(/https/i);
    const dev = secureRedirectFetch(
      scripted(responses()) as unknown as typeof globalThis.fetch,
      true,
    );
    expect((await dev("http://localhost:3000/alice/card")).status).toBe(200);
  });

  it("re-issues an opaque (browser) redirect with follow and still checks the final URL", async () => {
    const followed = turtle();
    Object.defineProperty(followed, "url", { value: "http://evil.example/card" });
    const base = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
      init?.redirect === "manual" ? ({ type: "opaqueredirect" } as Response) : followed,
    );
    const fetch = secureRedirectFetch(base as unknown as typeof globalThis.fetch, false);
    await expect(fetch("https://alice.example/card")).rejects.toThrow(/https/i);
    expect(base).toHaveBeenCalledTimes(2);
  });

  it("gives up after too many redirects", async () => {
    const base = vi.fn(async (input: RequestInfo | URL) => redirect(`${String(input)}x`));
    const fetch = secureRedirectFetch(base as unknown as typeof globalThis.fetch, false);
    await expect(fetch("https://alice.example/card")).rejects.toThrow(/too many redirects/i);
  });
});
