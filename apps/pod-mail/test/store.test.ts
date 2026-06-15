// AUTHORED-BY Claude Opus 4.8
import { RdfFetchError } from "@jeswr/fetch-rdf";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MailAccessError,
  MailConflictError,
  MailNotFoundError,
  MailStore,
  mapFetchError,
} from "../src/model/store.js";

const URL_INBOX = "https://pod.example/mail/folders/inbox.ttl";
const M1 = "https://pod.example/mail/messages/m1.ttl#it";

const TURTLE = `
  @prefix schema: <http://schema.org/> .
  @prefix dct: <http://purl.org/dc/terms/> .
  <#it> a schema:Collection ;
    dct:title "Inbox" ;
    schema:hasPart <${M1}> .
`;

/** Build a fetch stub that returns a fixed Response for a GET. */
function rdfResponse(body: string, init: ResponseInit & { etag?: string } = {}): Response {
  const headers = new Headers({ "content-type": "text/turtle" });
  if (init.etag) headers.set("etag", init.etag);
  return new Response(body, { status: init.status ?? 200, headers });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("MailStore.load", () => {
  it("loads and wraps a mail document, carrying the ETag and final URL", async () => {
    const fetchStub = vi.fn(async () => rdfResponse(TURTLE, { etag: '"v1"' }));
    const store = new MailStore({ fetch: fetchStub as unknown as typeof fetch });
    const loaded = await store.load(URL_INBOX);
    expect(loaded.etag).toBe('"v1"');
    expect(loaded.url).toBe(URL_INBOX);
    const f = loaded.mailbox.findFolder(`${URL_INBOX}#it`);
    expect(f?.title).toBe("Inbox");
  });

  it("maps 404 to MailNotFoundError", async () => {
    const fetchStub = vi.fn(async () => new Response("nope", { status: 404 }));
    const store = new MailStore({ fetch: fetchStub as unknown as typeof fetch });
    await expect(store.load(URL_INBOX)).rejects.toBeInstanceOf(MailNotFoundError);
  });

  it("maps 401 and 403 to MailAccessError with the status", async () => {
    for (const status of [401, 403]) {
      const fetchStub = vi.fn(async () => new Response("no", { status }));
      const store = new MailStore({ fetch: fetchStub as unknown as typeof fetch });
      const err = await store.load(URL_INBOX).catch((e) => e);
      expect(err).toBeInstanceOf(MailAccessError);
      expect((err as MailAccessError).status).toBe(status);
    }
  });

  it("propagates an unexpected (500) error rather than masking it", async () => {
    const fetchStub = vi.fn(async () => new Response("boom", { status: 500 }));
    const store = new MailStore({ fetch: fetchStub as unknown as typeof fetch });
    const err = await store.load(URL_INBOX).catch((e) => e);
    expect(err).not.toBeInstanceOf(MailNotFoundError);
    expect(err).not.toBeInstanceOf(MailAccessError);
    expect(err).toBeInstanceOf(Error);
  });

  it("falls back to globalThis.fetch when no fetch is supplied", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => rdfResponse(TURTLE, { etag: '"g"' })),
    );
    const store = new MailStore();
    const loaded = await store.load(URL_INBOX);
    expect(loaded.etag).toBe('"g"');
  });
});

describe("MailStore.loadOrEmpty", () => {
  it("returns an empty mailbox (no ETag) on 404", async () => {
    const fetchStub = vi.fn(async () => new Response("nope", { status: 404 }));
    const store = new MailStore({ fetch: fetchStub as unknown as typeof fetch });
    const loaded = await store.loadOrEmpty(URL_INBOX);
    expect(loaded.etag).toBeNull();
    expect([...loaded.mailbox.folders]).toHaveLength(0);
    expect(loaded.url).toBe(URL_INBOX);
  });

  it("returns the loaded document when it exists", async () => {
    const fetchStub = vi.fn(async () => rdfResponse(TURTLE, { etag: '"v1"' }));
    const store = new MailStore({ fetch: fetchStub as unknown as typeof fetch });
    const loaded = await store.loadOrEmpty(URL_INBOX);
    expect(loaded.etag).toBe('"v1"');
  });

  it("re-throws a non-404 error (e.g. access denied)", async () => {
    const fetchStub = vi.fn(async () => new Response("no", { status: 403 }));
    const store = new MailStore({ fetch: fetchStub as unknown as typeof fetch });
    await expect(store.loadOrEmpty(URL_INBOX)).rejects.toBeInstanceOf(MailAccessError);
  });
});

