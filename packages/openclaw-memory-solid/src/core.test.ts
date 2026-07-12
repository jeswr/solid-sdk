// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
//
// Exhaustive adapter tests driven by a REAL `MemoryStore` over an in-memory
// fake-LDP `fetch` (mirrors @jeswr/solid-memory's store.test.ts makePod()). This
// round-trips REAL RDF through @jeswr/solid-memory — we do NOT mock MemoryStore.

import { MemoryStore, serializeMemory } from "@jeswr/solid-memory";
import { beforeEach, describe, expect, it } from "vitest";
import { SolidMemoryAdapter } from "./core.js";

const CONTAINER = "https://alice.pod/agent/memories/";
const AGENT_WEBID = "https://agent.example/profile/card#me";
const CONVERSATION = "https://alice.pod/chat/room-1#it";

/**
 * A fake pod: an in-memory `Map<url, {body, etag}>` served by a mock `fetch` that
 * honours `If-None-Match: *` (412 if exists), `If-Match: <etag>` (412 on
 * mismatch), GET/PUT/DELETE, ETag bumping on write, 404 for missing, and a
 * container LISTING (ldp:contains) for the container URL. A `calls` array records
 * every requested URL+method so a test can assert NO request was issued.
 */
function makePod() {
  const store = new Map<string, { body: string; etag: string }>();
  const calls: Array<{ url: string; method: string }> = [];
  let etagSeq = 0;
  const nextEtag = () => `"etag-${++etagSeq}"`;

  const fetchImpl: typeof globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push({ url, method });
    const headers = new Headers(init?.headers ?? {});

    // Container listing.
    if (url === CONTAINER && method === "GET") {
      const members = [...store.keys()].filter((u) => u !== CONTAINER && u.startsWith(CONTAINER));
      const contains = members.map((u) => `<${u}>`).join(", ");
      const body = `@prefix ldp: <http://www.w3.org/ns/ldp#> .
<${CONTAINER}> a ldp:Container, ldp:BasicContainer${contains ? ` ;\n  ldp:contains ${contains}` : ""} .`;
      return new Response(body, {
        status: 200,
        headers: { "content-type": "text/turtle", etag: nextEtag() },
      });
    }

    if (method === "GET") {
      const entry = store.get(url);
      if (!entry) return new Response(null, { status: 404 });
      return new Response(entry.body, {
        status: 200,
        headers: { "content-type": "text/turtle", etag: entry.etag },
      });
    }

    if (method === "PUT") {
      const existing = store.get(url);
      if (headers.get("if-none-match") === "*" && existing) {
        return new Response(null, { status: 412 });
      }
      const ifMatch = headers.get("if-match");
      if (ifMatch && (!existing || existing.etag !== ifMatch)) {
        return new Response(null, { status: 412 });
      }
      const body = typeof init?.body === "string" ? init.body : String(init?.body ?? "");
      const etag = nextEtag();
      store.set(url, { body, etag });
      return new Response(null, { status: existing ? 205 : 201, headers: { etag } });
    }

    if (method === "DELETE") {
      const existing = store.get(url);
      if (!existing) return new Response(null, { status: 404 });
      const ifMatch = headers.get("if-match");
      if (ifMatch && existing.etag !== ifMatch) {
        return new Response(null, { status: 412 });
      }
      store.delete(url);
      return new Response(null, { status: 204 });
    }

    return new Response(null, { status: 405 });
  };

  return { store, calls, fetchImpl };
}

function makeAdapter(extra?: { agentWebId?: string; defaultGeneratedBy?: string }) {
  const pod = makePod();
  const adapter = new SolidMemoryAdapter({
    container: CONTAINER,
    fetch: pod.fetchImpl,
    agentWebId: extra?.agentWebId,
    defaultGeneratedBy: extra?.defaultGeneratedBy,
  });
  return { ...pod, adapter };
}

describe("construction", () => {
  it("builds from { container, fetch }", () => {
    const { adapter } = makeAdapter();
    expect(adapter.container).toBe(CONTAINER);
  });

  it("builds from a ready { memoryStore }", () => {
    const { fetchImpl } = makePod();
    const memoryStore = new MemoryStore({ container: CONTAINER, fetch: fetchImpl });
    const adapter = new SolidMemoryAdapter({ memoryStore });
    expect(adapter.container).toBe(CONTAINER);
  });

  it("rejects a non-http(s) container (delegated to MemoryStore)", () => {
    const { fetchImpl } = makePod();
    expect(() => new SolidMemoryAdapter({ container: "ftp://x/", fetch: fetchImpl })).toThrow();
  });
});

