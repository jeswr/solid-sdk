// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { MemoryData } from "./memory.js";
import { serializeMemory } from "./memory.js";
import { MemoryStore } from "./store.js";

const CONTAINER = "https://alice.pod/memories/";

/**
 * A fake pod: an in-memory `Map<url, {body, etag}>` served by a mock `fetch` that
 * honours `If-None-Match: *` (412 if exists), `If-Match: <etag>` (412 on
 * mismatch), GET/PUT/DELETE, ETag bumping on write, 404 for missing, and a
 * container LISTING (ldp:contains) for the container URL.
 */
function makePod() {
  const store = new Map<string, { body: string; etag: string }>();
  let etagSeq = 0;
  const nextEtag = () => `"etag-${++etagSeq}"`;

  const fetchImpl: typeof globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = (init?.method ?? "GET").toUpperCase();
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
      // Conditional create: If-None-Match: * fails (412) if the resource exists.
      if (headers.get("if-none-match") === "*" && existing) {
        return new Response(null, { status: 412 });
      }
      // Conditional update: If-Match must equal the current etag.
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

  return { store, fetchImpl };
}

describe("browser-safety", () => {
  it("does not import any node: module (usable in a browser Solid client)", () => {
    const src = readFileSync(fileURLToPath(new URL("./store.ts", import.meta.url)), "utf8");
    // crypto.randomUUID() is the WHATWG Web Crypto global, present in Node >=20 and
    // every browser; a `node:` import would break a browser bundle.
    expect(src).not.toMatch(/from\s+["']node:/);
    expect(src).toContain("crypto.randomUUID()");
  });
});

describe("MemoryStore constructor", () => {
  it("rejects a non-http(s) container", () => {
    const { fetchImpl } = makePod();
    expect(() => new MemoryStore({ container: "ftp://x/", fetch: fetchImpl })).toThrow();
    expect(() => new MemoryStore({ container: "not a url", fetch: fetchImpl })).toThrow();
  });

  it("normalizes a missing trailing slash", () => {
    const { fetchImpl } = makePod();
    const s = new MemoryStore({ container: "https://alice.pod/memories", fetch: fetchImpl });
    expect(s.container).toBe(CONTAINER);
  });

  it("strips query + fragment from the container", () => {
    const { fetchImpl } = makePod();
    const s = new MemoryStore({ container: "https://alice.pod/memories/?x=1#y", fetch: fetchImpl });
    expect(s.container).toBe(CONTAINER);
  });
});

describe("create", () => {
  it("mints a URL under the container, sets If-None-Match: *, returns url + etag", async () => {
    const { store, fetchImpl } = makePod();
    let sawIfNoneMatch = false;
    const spyFetch: typeof globalThis.fetch = (input, init) => {
      const h = new Headers(init?.headers ?? {});
      if ((init?.method ?? "GET").toUpperCase() === "PUT" && h.get("if-none-match") === "*") {
        sawIfNoneMatch = true;
      }
      return fetchImpl(input, init);
    };
    const s = new MemoryStore({ container: CONTAINER, fetch: spyFetch });
    const { url, etag } = await s.create({ text: "hello" });
    expect(url.startsWith(CONTAINER)).toBe(true);
    expect(sawIfNoneMatch).toBe(true);
    expect(etag).toBeDefined();
    expect(store.has(url)).toBe(true);
  });

  it("surfaces a 412 collision as a thrown error", async () => {
    const { fetchImpl } = makePod();
    // A fetch that always reports the resource as existing → 412 on If-None-Match: *.
    const collidingFetch: typeof globalThis.fetch = async (input, init) => {
      if ((init?.method ?? "GET").toUpperCase() === "PUT") {
        return new Response(null, { status: 412 });
      }
      return fetchImpl(input, init);
    };
    const s = new MemoryStore({ container: CONTAINER, fetch: collidingFetch });
    await expect(s.create({ text: "x" })).rejects.toThrow(/412/);
  });
});

describe("get", () => {
  it("round-trips a stored memory", async () => {
    const { store, fetchImpl } = makePod();
    const url = `${CONTAINER}m1`;
    store.set(url, { body: await serializeMemory(url, { text: "stored" }), etag: '"e1"' });
    const s = new MemoryStore({ container: CONTAINER, fetch: fetchImpl });
    const got = await s.get(url);
    expect(got?.data.text).toBe("stored");
    expect(got?.etag).toBe('"e1"');
  });

  it("returns null for a missing resource (404)", async () => {
    const { fetchImpl } = makePod();
    const s = new MemoryStore({ container: CONTAINER, fetch: fetchImpl });
    expect(await s.get(`${CONTAINER}nope`)).toBeNull();
  });

  it("returns null for a non-memory resource", async () => {
    const { store, fetchImpl } = makePod();
    const url = `${CONTAINER}other`;
    store.set(url, { body: `<${url}#it> <http://schema.org/text> "x" .`, etag: '"e"' });
    const s = new MemoryStore({ container: CONTAINER, fetch: fetchImpl });
    expect(await s.get(url)).toBeNull();
  });
});

describe("update", () => {
  it("bumps dct:modified and persists", async () => {
    const { store, fetchImpl } = makePod();
    const s = new MemoryStore({ container: CONTAINER, fetch: fetchImpl });
    const { url } = await s.create({ text: "v1" });
    await s.update(url, { text: "v2" });
    const got = await s.get(url);
    expect(got?.data.text).toBe("v2");
    expect(got?.data.modified).toBeInstanceOf(Date);
    expect(store.get(url)).toBeDefined();
  });

  it("fails with a stale If-Match (412 → thrown)", async () => {
    const { fetchImpl } = makePod();
    const s = new MemoryStore({ container: CONTAINER, fetch: fetchImpl });
    const { url } = await s.create({ text: "v1" });
    await expect(s.update(url, { text: "v2" }, { ifMatch: '"stale-etag"' })).rejects.toThrow(/412/);
  });

  it("succeeds with a fresh If-Match", async () => {
    const { fetchImpl } = makePod();
    const s = new MemoryStore({ container: CONTAINER, fetch: fetchImpl });
    const { url, etag } = await s.create({ text: "v1" });
    const res = await s.update(url, { text: "v2" }, { ifMatch: etag });
    expect(res.etag).toBeDefined();
  });

  it("preserves the original dct:created when the caller omits it", async () => {
    const { fetchImpl } = makePod();
    const s = new MemoryStore({ container: CONTAINER, fetch: fetchImpl });
    const created = new Date("2020-01-02T03:04:05.000Z");
    const { url } = await s.create({ text: "v1", created });
    await s.update(url, { text: "v2" }); // no `created` supplied
    const got = await s.get(url);
    expect(got?.data.created?.toISOString()).toBe(created.toISOString());
    // modified moved forward; created did not.
    expect(got?.data.modified?.getTime()).toBeGreaterThan(created.getTime());
  });

  it("an explicit created on update wins (caller is authoritative)", async () => {
    const { fetchImpl } = makePod();
    const s = new MemoryStore({ container: CONTAINER, fetch: fetchImpl });
    const { url } = await s.create({ text: "v1", created: new Date("2020-01-01T00:00:00.000Z") });
    const newCreated = new Date("2021-06-06T00:00:00.000Z");
    await s.update(url, { text: "v2", created: newCreated });
    const got = await s.get(url);
    expect(got?.data.created?.toISOString()).toBe(newCreated.toISOString());
  });
});

describe("delete", () => {
  it("removes the resource", async () => {
    const { store, fetchImpl } = makePod();
    const s = new MemoryStore({ container: CONTAINER, fetch: fetchImpl });
    const { url } = await s.create({ text: "x" });
    await s.delete(url);
    expect(store.has(url)).toBe(false);
  });

  it("fails with a stale If-Match (412 → thrown)", async () => {
    const { fetchImpl } = makePod();
    const s = new MemoryStore({ container: CONTAINER, fetch: fetchImpl });
    const { url } = await s.create({ text: "x" });
    await expect(s.delete(url, { ifMatch: '"stale"' })).rejects.toThrow(/412/);
  });
});

describe("list + all", () => {
  it("list returns the container members", async () => {
    const { fetchImpl } = makePod();
    const s = new MemoryStore({ container: CONTAINER, fetch: fetchImpl });
    const a = await s.create({ text: "a" });
    const b = await s.create({ text: "b" });
    const members = (await s.list()).map((m) => m.url).sort();
    expect(members).toEqual([a.url, b.url].sort());
  });

  it("list returns [] for a missing container (404)", async () => {
    const notFound: typeof globalThis.fetch = async () => new Response(null, { status: 404 });
    const s = new MemoryStore({ container: CONTAINER, fetch: notFound });
    expect(await s.list()).toEqual([]);
  });

  it("all() returns parsed memories and skips non-memory members", async () => {
    const { store, fetchImpl } = makePod();
    const s = new MemoryStore({ container: CONTAINER, fetch: fetchImpl });
    await s.create({ text: "real memory" });
    // A non-memory resource also in the container.
    const other = `${CONTAINER}other`;
    store.set(other, { body: `<${other}#it> <http://schema.org/text> "x" .`, etag: '"e"' });
    const all = await s.all();
    expect(all.map((x) => x.data.text)).toEqual(["real memory"]);
  });

  it("list skips a foreign-origin member injected by a hostile listing", async () => {
    // A listing that contains a foreign-origin member URL.
    const evil: typeof globalThis.fetch = async (input) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === CONTAINER) {
        const body = `@prefix ldp: <http://www.w3.org/ns/ldp#> .
<${CONTAINER}> a ldp:Container ;
  ldp:contains <${CONTAINER}ok>, <https://evil.example/steal> .`;
        return new Response(body, { status: 200, headers: { "content-type": "text/turtle" } });
      }
      return new Response(null, { status: 404 });
    };
    const s = new MemoryStore({ container: CONTAINER, fetch: evil });
    const members = (await s.list()).map((m) => m.url);
    expect(members).toEqual([`${CONTAINER}ok`]);
    expect(members.some((u) => u.includes("evil.example"))).toBe(false);
  });
});

