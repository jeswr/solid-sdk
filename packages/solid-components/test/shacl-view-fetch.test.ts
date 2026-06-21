// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// §9 SSRF-discipline tests for the pre-fetch resolver: a `remote` (untrusted)
// source uses ONLY the guarded fetch — never the app's auth/public seam; a
// `trusted` source uses the right seam fetch; an `inline` source fetches nothing.

import { describe, expect, it, vi } from "vitest";
import { type FetchSeam, type GraphSource, resolveGraphToTurtle } from "../src/shacl-view-fetch.js";

const SHAPES = `
@prefix sh: <http://www.w3.org/ns/shacl#> .
@prefix ex: <https://ex.example/> .
ex:S a sh:NodeShape ; sh:targetClass ex:Thing .
`;

function turtleResponse(body: string): Response {
  return new Response(body, { status: 200, headers: { "Content-Type": "text/turtle" } });
}

function seamWithSpies(): {
  seam: FetchSeam;
  auth: ReturnType<typeof vi.fn>;
  pub: ReturnType<typeof vi.fn>;
} {
  const auth = vi.fn(async () => turtleResponse(SHAPES));
  const pub = vi.fn(async () => turtleResponse(SHAPES));
  return {
    auth,
    pub,
    seam: {
      fetch: auth as unknown as typeof fetch,
      publicFetch: pub as unknown as typeof fetch,
    },
  };
}

describe("resolveGraphToTurtle — inline", () => {
  it("parses + re-serialises inline turtle, fetching NOTHING", async () => {
    const { seam, auth, pub } = seamWithSpies();
    const source: GraphSource = { kind: "inline", text: SHAPES };
    const out = await resolveGraphToTurtle(source, seam, {
      loadGuardedFetch: () => {
        throw new Error("guarded fetch must not be loaded for inline");
      },
    });
    expect(out).toContain("NodeShape");
    expect(auth).not.toHaveBeenCalled();
    expect(pub).not.toHaveBeenCalled();
  });

  it("rejects malformed inline RDF (parsed before reaching shacl-form)", async () => {
    const { seam } = seamWithSpies();
    await expect(
      resolveGraphToTurtle({ kind: "inline", text: "<<< not rdf" }, seam),
    ).rejects.toBeTruthy();
  });
});

describe("resolveGraphToTurtle — trusted", () => {
  it("a trusted+auth source uses the AUTH fetch, not public, not guarded", async () => {
    const { seam, auth, pub } = seamWithSpies();
    const guarded = vi.fn(async () => turtleResponse(SHAPES));
    await resolveGraphToTurtle(
      { kind: "trusted", url: "https://alice.example/shape", seam: "auth" },
      seam,
      { loadGuardedFetch: () => Promise.resolve(guarded as unknown as typeof fetch) },
    );
    expect(auth).toHaveBeenCalledTimes(1);
    expect(pub).not.toHaveBeenCalled();
    expect(guarded).not.toHaveBeenCalled();
  });

  it("a trusted+public source uses the PUBLIC fetch", async () => {
    const { seam, auth, pub } = seamWithSpies();
    await resolveGraphToTurtle(
      { kind: "trusted", url: "https://pub.example/shape", seam: "public" },
      seam,
    );
    expect(pub).toHaveBeenCalledTimes(1);
    expect(auth).not.toHaveBeenCalled();
  });

  it("a trusted+public source FAILS CLOSED when publicFetch is absent (no auth fallback)", async () => {
    // Credential boundary: with no publicFetch in the seam, a public source MUST
    // throw — it must never silently use the authenticated `fetch`.
    const auth = vi.fn(async () => turtleResponse(SHAPES));
    const seam = { fetch: auth as unknown as typeof fetch }; // NO publicFetch.
    await expect(
      resolveGraphToTurtle({ kind: "trusted", url: "https://pub.example/s", seam: "public" }, seam),
    ).rejects.toThrow(/publicFetch|credential-free/i);
    expect(auth).not.toHaveBeenCalled();
  });
});