describe("store → recall round-trip (real RDF)", () => {
  it("stores a memory and recalls it by text substring", async () => {
    const { adapter } = makeAdapter();
    const stored = await adapter.store("remember to enable dark mode");
    expect(stored.id.startsWith(CONTAINER)).toBe(true);
    expect(stored.memory).toBe("remember to enable dark mode");

    const recalled = await adapter.recall("dark");
    expect(recalled).toHaveLength(1);
    expect(recalled[0]?.memory).toBe("remember to enable dark mode");
    expect(recalled[0]?.id).toBe(stored.id);
  });

  it("recall is case-insensitive and returns no fabricated score", async () => {
    const { adapter } = makeAdapter();
    await adapter.store("Sydney is the capital choice");
    const recalled = await adapter.recall("SYDNEY");
    expect(recalled).toHaveLength(1);
    expect(recalled[0]).not.toHaveProperty("score");
  });

  it("recall of a non-matching query returns []", async () => {
    const { adapter } = makeAdapter();
    await adapter.store("hello world");
    expect(await adapter.recall("nonexistent")).toEqual([]);
  });
});

describe("PROV-O attribution threading", () => {
  it("attributes a stored memory to the configured agentWebId, never the agent_id", async () => {
    const { adapter } = makeAdapter({ agentWebId: AGENT_WEBID });
    const stored = await adapter.store("a memory", {
      agentId: "free-text-agent-id-not-an-iri",
      generatedBy: CONVERSATION,
    });
    // agentId is echoed on the result but is NOT the RDF attribution.
    expect(stored.agentId).toBe("free-text-agent-id-not-an-iri");

    const got = await adapter.get(stored.id);
    expect(got?.metadata.attributedTo).toBe(AGENT_WEBID);
    expect(got?.metadata.generatedBy).toBe(CONVERSATION);
  });

  it("omits attribution when no agentWebId is configured (never invents one)", async () => {
    const { adapter } = makeAdapter(); // no agentWebId
    const stored = await adapter.store("unattributed");
    const got = await adapter.get(stored.id);
    expect(got?.metadata.attributedTo).toBeUndefined();
  });

  it("falls back to defaultGeneratedBy when a store omits generatedBy", async () => {
    const { adapter } = makeAdapter({ defaultGeneratedBy: CONVERSATION });
    const stored = await adapter.store("uses default conversation");
    const got = await adapter.get(stored.id);
    expect(got?.metadata.generatedBy).toBe(CONVERSATION);
  });

  it("an explicit generatedBy overrides the default", async () => {
    const other = "https://alice.pod/chat/room-2#it";
    const { adapter } = makeAdapter({ defaultGeneratedBy: CONVERSATION });
    const stored = await adapter.store("override", { generatedBy: other });
    const got = await adapter.get(stored.id);
    expect(got?.metadata.generatedBy).toBe(other);
  });
});

describe("store with keywords / categories", () => {
  it("stores and round-trips keywords + categories", async () => {
    const { adapter } = makeAdapter();
    const stored = await adapter.store("tagged memory", {
      keywords: ["ui", "preferences"],
      categories: ["https://schema.org/Thing"],
    });
    const got = await adapter.get(stored.id);
    expect(got?.metadata.keywords?.sort()).toEqual(["preferences", "ui"]);
    expect(got?.metadata.categories).toEqual(["https://schema.org/Thing"]);
  });

  it("store without optional fields works", async () => {
    const { adapter } = makeAdapter();
    const stored = await adapter.store("plain");
    const got = await adapter.get(stored.id);
    expect(got?.memory).toBe("plain");
    expect(got?.metadata.keywords).toBeUndefined();
  });

  it("store rejects empty content", async () => {
    const { adapter } = makeAdapter();
    await expect(adapter.store("")).rejects.toThrow();
  });
});

