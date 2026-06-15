// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
import { RdfFetchError } from "@jeswr/fetch-rdf";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DriveAccessError, listContainer } from "../src/drive.js";
import { fakeFetch, withUrl } from "./helpers.js";

afterEach(() => {
  vi.restoreAllMocks();
});

const CONTAINER_TTL = `
@prefix ldp: <http://www.w3.org/ns/ldp#> .
@prefix posix: <http://www.w3.org/ns/posix/stat#> .
<https://pod.example/drive/> a ldp:Container ;
  ldp:contains <https://pod.example/drive/a.txt>, <https://pod.example/drive/sub/> .
<https://pod.example/drive/a.txt> a ldp:Resource ; posix:size 5 .
<https://pod.example/drive/sub/> a ldp:Container .
`;

describe("listContainer", () => {
  it("GETs a container and returns the typed listing + etag", async () => {
    const fetch = withUrl(
      fakeFetch({ body: CONTAINER_TTL, etag: '"v1"' }),
      "https://pod.example/drive/",
    );
    const { container, etag, url } = await listContainer("https://pod.example/drive/", { fetch });
    expect(url).toBe("https://pod.example/drive/");
    expect(etag).toBe('"v1"');
    expect(container.entries.map((e) => e.name)).toEqual(["sub", "a.txt"]);
  });

  it("normalises a slashless container url to a trailing slash", async () => {
    let requested = "";
    const stubFetch = (async (input: string | URL | Request) => {
      requested = typeof input === "string" ? input : input.toString();
      const res = new Response(CONTAINER_TTL, {
        status: 200,
        headers: { "content-type": "text/turtle", etag: '"v1"' },
      });
      Object.defineProperty(res, "url", { value: "https://pod.example/drive/" });
      return res;
    }) as unknown as typeof globalThis.fetch;
    await listContainer("https://pod.example/drive", { fetch: stubFetch });
    expect(requested).toBe("https://pod.example/drive/");
  });

  it("surfaces a null etag (server omits it)", async () => {
    const fetch = withUrl(
      fakeFetch({ body: CONTAINER_TTL, etag: null }),
      "https://pod.example/drive/",
    );
    const { etag } = await listContainer("https://pod.example/drive/", { fetch });
    expect(etag).toBeNull();
  });

  it("maps 401 to a DriveAccessError", async () => {
    const fetch = fakeFetch({ status: 401 });
    await expect(listContainer("https://pod.example/private/", { fetch })).rejects.toMatchObject({
      name: "DriveAccessError",
      status: 401,
    });
  });

  it("maps 403 to a DriveAccessError", async () => {
    const fetch = fakeFetch({ status: 403 });
    const err = await listContainer("https://pod.example/private/", { fetch }).catch((e) => e);
    expect(err).toBeInstanceOf(DriveAccessError);
    expect(err.status).toBe(403);
    expect(err.message).toContain("Forbidden");
    expect(err.cause).toBeInstanceOf(RdfFetchError);
  });

  it("re-throws a 404 as the original RdfFetchError (not an access error)", async () => {
    const fetch = fakeFetch({ status: 404 });
    const err = await listContainer("https://pod.example/missing/", { fetch }).catch((e) => e);
    expect(err).toBeInstanceOf(RdfFetchError);
    expect(err).not.toBeInstanceOf(DriveAccessError);
    expect(err.status).toBe(404);
  });

  it("re-throws a network error unchanged", async () => {
    const stubFetch = (async () => {
      throw new TypeError("boom");
    }) as unknown as typeof globalThis.fetch;
    const err = await listContainer("https://pod.example/x/", { fetch: stubFetch }).catch((e) => e);
    expect(err).toBeInstanceOf(RdfFetchError);
    expect(err).not.toBeInstanceOf(DriveAccessError);
  });

  it("forwards an abort signal", async () => {
    let seenSignal: AbortSignal | undefined;
    const stubFetch = (async (_input: unknown, init?: RequestInit) => {
      seenSignal = init?.signal ?? undefined;
      const res = new Response(CONTAINER_TTL, {
        status: 200,
        headers: { "content-type": "text/turtle" },
      });
      Object.defineProperty(res, "url", { value: "https://pod.example/drive/" });
      return res;
    }) as unknown as typeof globalThis.fetch;
    const controller = new AbortController();
    await listContainer("https://pod.example/drive/", {
      fetch: stubFetch,
      signal: controller.signal,
    });
    expect(seenSignal).toBe(controller.signal);
  });

  it("DriveAccessError 401 carries a login-prompting message", () => {
    const e = new DriveAccessError(401, "https://pod.example/x/", new Error("x"));
    expect(e.message).toContain("Authentication required");
    expect(e.url).toBe("https://pod.example/x/");
  });

  it("falls back to the global fetch when no fetch option is given", async () => {
    // Exercises the no-options path (neither `fetch` nor `signal` provided), so
    // @jeswr/fetch-rdf uses globalThis.fetch.
    vi.spyOn(globalThis, "fetch").mockImplementation((async () => {
      const res = new Response(CONTAINER_TTL, {
        status: 200,
        headers: { "content-type": "text/turtle", etag: '"g"' },
      });
      Object.defineProperty(res, "url", { value: "https://pod.example/drive/" });
      return res;
    }) as typeof fetch);
    const { container, etag } = await listContainer("https://pod.example/drive/");
    expect(etag).toBe('"g"');
    expect(container.entries.map((e) => e.name)).toEqual(["sub", "a.txt"]);
  });
});