describe("MailStore.save", () => {
  it("conditional-PUTs with If-Match when an ETag is known", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchStub = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(null, { status: 205 });
    });
    const store = new MailStore({ fetch: fetchStub as unknown as typeof fetch });
    const loaded = await new MailStore({
      fetch: (async () => rdfResponse(TURTLE, { etag: '"v1"' })) as unknown as typeof fetch,
    }).load(URL_INBOX);
    await store.save(loaded);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.init.method).toBe("PUT");
    const headers = new Headers(calls[0]?.init.headers);
    expect(headers.get("if-match")).toBe('"v1"');
    expect(headers.get("content-type")).toBe("text/turtle");
    expect(headers.get("if-none-match")).toBeNull();
  });

  it("uses If-None-Match: * (create-only) when there is no ETag", async () => {
    const calls: { init: RequestInit }[] = [];
    const fetchStub = vi.fn(async (_url: string, init: RequestInit) => {
      calls.push({ init });
      return new Response(null, { status: 201 });
    });
    const store = new MailStore({ fetch: fetchStub as unknown as typeof fetch });
    const empty = await new MailStore({
      fetch: (async () => new Response("nope", { status: 404 })) as unknown as typeof fetch,
    }).loadOrEmpty(URL_INBOX);
    empty.mailbox.createFolder(`${URL_INBOX}#it`).title = "Inbox";
    await store.save(empty);
    const headers = new Headers(calls[0]?.init.headers);
    expect(headers.get("if-none-match")).toBe("*");
    expect(headers.get("if-match")).toBeNull();
  });

  it("maps 412 to MailConflictError", async () => {
    const store = new MailStore({
      fetch: (async () => new Response(null, { status: 412 })) as unknown as typeof fetch,
    });
    const loaded = await new MailStore({
      fetch: (async () => rdfResponse(TURTLE, { etag: '"v1"' })) as unknown as typeof fetch,
    }).load(URL_INBOX);
    await expect(store.save(loaded)).rejects.toBeInstanceOf(MailConflictError);
  });

  it("maps 401/403 on write to MailAccessError", async () => {
    for (const status of [401, 403]) {
      const store = new MailStore({
        fetch: (async () => new Response(null, { status })) as unknown as typeof fetch,
      });
      const loaded = await new MailStore({
        fetch: (async () => rdfResponse(TURTLE, { etag: '"v1"' })) as unknown as typeof fetch,
      }).load(URL_INBOX);
      await expect(store.save(loaded)).rejects.toBeInstanceOf(MailAccessError);
    }
  });

  it("throws a generic error on other non-OK write status", async () => {
    const store = new MailStore({
      fetch: (async () => new Response(null, { status: 500 })) as unknown as typeof fetch,
    });
    const loaded = await new MailStore({
      fetch: (async () => rdfResponse(TURTLE, { etag: '"v1"' })) as unknown as typeof fetch,
    }).load(URL_INBOX);
    const err = await store.save(loaded).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(MailConflictError);
    expect(err).not.toBeInstanceOf(MailAccessError);
  });

  it("uses globalThis.fetch on save when none is supplied", async () => {
    const putSpy = vi.fn(async () => new Response(null, { status: 205 }));
    vi.stubGlobal("fetch", putSpy);
    const store = new MailStore();
    await store.save({ mailbox: (await freshEmpty()).mailbox, etag: '"v1"', url: URL_INBOX });
    expect(putSpy).toHaveBeenCalledOnce();
  });
});

describe("mapFetchError", () => {
  it("maps an RdfFetchError 404 / 401 / 403", () => {
    expect(
      mapFetchError(URL_INBOX, new RdfFetchError("x", { url: URL_INBOX, status: 404 })),
    ).toBeInstanceOf(MailNotFoundError);
    expect(
      mapFetchError(URL_INBOX, new RdfFetchError("x", { url: URL_INBOX, status: 401 })),
    ).toBeInstanceOf(MailAccessError);
    expect(
      mapFetchError(URL_INBOX, new RdfFetchError("x", { url: URL_INBOX, status: 403 })),
    ).toBeInstanceOf(MailAccessError);
  });

  it("passes through an RdfFetchError with an unmapped status (e.g. 500)", () => {
    const e = new RdfFetchError("x", { url: URL_INBOX, status: 500 });
    expect(mapFetchError(URL_INBOX, e)).toBe(e);
  });

  it("passes through a non-RdfFetchError unchanged", () => {
    const e = new TypeError("boom");
    expect(mapFetchError(URL_INBOX, e)).toBe(e);
  });
});

/** A fresh empty mailbox via loadOrEmpty's 404 path (no global stub needed). */
async function freshEmpty() {
  return new MailStore({
    fetch: (async () => new Response("nope", { status: 404 })) as unknown as typeof fetch,
  }).loadOrEmpty(URL_INBOX);
}