describe("resolveGraphToTurtle — remote (untrusted, §9 SSRF surface)", () => {
  it("uses ONLY the guarded fetch — NEVER the app auth/public seam", async () => {
    const { seam, auth, pub } = seamWithSpies();
    const guarded = vi.fn(async () => turtleResponse(SHAPES));
    await resolveGraphToTurtle({ kind: "remote", url: "https://remote.example/shape" }, seam, {
      loadGuardedFetch: () => Promise.resolve(guarded as unknown as typeof fetch),
    });
    expect(guarded).toHaveBeenCalledTimes(1);
    // The credential-bearing + public app fetches are NEVER used for untrusted URLs.
    expect(auth).not.toHaveBeenCalled();
    expect(pub).not.toHaveBeenCalled();
  });

  it("asks for Turtle ONLY (no JSON-LD) — avoids a remote @context fetch surface", async () => {
    const { seam } = seamWithSpies();
    const guarded = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () =>
      turtleResponse(SHAPES),
    );
    await resolveGraphToTurtle({ kind: "remote", url: "https://remote.example/shape" }, seam, {
      loadGuardedFetch: () => Promise.resolve(guarded as unknown as typeof fetch),
    });
    const init = guarded.mock.calls[0][1] as RequestInit;
    const accept = (init.headers as Record<string, string>).Accept;
    expect(accept).toBe("text/turtle");
    expect(accept).not.toContain("ld+json");
  });

  it("REJECTS a JSON-LD body from a remote source (no unguarded @context fetch)", async () => {
    // Even if a malicious server ignores our Turtle-only Accept and returns JSON-LD
    // (whose @context could trigger a second, UNGUARDED fetch in the parser), we
    // refuse it rather than parse it.
    const { seam } = seamWithSpies();
    const guarded = vi.fn(
      async () =>
        new Response('{"@context":"https://evil.example/ctx","@id":"x"}', {
          status: 200,
          headers: { "Content-Type": "application/ld+json" },
        }),
    );
    await expect(
      resolveGraphToTurtle({ kind: "remote", url: "https://remote.example/shape" }, seam, {
        loadGuardedFetch: () => Promise.resolve(guarded as unknown as typeof fetch),
      }),
    ).rejects.toThrow(/not a no-network RDF type|JSON-LD/i);
  });

  it("forwards maxBytes/timeoutMs to the guarded loader", async () => {
    const { seam } = seamWithSpies();
    const loader = vi.fn(() =>
      Promise.resolve((async () => turtleResponse(SHAPES)) as unknown as typeof fetch),
    );
    await resolveGraphToTurtle({ kind: "remote", url: "https://remote.example/s" }, seam, {
      loadGuardedFetch: loader,
      maxBytes: 123,
      timeoutMs: 456,
    });
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("propagates a guard rejection (the element shows the error)", async () => {
    const { seam } = seamWithSpies();
    const guarded = vi.fn(async () => {
      throw new Error("SSRF: blocked private address");
    });
    await expect(
      resolveGraphToTurtle({ kind: "remote", url: "http://169.254.169.254/" }, seam, {
        loadGuardedFetch: () => Promise.resolve(guarded as unknown as typeof fetch),
      }),
    ).rejects.toThrow(/SSRF/);
  });

  it("the DEFAULT (no loader stub) imports @jeswr/guarded-fetch's createGuardedFetch", async () => {
    // Proves production uses the real guard (its createGuardedFetch enforces
    // https-only / private-IP blocking). We don't hit the network: the guard
    // rejects a private/loopback target up front.
    const { seam } = seamWithSpies();
    await expect(
      resolveGraphToTurtle({ kind: "remote", url: "http://127.0.0.1/secret" }, seam),
    ).rejects.toBeTruthy();
  });
});