describe("get", () => {
  it("returns a stored memory", async () => {
    const { adapter } = makeAdapter();
    const stored = await adapter.store("findable");
    const got = await adapter.get(stored.id);
    expect(got?.memory).toBe("findable");
    expect(got?.id).toBe(stored.id);
  });

  it("returns null for a missing id (in container)", async () => {
    const { adapter } = makeAdapter();
    expect(await adapter.get(`${CONTAINER}does-not-exist`)).toBeNull();
  });

  it("returns null for a non-memory resource (drop-not-fatal)", async () => {
    const { store, adapter } = makeAdapter();
    const url = `${CONTAINER}notes`;
    store.set(url, { body: `<${url}#it> <http://schema.org/text> "x" .`, etag: '"e"' });
    expect(await adapter.get(url)).toBeNull();
  });
});

describe("recall attaches the pod id, then forget deletes it", () => {
  it("forget(id) from recall deletes the memory (subsequent get → null)", async () => {
    const { adapter } = makeAdapter();
    await adapter.store("to be forgotten");
    const recalled = await adapter.recall("forgotten");
    expect(recalled).toHaveLength(1);
    const first = recalled[0];
    if (!first) throw new Error("test: expected one recalled memory");
    const id = first.id;

    const result = await adapter.forget(id);
    expect(result.ok).toBe(true);
    expect(await adapter.get(id)).toBeNull();
  });

  it("forget of a missing (in-container) id surfaces a clean failure", async () => {
    const { adapter } = makeAdapter();
    // Missing resource → DELETE 404 → MemoryStore throws (not a scope error) →
    // re-thrown by forget (network/server error, not caller-attributable).
    await expect(adapter.forget(`${CONTAINER}never`)).rejects.toThrow();
  });
});

describe("scope guard — out-of-container id rejected with NO network call", () => {
  const foreigns = [
    "https://evil.example/steal",
    "https://alice.pod/other/x",
    "https://alice.pod/x",
  ];

  for (const foreign of foreigns) {
    it(`forget("${foreign}") is a clean failure and issues no request`, async () => {
      const { calls, adapter } = makeAdapter();
      const before = calls.length;
      const result = await adapter.forget(foreign);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("out-of-scope");
        expect(result.message).toMatch(/outside the configured memory container|refused/i);
      }
      // No network request was issued for the foreign target.
      expect(calls.slice(before)).toEqual([]);
    });

    it(`get("${foreign}") returns null and issues no request`, async () => {
      const { calls, adapter } = makeAdapter();
      const before = calls.length;
      expect(await adapter.get(foreign)).toBeNull();
      expect(calls.slice(before)).toEqual([]);
    });
  }
});

describe("malformed / hostile member dropped, not fatal", () => {
  it("recall / list returns ONLY the good memory and never surfaces a hostile IRI", async () => {
    const { store, adapter } = makeAdapter();
    // A good memory.
    const goodUrl = `${CONTAINER}good`;
    store.set(goodUrl, {
      body: await serializeMemory(goodUrl, { text: "good memory about cats" }),
      etag: '"g"',
    });
    // A garbage-Turtle member (not a valid mem:MemoryItem; parse yields no memory).
    const garbageUrl = `${CONTAINER}garbage`;
    store.set(garbageUrl, { body: "this is not valid turtle <<< @@@ ;;;", etag: '"x"' });
    // A member whose attributedTo is a hostile non-http(s) IRI.
    const hostileUrl = `${CONTAINER}hostile`;
    const hostileBody = `@prefix mem: <https://w3id.org/jeswr/memory#> .
@prefix schema: <http://schema.org/> .
@prefix prov: <http://www.w3.org/ns/prov#> .
<${hostileUrl}#it> a mem:MemoryItem ;
  schema:text "memory about cats with a hostile attribution" ;
  prov:wasAttributedTo <javascript:alert(1)> .`;
    store.set(hostileUrl, { body: hostileBody, etag: '"h"' });

    const recalled = await adapter.recall("cats");
    // The good memory + the hostile-but-otherwise-valid memory both match "cats".
    // The garbage member is dropped (not a memory). The hostile IRI is NEVER
    // surfaced (solid-memory drops non-http(s) IRIs on read).
    const texts = recalled.map((r) => r.memory).sort();
    expect(texts).toContain("good memory about cats");
    for (const r of recalled) {
      expect(r.metadata.attributedTo).not.toBe("javascript:alert(1)");
      expect(r.metadata.attributedTo ?? "").not.toMatch(/^javascript:/);
    }

    // list() likewise never throws and never surfaces the hostile IRI.
    const listed = await adapter.list();
    expect(listed.length).toBeGreaterThanOrEqual(1);
    for (const r of listed) {
      expect(r.metadata.attributedTo ?? "").not.toMatch(/^javascript:|^mailto:/);
    }
    // The garbage (non-memory) member is not in the listing.
    expect(listed.map((r) => r.id)).not.toContain(garbageUrl);
  });
});

