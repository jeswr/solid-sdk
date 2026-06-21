// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// §9 SSRF-discipline tests for the pre-fetch resolver: a `remote` (untrusted)
// source uses ONLY the guarded fetch — never the app's auth/public seam; a
// `trusted` source uses the right seam fetch; an `inline` source fetches nothing.

// `loadGraphs` is shacl-form's REAL loader — we call it directly to EXECUTION-
// PROVE the auto-import SSRF fires on a raw hostile graph and is closed by our
// neutralisation (the non-vacuous proof of fix 2).
import { loadGraphs } from "@ulb-darmstadt/shacl-form";
import { describe, expect, it, vi } from "vitest";
import {
  countTurtleQuads,
  type FetchSeam,
  type GraphSource,
  neutraliseValuesTurtle,
  resolveGraphToTurtle,
} from "../src/shacl-view-fetch.js";

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

// ── §9 fix (4): no-network RDF types ONLY, uniformly across source kinds ──────
describe("resolveGraphToTurtle — §9 fix(4) no-network RDF types (inline + trusted)", () => {
  it("REJECTS an inline JSON-LD source (its remote @context would fetch unguarded)", async () => {
    const { seam } = seamWithSpies();
    await expect(
      resolveGraphToTurtle(
        {
          kind: "inline",
          text: '{"@context":"https://evil.example/ctx","@id":"https://x.example/a"}',
          contentType: "application/ld+json",
        },
        seam,
      ),
    ).rejects.toThrow(/not a no-network RDF type|JSON-LD|@context/i);
  });

  it("a trusted source asks for Turtle ONLY (never JSON-LD) — fix(4) tightened from JSON-LD-open", async () => {
    const auth = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () =>
      turtleResponse(SHAPES),
    );
    const tightSeam: FetchSeam = { fetch: auth as unknown as typeof fetch };
    await resolveGraphToTurtle(
      { kind: "trusted", url: "https://alice.example/shape", seam: "auth" },
      tightSeam,
    );
    const init = auth.mock.calls[0][1] as RequestInit;
    const accept = (init.headers as Record<string, string>).Accept;
    expect(accept).toBe("text/turtle");
    expect(accept).not.toContain("ld+json");
  });

  it("REJECTS a JSON-LD body from a TRUSTED source (closes the §9 Low)", async () => {
    // Even a trusted (app-chosen) URL whose server returns JSON-LD is refused —
    // its remote @context could trigger an unguarded parser fetch.
    const auth = vi.fn(
      async () =>
        new Response('{"@context":"https://evil.example/ctx","@id":"x"}', {
          status: 200,
          headers: { "Content-Type": "application/ld+json" },
        }),
    );
    const seam: FetchSeam = { fetch: auth as unknown as typeof fetch };
    await expect(
      resolveGraphToTurtle({ kind: "trusted", url: "https://alice.example/d", seam: "auth" }, seam),
    ).rejects.toThrow(/not a no-network RDF type|JSON-LD/i);
  });

  it("still ACCEPTS an inline Turtle source (the normal path is unaffected)", async () => {
    const { seam } = seamWithSpies();
    const out = await resolveGraphToTurtle({ kind: "inline", text: SHAPES }, seam);
    expect(out).toContain("NodeShape");
  });
});

