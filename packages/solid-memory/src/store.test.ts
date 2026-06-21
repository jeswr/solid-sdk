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

  it("created-preservation is best-effort: a write-only caller updates with opts.assumeNotForgotten", async () => {
    // A pod where GET is forbidden (403) but PUT succeeds — a write-only caller.
    // The created pre-read is best-effort; opts.assumeNotForgotten is the explicit escape
    // hatch that satisfies the FAIL-CLOSED tombstone guard, so the PUT proceeds.
    const written = new Map<string, string>();
    const writeOnly: typeof globalThis.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "GET") return new Response(null, { status: 403 });
      if (method === "PUT") {
        written.set(url, typeof init?.body === "string" ? init.body : "");
        return new Response(null, { status: 205, headers: { etag: '"e"' } });
      }
      return new Response(null, { status: 405 });
    };
    const s = new MemoryStore({ container: CONTAINER, fetch: writeOnly });
    const url = `${CONTAINER}x`;
    const res = await s.update(url, { text: "v2" }, { assumeNotForgotten: true });
    expect(res.etag).toBe('"e"');
    expect(written.has(url)).toBe(true);
    // The written body carries no tombstone (assumed live).
    expect(written.get(url)).not.toContain("invalidatedAtTime");
  });

  it("a setting invalidatedAt explicitly (a Date) lets a write-only caller update without a read", async () => {
    // The other escape hatch: passing invalidatedAt as a Date resolves the tombstone
    // without a read (the caller is authoritative), so a read-denied PUT proceeds.
    const written = new Map<string, string>();
    const writeOnly: typeof globalThis.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "GET") return new Response(null, { status: 403 });
      if (method === "PUT") {
        written.set(url, typeof init?.body === "string" ? init.body : "");
        return new Response(null, { status: 205, headers: { etag: '"e"' } });
      }
      return new Response(null, { status: 405 });
    };
    const s = new MemoryStore({ container: CONTAINER, fetch: writeOnly });
    const url = `${CONTAINER}x`;
    const at = new Date("2023-03-03T00:00:00.000Z");
    const res = await s.update(url, { text: "v2", invalidatedAt: at });
    expect(res.etag).toBe('"e"');
    expect(written.get(url)).toContain("invalidatedAtTime");
  });

  it("FAIL-CLOSED: a routine update REFUSES when the tombstone pre-read fails (read-denied)", async () => {
    // Regression for the resurrection risk: if the caller omits invalidatedAt and the
    // existence/tombstone read FAILS (403), update must throw — never silently drop a
    // possibly-present prov:invalidatedAtTime tombstone (right-to-be-forgotten).
    let putAttempted = false;
    const readDenied: typeof globalThis.fetch = async (_input, init) => {
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "GET") return new Response(null, { status: 403 });
      if (method === "PUT") {
        putAttempted = true;
        return new Response(null, { status: 205, headers: { etag: '"e"' } });
      }
      return new Response(null, { status: 405 });
    };
    const s = new MemoryStore({ container: CONTAINER, fetch: readDenied });
    await expect(s.update(`${CONTAINER}x`, { text: "v2" })).rejects.toThrow(/fail-closed/);
    // And it must NOT have issued the PUT.
    expect(putAttempted).toBe(false);
  });

  it("the best-effort pre-read tolerates a missing (404) resource without throwing", async () => {
    const { fetchImpl } = makePod();
    const s = new MemoryStore({ container: CONTAINER, fetch: fetchImpl });
    const url = `${CONTAINER}never-created`;
    // get() returns null (404); update must still PUT (created defaults to now).
    await expect(s.update(url, { text: "fresh" })).resolves.toBeDefined();
    const got = await s.get(url);
    expect(got?.data.text).toBe("fresh");
    expect(got?.data.created).toBeInstanceOf(Date);
  });

  it("an ordinary update does NOT resurrect a forgotten memory (invalidatedAt is sticky)", async () => {
    // Regression: a routine full-resource update that omits invalidatedAt must carry
    // the existing tombstone forward — never silently un-forget + make it searchable.
    const { fetchImpl } = makePod();
    const s = new MemoryStore({ container: CONTAINER, fetch: fetchImpl });
    const { url } = await s.create({ text: "v1" });
    const { invalidatedAt } = await s.forget(url, { at: new Date("2021-01-01T00:00:00.000Z") });
    // Edit the body via update, omitting invalidatedAt.
    await s.update(url, { text: "v2 edited" });
    const got = await s.get(url);
    expect(got?.data.text).toBe("v2 edited");
    // The tombstone survives — same time, still forgotten.
    expect(got?.data.invalidatedAt?.toISOString()).toBe(invalidatedAt.toISOString());
    // And it stays excluded from the default search.
    expect((await s.search({})).map((m) => m.text)).toEqual([]);
    expect((await s.search({ includeForgotten: true })).map((m) => m.text)).toEqual(["v2 edited"]);
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

describe("forget (soft-delete / prov:invalidatedAtTime tombstone)", () => {
  it("writes a tombstone, KEEPS the resource, and preserves the body + created", async () => {
    const { store, fetchImpl } = makePod();
    const s = new MemoryStore({ container: CONTAINER, fetch: fetchImpl });
    const created = new Date("2020-01-02T03:04:05.000Z");
    const { url } = await s.create({ text: "remember me", keywords: ["k"], created });
    const before = Date.now();
    const res = await s.forget(url);
    expect(res.invalidatedAt).toBeInstanceOf(Date);
    expect(res.invalidatedAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
    // The resource still exists (soft, not hard, delete).
    expect(store.has(url)).toBe(true);
    const got = await s.get(url);
    expect(got).not.toBeNull();
    expect(got?.data.text).toBe("remember me");
    expect(new Set(got?.data.keywords)).toEqual(new Set(["k"]));
    expect(got?.data.created?.toISOString()).toBe(created.toISOString());
    expect(got?.data.invalidatedAt?.toISOString()).toBe(res.invalidatedAt.toISOString());
  });

  it("excludes a forgotten memory from search() by default, surfaces it with includeForgotten", async () => {
    const { fetchImpl } = makePod();
    const s = new MemoryStore({ container: CONTAINER, fetch: fetchImpl });
    const { url } = await s.create({ text: "secret to forget" });
    await s.create({ text: "keep this one" });
    await s.forget(url);
    // Default search omits the tombstoned memory.
    const visible = await s.search({});
    expect(visible.map((m) => m.text)).toEqual(["keep this one"]);
    // all() still returns it (audit), and includeForgotten surfaces it in search.
    expect((await s.all()).length).toBe(2);
    const withForgotten = await s.search({ includeForgotten: true });
    expect(withForgotten.map((m) => m.text).sort()).toEqual(["keep this one", "secret to forget"]);
  });

  it("uses a caller-supplied tombstone time when given", async () => {
    const { fetchImpl } = makePod();
    const s = new MemoryStore({ container: CONTAINER, fetch: fetchImpl });
    const { url } = await s.create({ text: "x" });
    const at = new Date("2021-07-08T00:00:00.000Z");
    const res = await s.forget(url, { at });
    expect(res.invalidatedAt.toISOString()).toBe(at.toISOString());
    const got = await s.get(url);
    expect(got?.data.invalidatedAt?.toISOString()).toBe(at.toISOString());
  });

  it("is idempotent — re-forgetting keeps the ORIGINAL tombstone time", async () => {
    const { fetchImpl } = makePod();
    const s = new MemoryStore({ container: CONTAINER, fetch: fetchImpl });
    const { url } = await s.create({ text: "x" });
    const first = await s.forget(url, { at: new Date("2021-01-01T00:00:00.000Z") });
    const second = await s.forget(url); // no `at` → must keep the original
    expect(second.invalidatedAt.toISOString()).toBe(first.invalidatedAt.toISOString());
    const got = await s.get(url);
    expect(got?.data.invalidatedAt?.toISOString()).toBe(first.invalidatedAt.toISOString());
  });

  it("an explicit `at` overrides a prior tombstone (caller is authoritative)", async () => {
    const { fetchImpl } = makePod();
    const s = new MemoryStore({ container: CONTAINER, fetch: fetchImpl });
    const { url } = await s.create({ text: "x" });
    await s.forget(url, { at: new Date("2021-01-01T00:00:00.000Z") });
    const override = new Date("2022-02-02T00:00:00.000Z");
    const res = await s.forget(url, { at: override });
    expect(res.invalidatedAt.toISOString()).toBe(override.toISOString());
  });

  it("throws for a missing resource (use delete() for a hard remove)", async () => {
    const { fetchImpl } = makePod();
    const s = new MemoryStore({ container: CONTAINER, fetch: fetchImpl });
    await expect(s.forget(`${CONTAINER}never`)).rejects.toThrow(/no mem:MemoryItem to forget/);
  });

  it("throws for a non-memory resource", async () => {
    const { store, fetchImpl } = makePod();
    const url = `${CONTAINER}other`;
    store.set(url, { body: `<${url}#it> <http://schema.org/text> "x" .`, etag: '"e"' });
    const s = new MemoryStore({ container: CONTAINER, fetch: fetchImpl });
    await expect(s.forget(url)).rejects.toThrow(/no mem:MemoryItem to forget/);
  });

  it("refuses an out-of-scope target with no network request", async () => {
    let called = false;
    const counting: typeof globalThis.fetch = async (...args) => {
      called = true;
      const { fetchImpl } = makePod();
      return fetchImpl(...args);
    };
    const s = new MemoryStore({ container: CONTAINER, fetch: counting });
    await expect(s.forget("https://evil.example/x")).rejects.toThrow(/escapes container/);
    expect(called).toBe(false);
  });

  it("guards concurrency by default — a stale resource between read+PUT surfaces as 412", async () => {
    // forget defaults If-Match to the etag it just read; a writer that bumps the
    // stored etag before our PUT lands must trigger a 412 (we never silently clobber).
    const { fetchImpl, store } = makePod();
    const s = new MemoryStore({ container: CONTAINER, fetch: fetchImpl });
    const { url } = await s.create({ text: "x" });
    let sawGet = false;
    const racingFetch: typeof globalThis.fetch = async (input, init) => {
      const method = (init?.method ?? "GET").toUpperCase();
      const u = typeof input === "string" ? input : input.toString();
      const res = await fetchImpl(input, init);
      if (method === "GET" && u === url && !sawGet) {
        sawGet = true;
        // Simulate a concurrent overwrite that changes the etag after our read.
        const entry = store.get(url);
        if (entry) store.set(url, { body: entry.body, etag: '"concurrently-bumped"' });
      }
      return res;
    };
    const racing = new MemoryStore({ container: CONTAINER, fetch: racingFetch });
    await expect(racing.forget(url)).rejects.toThrow(/412/);
  });

  it("a caller-supplied ifMatch overrides the auto-guard", async () => {
    const { fetchImpl } = makePod();
    const s = new MemoryStore({ container: CONTAINER, fetch: fetchImpl });
    const { url } = await s.create({ text: "x" });
    // A deliberately stale ifMatch is honoured (and fails), proving the override path.
    await expect(s.forget(url, { ifMatch: '"stale"' })).rejects.toThrow(/412/);
  });
});

describe("unforget (clear the tombstone — inverse of forget)", () => {
  it("clears prov:invalidatedAtTime and makes the memory live + searchable again", async () => {
    const { fetchImpl } = makePod();
    const s = new MemoryStore({ container: CONTAINER, fetch: fetchImpl });
    const created = new Date("2020-05-05T00:00:00.000Z");
    const { url } = await s.create({ text: "remember again", keywords: ["k"], created });
    await s.forget(url);
    expect((await s.get(url))?.data.invalidatedAt).toBeInstanceOf(Date);
    await s.unforget(url);
    const got = await s.get(url);
    expect(got?.data.invalidatedAt).toBeUndefined();
    // The rest of the data is preserved, and created is unchanged.
    expect(got?.data.text).toBe("remember again");
    expect(new Set(got?.data.keywords)).toEqual(new Set(["k"]));
    expect(got?.data.created?.toISOString()).toBe(created.toISOString());
    // Visible in the default search once more.
    expect((await s.search({})).map((m) => m.text)).toEqual(["remember again"]);
  });

  it("is idempotent on an already-live memory (no-op rewrite, no tombstone introduced)", async () => {
    const { fetchImpl } = makePod();
    const s = new MemoryStore({ container: CONTAINER, fetch: fetchImpl });
    const { url } = await s.create({ text: "never forgotten" });
    await expect(s.unforget(url)).resolves.toBeDefined();
    expect((await s.get(url))?.data.invalidatedAt).toBeUndefined();
  });

  it("throws for a missing / non-memory resource", async () => {
    const { store, fetchImpl } = makePod();
    const s = new MemoryStore({ container: CONTAINER, fetch: fetchImpl });
    await expect(s.unforget(`${CONTAINER}never`)).rejects.toThrow(/no mem:MemoryItem to un-forget/);
    const other = `${CONTAINER}other`;
    store.set(other, { body: `<${other}#it> <http://schema.org/text> "x" .`, etag: '"e"' });
    await expect(s.unforget(other)).rejects.toThrow(/no mem:MemoryItem to un-forget/);
  });

  it("refuses an out-of-scope target with no network request", async () => {
    let called = false;
    const counting: typeof globalThis.fetch = async (...args) => {
      called = true;
      const { fetchImpl } = makePod();
      return fetchImpl(...args);
    };
    const s = new MemoryStore({ container: CONTAINER, fetch: counting });
    await expect(s.unforget("https://evil.example/x")).rejects.toThrow(/escapes container/);
    expect(called).toBe(false);
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

describe("scope guard rejects the container ROOT as a resource CRUD target", () => {
  // Defence-in-depth footgun: assertWithinBase(container, container) used to pass
  // (the root path trivially prefixes itself), so a caller bug that passed the
  // store's OWN container root to a resource CRUD method would PUT/DELETE/GET the
  // container document itself. The root is NOT a managed mem:MemoryItem resource;
  // every resource-CRUD op must REFUSE it AND issue no network request.
  // (These tests FAIL against the pre-guard code, where the root slipped through.)
  // Forms that resolve to the container root itself (same origin + same path,
  // ignoring query/fragment) — these must trip the explicit container-root guard.
  const exactRootForms = [
    CONTAINER, // exact normalised root
    "https://alice.pod/memories/?x=1", // root with a query
    "https://alice.pod/memories/#frag", // root with a fragment
  ];

  for (const root of exactRootForms) {
    it(`get/update/delete/forget/unforget refuse the root form ${root} with no network request`, async () => {
      let called = false;
      const counting: typeof globalThis.fetch = async (...args) => {
        called = true;
        const { fetchImpl } = makePod();
        return fetchImpl(...args);
      };
      const s = new MemoryStore({ container: CONTAINER, fetch: counting });
      await expect(s.get(root)).rejects.toThrow(/container root/);
      await expect(s.update(root, { text: "x" })).rejects.toThrow(/container root/);
      await expect(s.delete(root)).rejects.toThrow(/container root/);
      await expect(s.forget(root)).rejects.toThrow(/container root/);
      await expect(s.unforget(root)).rejects.toThrow(/container root/);
      // The decisive assertion: the guard tripped BEFORE any request reached the pod.
      expect(called).toBe(false);
    });
  }

  it("refuses the slash-less container path with no network request (escapes-path guard)", async () => {
    // The non-trailing-slash form `.../memories` is not the normalised root path
    // `.../memories/`, so it is caught by the existing escapes-path check — still
    // refused, still no request (a different message, but the same fail-closed result).
    let called = false;
    const counting: typeof globalThis.fetch = async (...args) => {
      called = true;
      const { fetchImpl } = makePod();
      return fetchImpl(...args);
    };
    const s = new MemoryStore({ container: CONTAINER, fetch: counting });
    const slashless = "https://alice.pod/memories";
    await expect(s.get(slashless)).rejects.toThrow(/escapes container path/);
    await expect(s.delete(slashless)).rejects.toThrow(/escapes container path/);
    expect(called).toBe(false);
  });

  it("rejects the store's OWN container property passed straight back in", async () => {
    // The most direct expression of the bug: store.delete(store.container).
    let called = false;
    const counting: typeof globalThis.fetch = async (...args) => {
      called = true;
      const { fetchImpl } = makePod();
      return fetchImpl(...args);
    };
    const s = new MemoryStore({ container: CONTAINER, fetch: counting });
    await expect(s.delete(s.container)).rejects.toThrow(/container root/);
    await expect(s.update(s.container, { text: "x" })).rejects.toThrow(/container root/);
    await expect(s.get(s.container)).rejects.toThrow(/container root/);
    expect(called).toBe(false);
  });

  it("still lists the container (the root read path is unaffected by the CRUD root-guard)", async () => {
    // Regression guard: rejecting the root for CRUD must NOT break list(), whose
    // legitimate root read does not go through the resource scope guard.
    const { fetchImpl } = makePod();
    const s = new MemoryStore({ container: CONTAINER, fetch: fetchImpl });
    const a = await s.create({ text: "a" });
    const members = (await s.list()).map((m) => m.url);
    expect(members).toEqual([a.url]);
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
