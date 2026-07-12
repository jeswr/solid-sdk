// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
import { parseRdf } from "@jeswr/fetch-rdf";
import { describe, expect, it, vi } from "vitest";
import { defaultSlug, ingestGranary } from "../src/ingest.js";
import { granaryObjectToCanonical } from "../src/map.js";
import { hostileNote, mastodonNote, messyFeed, rssFeed } from "./fixtures.js";

/** A stubbed authed fetch that records every request and returns a 201. */
function recordingFetch(status = 201) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(null, { status });
  }) as unknown as typeof globalThis.fetch;
  return { fetchFn, calls };
}

const CONTAINER = "https://alice.pod.example/imports/granary/";

describe("ingestGranary", () => {
  it("writes a single AS2 object as one Turtle resource under the container", async () => {
    const { fetchFn, calls } = recordingFetch();
    const result = await ingestGranary(mastodonNote, {
      writeFetch: fetchFn,
      container: CONTAINER,
    });

    expect(result.total).toBe(1);
    expect(result.written).toBe(1);
    expect(result.failed).toBe(0);
    expect(calls).toHaveLength(1);

    const { url, init } = calls[0] ?? { url: "", init: {} };
    expect(url.startsWith(CONTAINER)).toBe(true);
    expect(url.endsWith(".ttl")).toBe(true);
    expect(init.method).toBe("PUT");
    expect((init.headers as Record<string, string>)["content-type"]).toBe("text/turtle");
    const body = String(init.body);
    expect(body).toContain("a as:Note");
    expect(body).toContain("Just shipped");
    // honest imported provenance is present in the written RDF
    expect(body).toContain("prov:wasDerivedFrom");
  });

  it("OWNER-PRIVACY: never writes an .acl/.acr and never targets a share resource", async () => {
    const { fetchFn, calls } = recordingFetch();
    await ingestGranary(rssFeed, { writeFetch: fetchFn, container: CONTAINER });
    for (const { url, init } of calls) {
      expect(init.method).toBe("PUT");
      expect(url).not.toMatch(/\.acl$/);
      expect(url).not.toMatch(/\.acr$/);
      // no body asserts a broad agentClass (public/authenticated) — we never author ACLs
      const body = String(init.body ?? "");
      expect(body).not.toContain("acl:agentClass");
      expect(body).not.toContain("foaf:Agent");
    }
  });

  it("writes every item of a Collection", async () => {
    const { fetchFn, calls } = recordingFetch();
    const result = await ingestGranary(rssFeed, { writeFetch: fetchFn, container: CONTAINER });
    expect(result.total).toBe(2);
    expect(result.written).toBe(2);
    expect(calls).toHaveLength(2);
  });

  it("appends a trailing slash to a container missing one", async () => {
    const { fetchFn, calls } = recordingFetch();
    await ingestGranary(mastodonNote, {
      writeFetch: fetchFn,
      container: "https://alice.pod.example/imports/granary",
    });
    expect(calls[0]?.url.startsWith("https://alice.pod.example/imports/granary/")).toBe(true);
  });

  it("default slug is STABLE across runs (idempotent re-sync of the same source)", async () => {
    const a = recordingFetch();
    const b = recordingFetch();
    await ingestGranary(mastodonNote, { writeFetch: a.fetchFn, container: CONTAINER });
    await ingestGranary(mastodonNote, { writeFetch: b.fetchFn, container: CONTAINER });
    expect(a.calls[0]?.url).toBe(b.calls[0]?.url);
  });

  it("honours a custom slug function", async () => {
    const { fetchFn, calls } = recordingFetch();
    await ingestGranary(mastodonNote, {
      writeFetch: fetchFn,
      container: CONTAINER,
      slug: (_m, i) => `post-${i}.ttl`,
    });
    expect(calls[0]?.url).toBe(`${CONTAINER}post-0.ttl`);
  });

  it("sanitises a slug so it cannot escape the container (encoded + raw separators)", async () => {
    for (const evil of ["..%2f..%2fevil.ttl", "../../evil.ttl", "/abs/evil.ttl", "a/b/c.ttl"]) {
      const { fetchFn, calls } = recordingFetch();
      await ingestGranary(mastodonNote, {
        writeFetch: fetchFn,
        container: CONTAINER,
        slug: () => evil,
      });
      const url = calls[0]?.url ?? "";
      // The resolved write target MUST stay strictly under the container.
      expect(url.startsWith(CONTAINER)).toBe(true);
      // No path separators survive sanitisation (they collapse to '-'), so the
      // slug is a single flat resource name — it cannot traverse out.
      const tail = url.slice(CONTAINER.length);
      expect(tail).not.toContain("/");
    }
  });

  it("rejects a slug that resolves to the container itself (no PUT to the container)", async () => {
    for (const evil of ["", ".", "/", "//"]) {
      const { fetchFn, calls } = recordingFetch();
      await expect(
        ingestGranary(mastodonNote, {
          writeFetch: fetchFn,
          container: CONTAINER,
          slug: () => evil,
        }),
      ).rejects.toThrow(/slug/);
      // never issued a PUT to the container
      expect(calls).toHaveLength(0);
    }
  });

  it("writes the LongChat shape when format=longchat", async () => {
    const { fetchFn, calls } = recordingFetch();
    await ingestGranary(mastodonNote, {
      writeFetch: fetchFn,
      container: CONTAINER,
      format: "longchat",
    });
    const body = String(calls[0]?.init.body);
    expect(body).toContain("sioc:content");
  });

  it("adds If-None-Match: * when conditional=if-none-match", async () => {
    const { fetchFn, calls } = recordingFetch();
    await ingestGranary(mastodonNote, {
      writeFetch: fetchFn,
      container: CONTAINER,
      conditional: "if-none-match",
    });
    expect((calls[0]?.init.headers as Record<string, string>)["if-none-match"]).toBe("*");
  });

  it("respects maxItems", async () => {
    const { fetchFn, calls } = recordingFetch();
    const result = await ingestGranary(rssFeed, {
      writeFetch: fetchFn,
      container: CONTAINER,
      maxItems: 1,
    });
    expect(result.total).toBe(1);
    expect(calls).toHaveLength(1);
  });

  it("HARDENING: a hostile object still produces one valid write (drops bad fields)", async () => {
    const { fetchFn, calls } = recordingFetch();
    const result = await ingestGranary(hostileNote, { writeFetch: fetchFn, container: CONTAINER });
    expect(result.written).toBe(1);
    const body = String(calls[0]?.init.body);
    expect(body).toContain("a as:Note");
    expect(body).toContain("recovered body from contentMap");
    // none of the hostile non-http(s) IRIs leaked into the graph
    expect(body).not.toContain("javascript:");
    expect(body).not.toContain("urn:");
    expect(body).not.toContain("mailto:");
  });

  it("HARDENING: a feed of junk imports only the valid item", async () => {
    const { fetchFn, calls } = recordingFetch();
    const result = await ingestGranary(messyFeed, { writeFetch: fetchFn, container: CONTAINER });
    expect(result.total).toBe(1);
    expect(calls).toHaveLength(1);
  });

  describe("redirect-refusal (credential-leak hardening)", () => {
    it("forces redirect:'manual' on every credentialed PUT", async () => {
      const { fetchFn, calls } = recordingFetch();
      await ingestGranary(mastodonNote, { writeFetch: fetchFn, container: CONTAINER });
      expect(calls[0]?.init.redirect).toBe("manual");
    });

    it("treats a 3xx as a FAILED write (never followed, never counted as written)", async () => {
      const fetchFn = vi.fn(
        async () => new Response(null, { status: 302, headers: { location: "https://evil/" } }),
      ) as unknown as typeof globalThis.fetch;
      const result = await ingestGranary(mastodonNote, {
        writeFetch: fetchFn,
        container: CONTAINER,
      });
      expect(result.written).toBe(0);
      expect(result.failed).toBe(1);
      expect(result.items[0]?.written).toBe(false);
      expect(result.items[0]?.error).toMatch(/redirect/i);
    });

    it("treats an opaqueredirect response as a FAILED write", async () => {
      const opaque = Object.create(Response.prototype, {
        type: { value: "opaqueredirect" },
        status: { value: 0 },
      }) as Response;
      const fetchFn = vi.fn(async () => opaque) as unknown as typeof globalThis.fetch;
      const result = await ingestGranary(mastodonNote, {
        writeFetch: fetchFn,
        container: CONTAINER,
        continueOnError: true,
      });
      expect(result.written).toBe(0);
      expect(result.failed).toBe(1);
      expect(result.items[0]?.error).toMatch(/redirect/i);
    });
  });

  describe("container validation (scope guard / credential-in-URL)", () => {
    it("rejects a container with embedded credentials", async () => {
      const { fetchFn, calls } = recordingFetch();
      await expect(
        ingestGranary(mastodonNote, {
          writeFetch: fetchFn,
          container: "https://user:pass@alice.pod.example/imports/",
        }),
      ).rejects.toThrow(/credential/i);
      expect(calls).toHaveLength(0);
    });

    it("rejects a non-http(s) container scheme", async () => {
      const { fetchFn, calls } = recordingFetch();
      for (const bad of ["file:///etc/", "javascript:alert(1)"]) {
        await expect(
          ingestGranary(mastodonNote, { writeFetch: fetchFn, container: bad }),
        ).rejects.toThrow(/container/);
      }
      expect(calls).toHaveLength(0);
    });

    it("rejects a scheme-relative / non-absolute container", async () => {
      const { fetchFn } = recordingFetch();
      await expect(
        ingestGranary(mastodonNote, { writeFetch: fetchFn, container: "//evil.example/imports/" }),
      ).rejects.toThrow(/absolute URL/);
    });

    it("REDACTS the ENTIRE userinfo from every rejection message (no credential leak)", async () => {
      const { fetchFn } = recordingFetch();
      const capture = async (container: string): Promise<string> => {
        try {
          await ingestGranary(mastodonNote, { writeFetch: fetchFn, container });
          throw new Error("expected ingestGranary to reject");
        } catch (e) {
          return (e as Error).message;
        }
      };
      // Each case: [container, secret fragments that must NOT appear]. Every case must
      // still surface `***@`, proving the userinfo was replaced wholesale.
      const cases: [string, string[]][] = [
        // non-http(s) scheme with userinfo → the scheme-error path (echoes the URL)
        ["ftp://alice:s3cr3t@pods.example/x/", ["alice", "s3cr3t"]],
        // malformed/unparseable URL with userinfo → the catch path (echoes the URL)
        ["ht tp://bob:hunter2@x/", ["bob", "hunter2"]],
        // userinfo containing an EMBEDDED `@` — must redact up to the LAST `@`
        ["ftp://carol:sec@ret@pods.example/x/", ["carol", "sec", "ret", "sec@ret"]],
        // whitespace inside the userinfo (malformed) — must not stop at the space
        ["ht tp://dave:pass word@example/x/", ["dave", "pass", "word", "pass word"]],
        // scheme-relative //user:pass@host — still has userinfo to strip
        ["//erin:topsecret@host/x/", ["erin", "topsecret"]],
        // no-scheme user:pass@host — the authority is the whole pre-path region
        ["frank:swordfish@host/x/", ["frank", "swordfish"]],
        // `?` inside the userinfo — must NOT stop the scan at the query delimiter
        ["ftp://grace:sec?ret@pods.example/x/", ["grace", "sec", "ret", "sec?ret"]],
        // `#` inside the userinfo — must NOT stop the scan at the fragment delimiter
        ["ftp://heidi:sec#ret@pods.example/x/", ["heidi", "sec", "ret", "sec#ret"]],
      ];
      for (const [container, secrets] of cases) {
        const msg = await capture(container);
        for (const s of secrets) {
          expect(msg, `leaked "${s}" for ${container}`).not.toContain(s);
        }
        expect(msg).toContain("***@");
      }
    });

    it("rejects a `|`-bearing container (survives URL-parsing into a malformed RDF subject)", async () => {
      // `|` is the one IRIREF-illegal char the WHATWG URL parser leaves LITERAL in a
      // path, so it would flow unencoded into the subject `<…imp|orts/…#it>` — malformed
      // Turtle. Reject it (fail-closed), never write.
      const { fetchFn, calls } = recordingFetch();
      await expect(
        ingestGranary(mastodonNote, {
          writeFetch: fetchFn,
          container: "https://alice.pod.example/imp|orts/",
        }),
      ).rejects.toThrow(/illegal in an RDF IRI/);
      expect(calls).toHaveLength(0);
    });

    it("a `^`-bearing container is auto-encoded by the URL parser → SUBJECT parses as valid Turtle", async () => {
      // `^` (and backtick/`{`/`}`) are percent-encoded by URL path normalisation, so the
      // subject `<…imp%5Eorts/…#it>` is a well-formed IRIREF — accepted, not rejected.
      const { fetchFn, calls } = recordingFetch();
      const container = "https://alice.pod.example/imp^orts/";
      const result = await ingestGranary(mastodonNote, { writeFetch: fetchFn, container });
      expect(result.written).toBe(1);
      const body = String(calls[0]?.init.body ?? "");
      const dataset = await parseRdf(body, "text/turtle"); // throws on a malformed IRIREF
      expect(dataset.size).toBeGreaterThan(0);
      const subjects = [...dataset].map((q) => q.subject.value);
      // the `^` is encoded in the subject IRI, never literal
      expect(subjects.some((s) => s.includes("imp%5Eorts"))).toBe(true);
      expect(subjects.every((s) => !s.includes("imp^orts"))).toBe(true);
    });

    it("an IRIREF-clean container produces a SUBJECT that parses as valid Turtle", async () => {
      const { fetchFn, calls } = recordingFetch();
      await ingestGranary(mastodonNote, { writeFetch: fetchFn, container: CONTAINER });
      const body = String(calls[0]?.init.body ?? "");
      // parseRdf throws on a malformed IRIREF; a clean parse proves the subject is valid.
      const dataset = await parseRdf(body, "text/turtle");
      expect(dataset.size).toBeGreaterThan(0);
      // the message resource subject is the container-derived `<container…#it>` IRI
      const subjects = new Set([...dataset].map((q) => q.subject.value));
      expect([...subjects].some((s) => s.startsWith(CONTAINER))).toBe(true);
    });
  });

  it("SECURITY: a hostile `>`-bearing IRI cannot inject triples into the written Turtle", async () => {
    const { fetchFn, calls } = recordingFetch();
    const evil =
      "https://e.org/x> . <https://victim/#me> <http://www.w3.org/ns/solid/terms#oidcIssuer> <https://attacker/";
    await ingestGranary(
      { type: "Note", content: "hi", attributedTo: evil, url: evil },
      { writeFetch: fetchFn, container: CONTAINER },
    );
    const body = String(calls[0]?.init.body ?? "");
    // DECISIVE proof: parse the written Turtle and assert the forged triple did NOT
    // materialise. Before the safeHttpIri canonicalisation, the raw `>` would break out
    // of the `<…>` IRIREF and forge `<victim/#me> solid:oidcIssuer <attacker>` — an
    // account-takeover. Now every quad's subject is the single message resource, and no
    // predicate is `solid:oidcIssuer`.
    // Parse via the suite RDF parser (@jeswr/fetch-rdf) — never a bespoke/direct n3.
    const dataset = await parseRdf(body, "text/turtle");
    for (const q of dataset) {
      expect(q.subject.value).not.toBe("https://victim/#me");
      expect(q.predicate.value).not.toBe("http://www.w3.org/ns/solid/terms#oidcIssuer");
    }
    // the hostile value DID land — but as one safe, fully-encoded IRI token (no raw `>`).
    expect(body).toContain("%3E");
    // and it parsed at all (a malformed IRIREF would have thrown in parseRdf above).
    expect(dataset.size).toBeGreaterThan(0);
  });

  describe("error handling", () => {
    it("fail-closed: stops on the first non-2xx and reports the partial result", async () => {
      let n = 0;
      const fetchFn = vi.fn(async () => {
        n++;
        return new Response(null, { status: n === 1 ? 201 : 500 });
      }) as unknown as typeof globalThis.fetch;
      const result = await ingestGranary(rssFeed, { writeFetch: fetchFn, container: CONTAINER });
      expect(result.written).toBe(1);
      expect(result.failed).toBe(1);
      expect(result.items[1]?.status).toBe(500);
      // stopped — only two attempts despite a 2-item feed where item 2 failed
      expect((fetchFn as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(2);
    });

    it("continueOnError: records failures and keeps going", async () => {
      let n = 0;
      const fetchFn = vi.fn(async () => {
        n++;
        return new Response(null, { status: n === 1 ? 500 : 201 });
      }) as unknown as typeof globalThis.fetch;
      const result = await ingestGranary(rssFeed, {
        writeFetch: fetchFn,
        container: CONTAINER,
        continueOnError: true,
      });
      expect(result.total).toBe(2);
      expect(result.written).toBe(1);
      expect(result.failed).toBe(1);
    });

    it("fail-closed: a thrown fetch error rethrows with the partial result attached", async () => {
      const fetchFn = vi.fn(async () => {
        throw new Error("network down");
      }) as unknown as typeof globalThis.fetch;
      await expect(
        ingestGranary(mastodonNote, { writeFetch: fetchFn, container: CONTAINER }),
      ).rejects.toMatchObject({
        message: expect.stringContaining("write failed at item 0"),
      });
    });

    it("rejects a missing container", async () => {
      const { fetchFn } = recordingFetch();
      await expect(
        // biome-ignore lint/suspicious/noExplicitAny: testing the runtime guard.
        ingestGranary(mastodonNote, { writeFetch: fetchFn, container: "" as any }),
      ).rejects.toThrow(/container/);
    });
  });
});

describe("defaultSlug", () => {
  it("is deterministic and ends with .ttl", () => {
    const msg = granaryObjectToCanonical(mastodonNote);
    expect(defaultSlug(msg, 0)).toBe(defaultSlug(msg, 0));
    expect(defaultSlug(msg, 0)).toMatch(/^granary-[0-9a-f]{8}\.ttl$/);
  });
  it("differs for different source permalinks", () => {
    const a = granaryObjectToCanonical(mastodonNote);
    const b = granaryObjectToCanonical({
      type: "Note",
      content: "x",
      url: "https://other.example/p",
    });
    expect(defaultSlug(a, 0)).not.toBe(defaultSlug(b, 0));
  });
});
