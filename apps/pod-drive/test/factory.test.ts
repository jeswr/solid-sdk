// AUTHORED-BY Codex GPT-6.1-Sol

import { StorageError } from "@jeswr/storage-client";
import { describe, expect, it, vi } from "vitest";
import { createDriveStore, DriveAccessError, listContainer } from "../src/drive.js";

// Exercise real factory discovery separately from legacy HTTP-contract fixtures.
vi.unmock("@jeswr/storage-client");

describe.each(["solid", "lws"] as const)("real PodClient discovery for %s", (protocol) => {
  it("retries failed discovery, then uses the authenticated transport for app data", async () => {
    const root = `https://${protocol}.pod-drive-factory.example/`;
    const description = `${root}.well-known/storage`;
    const file = `${root}note.ttl`;
    const requests: { method: string; url: string; accept: string | null }[] = [];
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      requests.push({ method, url, accept: new Headers(init?.headers).get("accept") });
      if (method === "OPTIONS")
        return new Response(null, {
          status: 204,
          headers: { allow: "GET, HEAD, PUT, POST, DELETE" },
        });
      if (url === description) {
        const body =
          protocol === "solid"
            ? `<${root}> a <http://www.w3.org/ns/pim/space#Storage>.`
            : JSON.stringify({
                "@context": ["https://www.w3.org/ns/cid/v1", "https://www.w3.org/ns/lws/v1"],
                id: description,
                type: "Storage",
                service: [{ type: "StorageRoot", serviceEndpoint: root }],
              });
        return new Response(body, {
          headers: { "content-type": protocol === "solid" ? "text/turtle" : "application/lws+cid" },
        });
      }
      const links =
        protocol === "solid"
          ? `<${description}>; rel="http://www.w3.org/ns/solid/terms#storageDescription", <http://www.w3.org/ns/pim/space#Storage>; rel="type"`
          : `<${description}>; rel="https://www.w3.org/ns/lws#storage", <${root}>; rel="up"`;
      if (method === "HEAD")
        return new Response(null, { headers: { link: links, etag: '"root"' } });
      if (url === file)
        return new Response(
          '<#it> a <https://vocab.jeswr.org/pod-docs#Document>; <http://purl.org/dc/terms/title> "A note".',
          { headers: { "content-type": "text/turtle", link: links, etag: '"file"' } },
        );
      if (url === root)
        return new Response(
          protocol === "solid"
            ? `<${root}> a <http://www.w3.org/ns/ldp#Container>; <http://www.w3.org/ns/ldp#contains> <${file}>.`
            : JSON.stringify({
                type: "Container",
                items: [{ id: file, type: "DataResource", format: "text/turtle" }],
              }),
          {
            headers: {
              "content-type": protocol === "solid" ? "text/turtle" : "application/lws+json",
              link: links,
              etag: '"root"',
            },
          },
        );
      throw new Error("Unexpected SDK request");
    });
    fetch.mockRejectedValueOnce(new TypeError("Temporary network failure"));
    const store = createDriveStore({ root, fetch });
    const failures = await Promise.allSettled([store.list(), store.list()]);
    expect(failures).toMatchObject([
      { status: "rejected", reason: { code: "network" } },
      { status: "rejected", reason: { code: "network" } },
    ]);
    expect(fetch).toHaveBeenCalledTimes(1);
    const entries = (await store.list()).container.entries;
    expect(entries.map((entry) => entry.name)).toEqual(["note.ttl"]);
    expect(requests.some((request) => request.url === description)).toBe(true);
    expect(
      requests.find((request) => request.method === "GET" && request.url === root)?.accept,
    ).toContain(protocol === "solid" ? "text/turtle" : "application/lws+json");
    expect((await store.list()).container.entries).toEqual(entries);
  });
});