describe("limit", () => {
  it("recall caps results to limit", async () => {
    const { adapter } = makeAdapter();
    for (let i = 0; i < 5; i++) await adapter.store(`memory about topic ${i}`);
    const recalled = await adapter.recall("topic", 2);
    expect(recalled).toHaveLength(2);
  });

  it("limit of 0 yields no results", async () => {
    const { adapter } = makeAdapter();
    await adapter.store("memory about topic");
    expect(await adapter.recall("topic", 0)).toEqual([]);
  });

  it("a negative limit is treated as no cap", async () => {
    const { adapter } = makeAdapter();
    for (let i = 0; i < 3; i++) await adapter.store(`memory about topic ${i}`);
    expect((await adapter.recall("topic", -1)).length).toBe(3);
  });

  it("no limit returns everything matching", async () => {
    const { adapter } = makeAdapter();
    for (let i = 0; i < 3; i++) await adapter.store(`memory about topic ${i}`);
    expect((await adapter.recall("topic")).length).toBe(3);
  });
});

describe("search (structured)", () => {
  it("filters by keywords (match-ALL) and keeps the id", async () => {
    const { adapter } = makeAdapter();
    const a = await adapter.store("ui memory", { keywords: ["ui", "css"] });
    await adapter.store("geo memory", { keywords: ["geo"] });
    const found = await adapter.search({ keywords: ["ui", "css"] });
    expect(found).toHaveLength(1);
    expect(found[0]?.id).toBe(a.id);
  });

  it("filters by attributedTo", async () => {
    const { adapter } = makeAdapter({ agentWebId: AGENT_WEBID });
    await adapter.store("mine");
    const found = await adapter.search({ attributedTo: AGENT_WEBID });
    expect(found).toHaveLength(1);
    const none = await adapter.search({ attributedTo: "https://other.example/me#me" });
    expect(none).toEqual([]);
  });
});

describe("list", () => {
  it("returns all stored memories with their ids", async () => {
    const { adapter } = makeAdapter();
    const a = await adapter.store("one");
    const b = await adapter.store("two");
    const ids = (await adapter.list()).map((r) => r.id).sort();
    expect(ids).toEqual([a.id, b.id].sort());
  });

  it("returns [] for an empty container", async () => {
    const { adapter } = makeAdapter();
    expect(await adapter.list()).toEqual([]);
  });
});

describe("adapter built from a ready MemoryStore", () => {
  let store: MemoryStore;
  let adapter: SolidMemoryAdapter;
  beforeEach(() => {
    const pod = makePod();
    store = new MemoryStore({ container: CONTAINER, fetch: pod.fetchImpl });
    adapter = new SolidMemoryAdapter({ memoryStore: store, agentWebId: AGENT_WEBID });
  });

  it("stores and recalls through the injected store", async () => {
    const stored = await adapter.store("via injected store");
    const recalled = await adapter.recall("injected");
    expect(recalled[0]?.id).toBe(stored.id);
    expect(recalled[0]?.metadata.attributedTo).toBe(AGENT_WEBID);
  });
});

