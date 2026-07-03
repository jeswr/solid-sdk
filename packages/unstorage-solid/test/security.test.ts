// AUTHORED-BY Claude Fable 5
//
// Adversarial, driver-level security regression tests:
//   - a poisoned in-pod resource that redirects a credentialed read/write must NOT
//     leak the request off-origin (redirect refusal),
//   - a hostile container listing must never cause clear() to DELETE a foreign or
//     out-of-base IRI (fail-closed foreign-IRI handling),
//   - the key→URL mapping normalisation is PINNED so a reviewer sees it is
//     intentional (percent-encoding is canonicalised; ordinary keys are injective).

import { DataFactory, Writer } from "n3";
import { describe, expect, it } from "vitest";
import solidDriver, { SolidHttpError } from "../src/index.js";
import { keyToUrl } from "../src/keys.js";
import { SolidRedirectError } from "../src/scope.js";

const { namedNode, quad } = DataFactory;
const BASE = "https://pod.example/kv/";
const LDP = "http://www.w3.org/ns/ldp#";
const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";

async function turtle(quads: ReturnType<typeof quad>[]): Promise<string> {
  const writer = new Writer({ format: "text/turtle" });
  for (const q of quads) {
    writer.addQuad(q);
  }
  return new Promise<string>((resolve, reject) => {
    writer.end((err, result) => (err ? reject(err) : resolve(result)));
  });
}

describe("redirect-based SSRF / credential leak", () => {
  it("getItem refuses a redirect to a foreign origin and never fetches the target", async () => {
    const calls: string[] = [];
    const driver = solidDriver({
      base: BASE,
      headers: { authorization: "Bearer secret-token" },
      fetch: (async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : (input as URL).toString();
        calls.push(url);
        return new Response(null, {
          status: 302,
          headers: { location: "https://evil.example/harvest" },
        });
      }) as unknown as typeof fetch,
    });
    await expect(driver.getItem?.("secret", {})).rejects.toBeInstanceOf(SolidRedirectError);
    // The credentialed request was issued to the in-pod URL exactly once and the
    // redirect to evil.example was refused, not followed.
    expect(calls).toEqual([`${BASE}secret`]);
  });

  it("setItem (PUT) refuses a redirect — a redirected write is never replayed off-pod", async () => {
    const calls: { url: string; method: string }[] = [];
    const driver = solidDriver({
      base: BASE,
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : (input as URL).toString();
        calls.push({ url, method: (init?.method ?? "GET").toUpperCase() });
        return new Response(null, {
          status: 307,
          headers: { location: "https://evil.example/write" },
        });
      }) as unknown as typeof fetch,
    });
    await expect(driver.setItem?.("k", "v", {})).rejects.toBeInstanceOf(SolidRedirectError);
    expect(calls).toEqual([{ url: `${BASE}k`, method: "PUT" }]);
  });
});

describe("hostile container listing — clear() never deletes a foreign IRI", () => {
  it("deletes only in-base members; skips foreign + out-of-base IRIs from the listing", async () => {
    const deletes: string[] = [];
    const listing = await turtle([
      quad(namedNode(BASE), namedNode(RDF_TYPE), namedNode(`${LDP}BasicContainer`)),
      quad(namedNode(BASE), namedNode(`${LDP}contains`), namedNode(`${BASE}real`)),
      // hostile injections a buggy/malicious server could place in the listing:
      quad(namedNode(BASE), namedNode(`${LDP}contains`), namedNode("https://evil.example/x")),
      quad(
        namedNode(BASE),
        namedNode(`${LDP}contains`),
        namedNode("https://pod.example/outside/y"),
      ),
    ]);
    const driver = solidDriver({
      base: BASE,
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : (input as URL).toString();
        const method = (init?.method ?? "GET").toUpperCase();
        if (method === "DELETE") {
          deletes.push(url);
          return new Response(null, { status: 204 });
        }
        // GET (container listing) — serve the hostile listing for the base.
        return new Response(listing, {
          status: 200,
          headers: { "content-type": "text/turtle" },
        });
      }) as unknown as typeof fetch,
    });
    await driver.clear?.("", {});
    // Only the in-base member was deleted; the foreign + out-of-base IRIs never were.
    expect(deletes).toEqual([`${BASE}real`]);
    expect(deletes.some((u) => u.includes("evil.example"))).toBe(false);
    expect(deletes.some((u) => u.includes("/outside/"))).toBe(false);
  });

  it("getKeys drops foreign + out-of-base members from the returned key space", async () => {
    const listing = await turtle([
      quad(namedNode(BASE), namedNode(RDF_TYPE), namedNode(`${LDP}BasicContainer`)),
      quad(namedNode(BASE), namedNode(`${LDP}contains`), namedNode(`${BASE}real`)),
      quad(namedNode(BASE), namedNode(`${LDP}contains`), namedNode("https://evil.example/x")),
    ]);
    const driver = solidDriver({
      base: BASE,
      fetch: (async () =>
        new Response(listing, {
          status: 200,
          headers: { "content-type": "text/turtle" },
        })) as unknown as typeof fetch,
    });
    const keys = await driver.getKeys("", {});
    expect(keys).toEqual(["real"]);
  });
});

describe("key→URL mapping — normalisation is intentional (pinned)", () => {
  it("ordinary keys map injectively to distinct URLs", () => {
    const seen = new Map<string, string>();
    for (const key of ["a", "b", "a:b", "a:c", "foo:bar:baz", "with space", "under_score"]) {
      const url = keyToUrl(BASE, key);
      // No two distinct ordinary keys collide.
      expect(seen.has(url)).toBe(false);
      seen.set(url, key);
    }
  });

  it("percent-encoding is CANONICALISED — redundant encodings normalise together", () => {
    // A key is decoded then re-`encodeURIComponent`-ed, so equivalent percent
    // spellings converge on ONE URL. This is by design (it also lets a caller pass
    // a pre-encoded `%2F` to keep a literal slash inside a single segment). Ordinary
    // keys (no `%`) are unaffected; this is documented in the README.
    expect(keyToUrl(BASE, "%41")).toBe(keyToUrl(BASE, "A"));
    expect(keyToUrl(BASE, "a%3Ab")).toBe(keyToUrl(BASE, "a%3ab"));
  });
});

// Sanity: SolidHttpError is still the taxonomy for a genuine non-redirect failure.
describe("error taxonomy unchanged for non-redirect failures", () => {
  it("a 500 surfaces as SolidHttpError, not SolidRedirectError", async () => {
    const driver = solidDriver({
      base: BASE,
      fetch: (async () => new Response(null, { status: 500, statusText: "boom" })) as typeof fetch,
    });
    await expect(driver.getItem?.("x", {})).rejects.toBeInstanceOf(SolidHttpError);
  });
});