// ── §9 fix (2): neutralise the untrusted values graph ────────────────────────
describe("neutraliseValuesTurtle — drops rdf:type / dct:conformsTo http(s) import targets", () => {
  const HOSTILE = `
@prefix dct: <http://purl.org/dc/terms/> .
@prefix ex: <https://ex.example/> .
<https://victim.example/x>
  dct:conformsTo <http://169.254.169.254/latest/meta-data/> ;
  a <http://192.168.0.1/shape> ;
  a ex:LocalType ;
  ex:name "Alice" .
`;

  it("drops conformsTo→http(s) and rdf:type→http(s), keeps literals + non-http types", async () => {
    const out = await neutraliseValuesTurtle(HOSTILE);
    // Import targets gone.
    expect(out).not.toContain("169.254.169.254");
    expect(out).not.toContain("192.168.0.1");
    expect(out).not.toContain("conformsTo");
    // Benign data preserved: the literal name AND the http(s) rdf:type to a
    // legitimate vocab is ALSO an http(s) IRI, so per the rule it is dropped too —
    // confirm the literal survives (the view's actual content).
    expect(out).toContain("Alice");
  });

  it("a non-http rdf:type (blank node / urn) is PRESERVED (not an import target)", async () => {
    const data = `
@prefix dct: <http://purl.org/dc/terms/> .
<https://victim.example/x> a <urn:my:type> ; dct:conformsTo <urn:my:profile> ; <https://ex.example/p> "v" .
`;
    const out = await neutraliseValuesTurtle(data);
    // urn: objects are NOT http(s) fetch targets, so they stay.
    expect(out).toContain("urn:my:type");
    expect(out).toContain("urn:my:profile");
    expect(out).toContain('"v"');
  });

  it("leaves an entirely benign data graph unchanged in content", async () => {
    const data = `<https://x.example/a> <https://x.example/p> "v" .`;
    const out = await neutraliseValuesTurtle(data);
    expect(out).toContain("https://x.example/a");
    expect(out).toContain('"v"');
  });
});

describe("countTurtleQuads — the empty-shapes fail-closed signal (fix 1)", () => {
  it("returns 0 for an empty / comment-only / prefix-only shapes graph", async () => {
    expect(await countTurtleQuads("")).toBe(0);
    expect(await countTurtleQuads("# only a comment\n")).toBe(0);
    expect(await countTurtleQuads("@prefix ex: <https://ex.example/> .\n")).toBe(0);
  });

  it("returns a positive count for a real shapes graph", async () => {
    expect(await countTurtleQuads(SHAPES)).toBeGreaterThan(0);
  });
});

// ── EXECUTION PROOF against the REAL upstream loader (the non-vacuous test) ───
//
// This is the test whose ABSENCE let the original build pass. It calls
// @ulb-darmstadt/shacl-form's actual `loadGraphs()` — the function the HIGH lives
// in — with `loadOwlImports: false` (i.e. `data-ignore-owl-imports` SET, proving
// that flag does NOT cover this path) and an EMPTY shapes graph (the auto-import
// precondition). On a RAW hostile data graph it fires real unguarded fetches to
// the SSRF targets; on the NEUTRALISED graph it fires none.
describe("§9 EXECUTION PROOF — upstream loadGraphs auto-import (the HIGH)", () => {
  const HOSTILE = `
@prefix dct: <http://purl.org/dc/terms/> .
<https://victim.example/x>
  dct:conformsTo <http://169.254.169.254/latest/meta-data/iam/security-credentials/> ;
  a <http://192.168.0.1/internal-shape> .
`;

  function spyFetch(): { spy: ReturnType<typeof vi.spyOn>; calls: string[] } {
    const calls: string[] = [];
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      calls.push(String(input));
      return new Response("<a> <b> <c> .", { headers: { "Content-Type": "text/turtle" } });
    });
    return { spy, calls };
  }

  it("RAW hostile data + empty shapes → the upstream auto-import DOES fetch the SSRF targets (proves the threat is real)", async () => {
    const { spy, calls } = spyFetch();
    try {
      // loadOwlImports:false ⇒ `data-ignore-owl-imports` is SET; the auto-import
      // is a DIFFERENT path, so it still fires.
      await loadGraphs({ shapes: "", values: HOSTILE, loadOwlImports: false } as never);
      // It fetched BOTH the cloud-metadata IAM endpoint and the internal IP, unguarded.
      expect(calls).toContain("http://169.254.169.254/latest/meta-data/iam/security-credentials/");
      expect(calls).toContain("http://192.168.0.1/internal-shape");
    } finally {
      spy.mockRestore();
    }
  });

  it("NEUTRALISED data + empty shapes → the upstream auto-import fetches NOTHING (proves fix 2 closes it)", async () => {
    const neutralised = await neutraliseValuesTurtle(HOSTILE);
    const { spy, calls } = spyFetch();
    try {
      await loadGraphs({ shapes: "", values: neutralised, loadOwlImports: false } as never);
      expect(calls).toHaveLength(0);
    } finally {
      spy.mockRestore();
    }
  });
});