describe("un-parseable body is drop-not-fatal (regression: MemoryStore.all() aborts on a parse error)", () => {
  it("get() of a garbage-Turtle resource returns null, never throws", async () => {
    const { store, adapter } = makeAdapter();
    const url = `${CONTAINER}garbage`;
    // A body that throws inside @jeswr/fetch-rdf's parseRdf (N3 syntax error).
    store.set(url, { body: "this is not valid turtle <<< @@@ ;;;", etag: '"x"' });
    expect(await adapter.get(url)).toBeNull();
  });

  it("a single un-parseable member does NOT abort recall / list (the whole listing survives)", async () => {
    const { store, adapter } = makeAdapter();
    // One good memory and one un-parseable member in the same container.
    await adapter.store("good memory about widgets");
    store.set(`${CONTAINER}poison`, { body: "@@@ not turtle @@@", etag: '"p"' });

    // recall must not throw and must still return the good memory.
    const recalled = await adapter.recall("widgets");
    expect(recalled).toHaveLength(1);
    expect(recalled[0]?.memory).toBe("good memory about widgets");

    // list must not throw and must still surface the good memory.
    const listed = await adapter.list();
    expect(listed.some((r) => r.memory === "good memory about widgets")).toBe(true);
  });

  it("a genuine 5xx on a member is RE-THROWN (a real outage is not silently swallowed)", async () => {
    // A pod that lists one member but 500s on GETting it.
    const failingMember = `${CONTAINER}m1`;
    const fetchImpl: typeof globalThis.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = (init?.method ?? "GET").toUpperCase();
      if (url === CONTAINER && method === "GET") {
        const body = `@prefix ldp: <http://www.w3.org/ns/ldp#> .
<${CONTAINER}> a ldp:Container ; ldp:contains <${failingMember}> .`;
        return new Response(body, { status: 200, headers: { "content-type": "text/turtle" } });
      }
      // The member GET errors with a server error (not a parse error).
      return new Response(null, { status: 503 });
    };
    const adapter = new SolidMemoryAdapter({ container: CONTAINER, fetch: fetchImpl });
    await expect(adapter.list()).rejects.toThrow();
    await expect(adapter.recall("anything")).rejects.toThrow();
  });
});

describe("parse-error detection walks a wrapped cause chain but stays narrow", () => {
  // A minimal MemoryStore-shaped stub whose `get` throws a chosen error, so we can
  // exercise the adapter's cause-chain parse-error classification directly.
  function adapterWhoseGetThrows(err: unknown): SolidMemoryAdapter {
    const member = `${CONTAINER}m1`;
    const stub = {
      container: CONTAINER,
      async list() {
        return [{ url: member, container: false }];
      },
      async get() {
        throw err;
      },
      async delete() {
        throw err;
      },
    } as unknown as MemoryStore;
    return new SolidMemoryAdapter({ memoryStore: stub });
  }

  it("DROPS a WRAPPED RdfFetchError (cause chain), so list/get survive", async () => {
    const rdfErr = new Error(
      "Failed to parse text/turtle body at https://alice.pod/agent/memories/m1.",
    );
    rdfErr.name = "RdfFetchError";
    const wrapped = new Error("reading member failed", { cause: rdfErr });
    const adapter = adapterWhoseGetThrows(wrapped);
    // The wrapped parse error is recognised and dropped: list() does not throw.
    expect(await adapter.list()).toEqual([]);
    // get() of that resource collapses to null (drop-not-fatal), never a crash.
    expect(await adapter.get(`${CONTAINER}m1`)).toBeNull();
  });

  it("RE-THROWS a wrapped GENUINE network error (no parse link anywhere in the chain)", async () => {
    const netErr = new Error("getaddrinfo ENOTFOUND alice.pod");
    netErr.name = "FetchError";
    const wrapped = new Error("request failed", { cause: netErr });
    const adapter = adapterWhoseGetThrows(wrapped);
    // No parse-typed link in the chain → the outage is surfaced, not swallowed.
    await expect(adapter.list()).rejects.toThrow();
    await expect(adapter.get(`${CONTAINER}m1`)).rejects.toThrow();
  });

  it("does NOT broad-match a network error that merely contains the word 'syntax'", async () => {
    // A network/server error whose message coincidentally contains "syntax" must
    // NOT be misclassified as a parse error (the Finding-2 regression guard).
    const sneaky = new Error("upstream 500: gateway syntax check service unavailable");
    sneaky.name = "FetchError";
    const adapter = adapterWhoseGetThrows(sneaky);
    await expect(adapter.list()).rejects.toThrow();
  });

  it("RE-THROWS a 5xx whose statusText contains 'Failed to parse' (roborev Medium)", async () => {
    // MemoryStore.get folds HTTP statusText into the error message, so a real outage
    // like `503 Failed to parse upstream response` MUST be re-thrown — it is NOT an
    // RdfFetchError. A bare `msg.includes("Failed to parse")` (the bug) would have
    // mis-dropped it; matching the typed name only is the fix.
    const serverErr = new Error("503 Failed to parse upstream response");
    serverErr.name = "FetchError";
    const adapter = adapterWhoseGetThrows(serverErr);
    await expect(adapter.list()).rejects.toThrow();
    await expect(adapter.get(`${CONTAINER}m1`)).rejects.toThrow();
  });
});
