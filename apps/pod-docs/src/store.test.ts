import { describe, expect, it } from "vitest";
import { OutOfScopeError } from "./errors.js";
import { createDocsStore, DOCS_SLUG, type DocsStore, nameFromUrl, toSlug } from "./store.js";
import { mockFetch, normaliseHeaders } from "./test-helpers.js";
import { DOCUMENT_CLASS } from "./vocab.js";

const WEBID = "https://alice.pod/profile/card#me";
const POD = "https://alice.pod/";
const CONTAINER = "https://alice.pod/pod-docs/";
const DOC = "https://alice.pod/pod-docs/note.ttl";

function store(fetchImpl?: typeof fetch): DocsStore {
  return createDocsStore({ podRoot: POD, webId: WEBID, fetchImpl });
}

describe("toSlug", () => {
  it("lower-cases, hyphenates and strips unsafe chars", () => {
    expect(toSlug("Hello, World! 2026")).toBe("hello-world-2026");
  });
  it("strips diacritics", () => {
    expect(toSlug("Café Déjà")).toBe("cafe-deja");
  });
  it("returns empty for undefined or all-unsafe input", () => {
    expect(toSlug(undefined)).toBe("");
    expect(toSlug("!!!")).toBe("");
  });
  it("never contains a colon and is capped in length", () => {
    const slug = toSlug("a".repeat(200));
    expect(slug).not.toContain(":");
    expect(slug.length).toBeLessThanOrEqual(48);
  });
});

describe("DocsStore basics", () => {
  it("exposes the container under the pod root", () => {
    expect(store().container).toBe(CONTAINER);
    expect(DOCS_SLUG).toBe("pod-docs/");
  });

  it("newDocumentUrl seeds a readable slug and a random suffix, with no colon", () => {
    const url = store().newDocumentUrl("My First Doc");
    expect(url.startsWith(`${CONTAINER}my-first-doc-`)).toBe(true);
    expect(url.endsWith(".ttl")).toBe(true);
    expect(url.slice(CONTAINER.length)).not.toContain(":");
  });

  it("newDocumentUrl falls back to a purely random name with no slug", () => {
    const url = store().newDocumentUrl("");
    expect(url.startsWith(CONTAINER)).toBe(true);
    expect(url.endsWith(".ttl")).toBe(true);
  });
});

describe("scope guard", () => {
  const s = store(mockFetch({}).fetch);

  it("rejects a different origin", async () => {
    await expect(s.read("https://evil.pod/pod-docs/note.ttl")).rejects.toBeInstanceOf(
      OutOfScopeError,
    );
  });
  it("rejects a path outside the container", async () => {
    await expect(s.read("https://alice.pod/other/note.ttl")).rejects.toBeInstanceOf(
      OutOfScopeError,
    );
  });
  it("rejects the container root itself", async () => {
    await expect(s.read(CONTAINER)).rejects.toBeInstanceOf(OutOfScopeError);
  });
  it("rejects a sub-container", async () => {
    await expect(s.read(`${CONTAINER}sub/inner.ttl`)).rejects.toBeInstanceOf(OutOfScopeError);
  });
  it("rejects an encoded slash", async () => {
    await expect(s.read(`${CONTAINER}a%2Fb`)).rejects.toBeInstanceOf(OutOfScopeError);
  });
  it("rejects a query or fragment", async () => {
    await expect(s.read(`${DOC}?x=1`)).rejects.toBeInstanceOf(OutOfScopeError);
    await expect(s.read(`${DOC}#frag`)).rejects.toBeInstanceOf(OutOfScopeError);
  });
  it("rejects an unparseable URL", async () => {
    await expect(s.read("::not a url")).rejects.toBeInstanceOf(OutOfScopeError);
  });
});