describe("cold discovery", () => {
  it.each([401, 403] as const)("preserves a %i without discovery links", async (status) => {
    for (const factory of [false, true]) {
      const root = `https://access-${status}-${factory}.pod-drive.example/private/`;
      const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(null, { status }));
      const result = factory
        ? createDriveStore({ root, fetch }).list()
        : listContainer(root, { fetch });
      const error = await result.catch((error: unknown) => error);
      expect(error).toBeInstanceOf(DriveAccessError);
      expect(error).toMatchObject({ status, url: root, cause: { code: "no-storage-link" } });
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(fetch.mock.calls[0]?.[1]?.redirect).toBe("manual");
    }
  });

  it.each([
    [false, false],
    [true, false],
    [false, true],
    [true, true],
  ])("discovers Solid before normalising a redirect (store=%s, browser=%s)", async (factory, browser) => {
    const root = `https://slash-${factory}-${browser}.pod-drive.example/`;
    const container = `${root}drive/`;
    const controller = new AbortController();
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      const url = String(input);
      if (url === container.slice(0, -1)) {
        if (browser) {
          // Browser manual redirects expose neither status nor Location.
          const response = Response.error();
          Object.defineProperty(response, "type", { value: "opaqueredirect" });
          return response;
        }
        return new Response(null, { status: 301, headers: { location: "/drive/" } });
      }
      if (init?.method === "HEAD")
        return new Response(null, {
          headers: {
            "updates-via": "wss://updates.pod-drive.example/",
            ...(url === root
              ? { link: '<http://www.w3.org/ns/pim/space#Storage>; rel="type"' }
              : {}),
          },
        });
      if (init?.method === "OPTIONS") return new Response(null, { status: 204 });
      return new Response(`<${container}> a <http://www.w3.org/ns/ldp#Container>.`, {
        headers: { "content-type": "text/turtle" },
      });
    });
    const listing = factory
      ? await createDriveStore({ root: container.slice(0, -1), fetch }).list()
      : await listContainer(container.slice(0, -1), { fetch, signal: controller.signal });
    expect(listing.url).toBe(container);
    expect(listing.container.entries).toEqual([]);
    expect(fetch.mock.calls.filter(([url]) => String(url) === container.slice(0, -1))).toHaveLength(
      1,
    );
    expect(fetch.mock.calls.every(([, init]) => init?.redirect === "manual")).toBe(true);
    const requested = fetch.mock.calls.map(([url]) => String(url));
    expect(requested.indexOf(root)).toBeLessThan(requested.indexOf(container));
    if (!factory)
      expect(fetch.mock.calls.every(([, init]) => init?.signal === controller.signal)).toBe(true);
  });

  it.each([
    false,
    true,
  ])("preserves a cold target's 404 without discovery links (store=%s)", async (factory) => {
    const root = `https://missing-${factory}.pod-drive.example/missing/`;
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(null, { status: 404 }));
    const result = factory
      ? createDriveStore({ root, fetch }).list()
      : listContainer(root, { fetch });
    const error = await result.catch((error: unknown) => error);
    expect(error).toBeInstanceOf(StorageError);
    expect(error).not.toBeInstanceOf(DriveAccessError);
    expect(error).toMatchObject({
      code: "not-found",
      status: 404,
      method: "HEAD",
      url: root,
      cause: { code: "no-storage-link" },
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("does not mistake a missing description for a missing container", async () => {
    const root = "https://missing-description.pod-drive.example/";
    const description = `${root}storage`;
    const fetch = vi.fn<typeof globalThis.fetch>(async (input) =>
      String(input) === root
        ? new Response(null, {
            headers: {
              link: `<${description}>; rel="http://www.w3.org/ns/solid/terms#storageDescription", <http://www.w3.org/ns/pim/space#Storage>; rel="type"`,
            },
          })
        : new Response(null, { status: 404 }),
    );
    await expect(listContainer(root, { fetch })).rejects.toMatchObject({
      code: "description-unreachable",
      status: 404,
      url: description,
    });
  });

  it("does not normalise an opaque redirect when parent discovery identifies LWS", async () => {
    const root = "https://lws-redirect.pod-drive.example/";
    const container = `${root}opaque`;
    const description = `${root}storage`;
    const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
      const url = String(input);
      if (url === container) {
        const response = Response.error();
        Object.defineProperty(response, "type", { value: "opaqueredirect" });
        return response;
      }
      if (url === root)
        return new Response(null, {
          headers: { link: `<${description}>; rel="https://www.w3.org/ns/lws#storage"` },
        });
      expect(url).toBe(description);
      return new Response(
        JSON.stringify({
          id: description,
          type: "Storage",
          service: [{ type: "StorageRoot", serviceEndpoint: root }],
        }),
        { headers: { "content-type": "application/lws+cid" } },
      );
    });
    await expect(listContainer(container, { fetch })).rejects.toMatchObject({
      code: "description-unreachable",
      status: 0,
      url: container,
    });
    expect(fetch.mock.calls.some(([url]) => String(url) === root)).toBe(true);
    expect(fetch.mock.calls.some(([url]) => String(url) === `${container}/`)).toBe(false);
  });

  it("keeps a slashless opaque LWS container unchanged", async () => {
    const root = "https://opaque.pod-drive.example/";
    const container = `${root}opaque-container`;
    const description = `${root}storage`;
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      const url = String(input);
      if (url === description)
        return new Response(
          JSON.stringify({
            id: description,
            type: "Storage",
            service: [{ type: "StorageRoot", serviceEndpoint: root }],
          }),
          { headers: { "content-type": "application/lws+cid" } },
        );
      expect(url).toBe(container);
      return new Response(
        init?.method === "HEAD" ? null : JSON.stringify({ type: "Container", items: [] }),
        {
          headers: {
            link: `<${description}>; rel="https://www.w3.org/ns/lws#storage", <https://www.w3.org/ns/lws#Container>; rel="type"`,
            "content-type": "application/lws+json",
          },
        },
      );
    });
    expect((await listContainer(container, { fetch })).url).toBe(container);
    expect(fetch.mock.calls.some(([url]) => String(url) === `${container}/`)).toBe(false);
  });

  it.each([
    null,
    "https://foreign.example/drive/",
    "/elsewhere/",
    "http://[",
  ])("refuses a redirect with Location %s", async (location) => {
    const url = "https://redirect.pod-drive.example/drive";
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () =>
        new Response(null, {
          status: 308,
          headers: location === null ? {} : { location },
        }),
    );
    await expect(listContainer(url, { fetch })).rejects.toMatchObject({
      code: "description-unreachable",
      status: 308,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