describe("scope guard rejects foreign URLs on every op", () => {
  const cases = ["https://evil.example/x", "https://alice.pod/other/x", "https://alice.pod/x"];
  for (const foreign of cases) {
    it(`get/update/delete refuse ${foreign}`, async () => {
      const { fetchImpl } = makePod();
      const s = new MemoryStore({ container: CONTAINER, fetch: fetchImpl });
      await expect(s.get(foreign)).rejects.toThrow(/escapes container/);
      await expect(s.update(foreign, { text: "x" })).rejects.toThrow(/escapes container/);
      await expect(s.delete(foreign)).rejects.toThrow(/escapes container/);
    });
  }

  it("does not issue a network request for an out-of-scope target", async () => {
    let called = false;
    const counting: typeof globalThis.fetch = async (...args) => {
      called = true;
      const { fetchImpl } = makePod();
      return fetchImpl(...args);
    };
    const s = new MemoryStore({ container: CONTAINER, fetch: counting });
    await expect(s.get("https://evil.example/x")).rejects.toThrow();
    expect(called).toBe(false);
  });
});

describe("type-index registration", () => {
  it("typeIndexRegistration returns the descriptor", () => {
    const { fetchImpl } = makePod();
    const s = new MemoryStore({ container: CONTAINER, fetch: fetchImpl });
    expect(s.typeIndexRegistration()).toEqual({
      forClass: "https://w3id.org/jeswr/memory#MemoryItem",
      instanceContainer: CONTAINER,
    });
  });

  it("buildTypeRegistration / serialize writes the 3 solid: triples", async () => {
    const { fetchImpl } = makePod();
    const s = new MemoryStore({ container: CONTAINER, fetch: fetchImpl });
    const ttl = await s.serializeTypeRegistration();
    expect(ttl).toContain("solid:TypeRegistration");
    expect(ttl).toContain("solid:forClass");
    expect(ttl).toContain("solid:instanceContainer");
    expect(ttl).toContain("mem:MemoryItem");
    // The graph has exactly the registration triples (type + forClass + instanceContainer).
    expect([...s.buildTypeRegistration()]).toHaveLength(3);
  });
});

describe("search convenience", () => {
  it("all() + searchMemories filter", async () => {
    const { fetchImpl } = makePod();
    const s = new MemoryStore({ container: CONTAINER, fetch: fetchImpl });
    await s.create({ text: "remember dark mode", keywords: ["ui"] });
    await s.create({ text: "remember sydney", keywords: ["geo"] });
    const out = await s.search({ text: "dark" });
    expect(out.map((m: MemoryData) => m.text)).toEqual(["remember dark mode"]);
  });
});