describe("read", () => {
  it("parses a document and returns its etag", async () => {
    const body = `
      @prefix pd: <https://w3id.org/jeswr/pod-docs#> .
      @prefix dct: <http://purl.org/dc/terms/> .
      <#it> a pd:Document ; dct:title "Read me" ; pd:body "hi" .
    `;
    const { fetch } = mockFetch({ [`GET ${DOC}`]: { body, etag: 'W/"d"' } });
    const result = await store(fetch).read(DOC);
    expect(result?.url).toBe(DOC);
    expect(result?.etag).toBe('W/"d"');
    expect(result?.data.title).toBe("Read me");
  });

  it("returns undefined when the resource is not a pd:Document", async () => {
    const { fetch } = mockFetch({
      [`GET ${DOC}`]: { body: `<#it> <http://purl.org/dc/terms/title> "x" .` },
    });
    await expect(store(fetch).read(DOC)).resolves.toBeUndefined();
  });

  it("propagates a 404 as an RdfFetchError", async () => {
    const { fetch } = mockFetch({});
    await expect(store(fetch).read(DOC)).rejects.toMatchObject({ status: 404 });
  });
});

describe("create", () => {
  it("registers the container then writes the document create-only", async () => {
    const PrivateIndex = "https://alice.pod/settings/privateTypeIndex.ttl";
    const { fetch, calls } = mockFetch({
      // type-index bootstrap path
      [`GET ${WEBID}`]: {
        body: `<${WEBID}> a <http://xmlns.com/foaf/0.1/Person> .`,
        etag: 'W/"p"',
      },
      [`PUT ${PrivateIndex}`]: { status: 201 },
      [`PUT ${WEBID.replace("#me", "")}`]: { status: 205 },
      [`GET ${PrivateIndex}`]: {
        body: "@prefix solid: <http://www.w3.org/ns/solid/terms#> . <> a solid:TypeIndex .",
        etag: 'W/"i"',
      },
    });
    // The document PUT URL is dynamic (random); allow any PUT to the container.
    const baseFetch = fetch;
    const wrapped = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if ((init?.method ?? "GET") === "PUT" && url.startsWith(CONTAINER) && url.endsWith(".ttl")) {
        calls.push({
          url,
          method: "PUT",
          headers: normaliseHeaders(init?.headers),
          body: init?.body as string,
        });
        return new Response(null, { status: 201, headers: { etag: 'W/"new"' } });
      }
      return baseFetch(input, init);
    }) as typeof fetch;

    const { url, etag } = await store(wrapped).create(
      { title: "My Doc", body: "<p>hello</p>" },
      "My Doc",
    );
    expect(url.startsWith(`${CONTAINER}my-doc-`)).toBe(true);
    expect(etag).toBe('W/"new"');
    const docPut = calls.find((c) => c.method === "PUT" && c.url === url);
    expect(docPut?.headers["if-none-match"]).toBe("*");
    // The type-index registration was written.
    expect(calls.some((c) => c.method === "PUT" && c.url === PrivateIndex)).toBe(true);
  });

  it("uses the title as the slug hint when none is given", async () => {
    // Pre-linked private index that already has the registration → no writes there.
    const PrivateIndex = "https://alice.pod/settings/privateTypeIndex.ttl";
    const indexBody = `
      @prefix solid: <http://www.w3.org/ns/solid/terms#> .
      <> a solid:TypeIndex .
      <#reg> a solid:TypeRegistration ; solid:forClass <${DOCUMENT_CLASS}> ; solid:instanceContainer <${CONTAINER}> .
    `;
    const calls: { url: string; method: string }[] = [];
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      calls.push({ url, method });
      if (method === "GET" && url === WEBID) {
        return new Response(
          `<${WEBID}> <http://www.w3.org/ns/solid/terms#privateTypeIndex> <${PrivateIndex}> .`,
          { status: 200, headers: { "content-type": "text/turtle", etag: 'W/"p"' } },
        );
      }
      if (method === "GET" && url === PrivateIndex) {
        return new Response(indexBody, {
          status: 200,
          headers: { "content-type": "text/turtle", etag: 'W/"i"' },
        });
      }
      if (method === "PUT" && url.startsWith(CONTAINER)) {
        return new Response(null, { status: 201, headers: { etag: 'W/"x"' } });
      }
      return new Response("nf", { status: 404 });
    }) as typeof fetch;

    const { url } = await store(fetchImpl).create({ title: "Auto Slug" });
    expect(url.startsWith(`${CONTAINER}auto-slug-`)).toBe(true);
    expect(calls.some((c) => c.method === "PUT" && c.url === PrivateIndex)).toBe(false);
  });
});

