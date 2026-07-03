// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
import { describe, expect, it, vi } from "vitest";
import { podRootFallback, resolveStorageRoot, resolveStorageRoots } from "./storage";

describe("podRootFallback", () => {
  it("derives the POD root (not the server root) for a path-based WebID", () => {
    expect(podRootFallback("https://host.example/alice/profile/card#me")).toBe(
      "https://host.example/alice/",
    );
  });
  it("derives the origin root for an origin-rooted WebID", () => {
    expect(podRootFallback("https://alice.example/profile/card#me")).toBe("https://alice.example/");
  });
  it("falls back to the profile document's container for a non-conventional WebID", () => {
    expect(podRootFallback("https://host.example/alice/me#me")).toBe("https://host.example/alice/");
  });
});

describe("resolveStorageRoots", () => {
  const WEBID = "https://host.example/alice/profile/card#me";
  const DOC = "https://host.example/alice/profile/card";

  function profileFetch(ttl: string) {
    return vi.fn(async () =>
      new Response(ttl, { status: 200, headers: { "content-type": "text/turtle" } }),
    ) as unknown as typeof globalThis.fetch;
  }

  it("returns pim:storage declared by the WebID subject", async () => {
    const ttl = `@prefix pim: <http://www.w3.org/ns/pim/space#> .
<${WEBID}> pim:storage <https://host.example/alice/> .`;
    expect(await resolveStorageRoots(WEBID, profileFetch(ttl))).toEqual(["https://host.example/alice/"]);
  });

  it("IGNORES pim:storage declared by a foreign subject (never target the wrong storage)", async () => {
    const ttl = `@prefix pim: <http://www.w3.org/ns/pim/space#> .
<https://evil.example/mallory#me> pim:storage <https://evil.example/pod/> .
<${DOC}> pim:storage <https://host.example/somewhere-else/> .`;
    expect(await resolveStorageRoots(WEBID, profileFetch(ttl))).toEqual([]);
  });

  it("resolveStorageRoot falls back to the pod root when no pim:storage is present", async () => {
    const ttl = `@prefix foaf: <http://xmlns.com/foaf/0.1/> .
<${WEBID}> foaf:name "Alice" .`;
    expect(await resolveStorageRoot(WEBID, profileFetch(ttl))).toBe("https://host.example/alice/");
  });
});