describe("save", () => {
  it("writes with If-Match when an etag is given and preserves history", async () => {
    const calls: { url: string; method: string; headers: Record<string, string>; body?: string }[] =
      [];
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      calls.push({
        url,
        method: init?.method ?? "GET",
        headers: normaliseHeaders(init?.headers),
        body: init?.body as string,
      });
      return new Response(null, { status: 205, headers: { etag: 'W/"v2"' } });
    }) as typeof fetch;

    const { etag } = await store(fetchImpl).save(
      DOC,
      {
        title: "v2",
        body: "two",
        priorRevisions: [
          {
            id: `${DOC}#rev-0`,
            body: "one",
            format: "text/html",
            generatedAt: new Date(0).toISOString(),
          },
        ],
      },
      'W/"v1"',
    );
    expect(etag).toBe('W/"v2"');
    expect(calls[0]?.headers["if-match"]).toBe('W/"v1"');
    expect(calls[0]?.body).toContain("rev-1");
    expect(calls[0]?.body).toContain("rev-0");
  });

  it("rejects an out-of-scope save before any I/O", async () => {
    const { fetch, calls } = mockFetch({});
    await expect(
      store(fetch).save("https://evil/x", { title: "t", body: "b" }),
    ).rejects.toBeInstanceOf(OutOfScopeError);
    expect(calls).toHaveLength(0);
  });
});

describe("remove", () => {
  it("deletes a document in scope", async () => {
    const { fetch, calls } = mockFetch({ [`DELETE ${DOC}`]: { status: 205 } });
    await expect(store(fetch).remove(DOC)).resolves.toBeUndefined();
    expect(calls[0]?.method).toBe("DELETE");
  });
  it("rejects an out-of-scope delete before any I/O", async () => {
    const { fetch, calls } = mockFetch({});
    await expect(store(fetch).remove(CONTAINER)).rejects.toBeInstanceOf(OutOfScopeError);
    expect(calls).toHaveLength(0);
  });
});

describe("list", () => {
  it("lists document resources, skipping the self-description and sub-containers", async () => {
    const containerTtl = `
      @prefix ldp: <http://www.w3.org/ns/ldp#> .
      @prefix dct: <http://purl.org/dc/terms/> .
      <${CONTAINER}> a ldp:Container ; ldp:contains <${CONTAINER}>, <${CONTAINER}b.ttl>, <${CONTAINER}a.ttl>, <${CONTAINER}sub/> .
      <${CONTAINER}b.ttl> a ldp:Resource .
      <${CONTAINER}a.ttl> a ldp:Resource ; dct:modified "2026-01-01T00:00:00.000Z"^^<http://www.w3.org/2001/XMLSchema#dateTime> .
      <${CONTAINER}sub/> a ldp:Container .
    `;
    const { fetch } = mockFetch({ [`GET ${CONTAINER}`]: { body: containerTtl } });
    const items = await store(fetch).list();
    expect(items.map((i) => i.url)).toEqual([`${CONTAINER}a.ttl`, `${CONTAINER}b.ttl`]);
    expect(items[0]?.modified).toBe("2026-01-01T00:00:00.000Z");
    expect(items.every((i) => !i.isContainer)).toBe(true);
  });

  it("returns an empty list for a missing (404) or forbidden (403) container", async () => {
    const { fetch: f404 } = mockFetch({});
    await expect(store(f404).list()).resolves.toEqual([]);
    const { fetch: f403 } = mockFetch({ [`GET ${CONTAINER}`]: { status: 403, body: "no" } });
    await expect(store(f403).list()).resolves.toEqual([]);
  });

  it("propagates a non-404/403 container read failure", async () => {
    const { fetch } = mockFetch({ [`GET ${CONTAINER}`]: { status: 500, body: "err" } });
    await expect(store(fetch).list()).rejects.toMatchObject({ status: 500 });
  });

  it("yields an empty list when the container describes no children", async () => {
    const { fetch } = mockFetch({
      [`GET ${CONTAINER}`]: {
        body: `@prefix ldp: <http://www.w3.org/ns/ldp#> . <${CONTAINER}> a ldp:Container .`,
      },
    });
    await expect(store(fetch).list()).resolves.toEqual([]);
  });
});

describe("re-exports", () => {
  it("re-exports nameFromUrl", () => {
    expect(nameFromUrl(`${CONTAINER}x.ttl`)).toBe("x.ttl");
  });
});
