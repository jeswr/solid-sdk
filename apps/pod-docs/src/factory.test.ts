// AUTHORED-BY Codex GPT-6.1-Sol

import { createMemoryStorage } from "@jeswr/storage-client/memory";
import { DataFactory } from "n3";
import { describe, expect, it, vi } from "vitest";
import { createDocsStore } from "./store.js";
import { turtleToStore } from "./test-helpers.js";
import {
  discoverRegistrations,
  ensureTypeRegistrations,
  TypeIndexDataset,
  typeIndexLinks,
} from "./type-index.js";
import { DOCUMENT_CLASS } from "./vocab.js";

// Exercise real factory discovery separately from legacy HTTP-contract fixtures.
vi.unmock("@jeswr/storage-client");

describe.each(["solid", "lws"] as const)("real PodClient discovery for %s", (protocol) => {
  it("retries failed discovery, then uses the authenticated transport for app data", async () => {
    const root = `https://${protocol}.pod-docs-factory.example/`;
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
          `<#it> a <${DOCUMENT_CLASS}>; <http://purl.org/dc/terms/title> "A note".`,
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
    const store = createDocsStore({
      podRoot: root,
      webId: `${root}card#me`,
      container: root,
      fetchImpl: fetch,
    });
    const failures = await Promise.allSettled([store.list(), store.list()]);
    expect(failures).toMatchObject([
      { status: "rejected", reason: { code: "network" } },
      { status: "rejected", reason: { code: "network" } },
    ]);
    expect(fetch).toHaveBeenCalledTimes(1);
    const entries = await store.list();
    expect(entries.map((entry) => entry.title)).toEqual(["A note"]);
    expect(requests.some((request) => request.url === description)).toBe(true);
    expect(
      requests.find((request) => request.method === "GET" && request.url === root)?.accept,
    ).toContain(protocol === "solid" ? "text/turtle" : "application/lws+json");
    await expect(store.list()).resolves.toEqual(entries);
  });
});

describe("cold type-index discovery", () => {
  it.each([
    "solid",
    "lws",
  ] as const)("reuses a supplied %s client for its indexes", async (protocol) => {
    const root = `https://docs-index-memory-${protocol}.example/`;
    const webId = `${root}card#me`;
    const storage = createMemoryStorage({ root, protocol });
    const index = await storage.create(
      root,
      `<#r> a <http://www.w3.org/ns/solid/terms#TypeRegistration>;
        <http://www.w3.org/ns/solid/terms#forClass> <${DOCUMENT_CLASS}>;
        <http://www.w3.org/ns/solid/terms#instanceContainer> <${root}docs/>.`,
      { name: "public.ttl", contentType: "text/turtle" },
    );
    const profile = turtleToStore(
      `<${webId}> <http://www.w3.org/ns/solid/terms#publicTypeIndex> <${index.url}>;
        <http://www.w3.org/ns/solid/terms#privateTypeIndex> <${root}missing.ttl>.`,
      webId,
    );
    const fetch = vi.fn<typeof globalThis.fetch>(async () => {
      throw new Error("Unexpected HTTP request with a supplied client");
    });
    await expect(discoverRegistrations(webId, profile, fetch, storage)).resolves.toEqual([
      { forClass: DOCUMENT_CLASS, container: `${root}docs/`, instance: undefined },
    ]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    { status: 403, unreadable: "public" },
    { status: 404, unreadable: "public" },
    { status: 403, unreadable: "private" },
    { status: 404, unreadable: "private" },
  ])("keeps the other index's registrations when $unreadable returns $status", async ({
    status,
    unreadable,
  }) => {
    const root = `https://docs-cold-${unreadable}-${status}.example/`;
    const webId = `${root}card#me`;
    const publicIndex = `${root}public.ttl`;
    const privateIndex = `${root}private.ttl`;
    const unavailableIndex = unreadable === "public" ? publicIndex : privateIndex;
    const profile = turtleToStore(
      `<${webId}> <http://www.w3.org/ns/solid/terms#publicTypeIndex> <${publicIndex}>;
        <http://www.w3.org/ns/solid/terms#privateTypeIndex> <${privateIndex}>.`,
      webId,
    );
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      const url = String(input);
      if (url === unavailableIndex) return new Response(null, { status });
      if (url === publicIndex || url === privateIndex) {
        if (init?.method === "HEAD") return new Response(null);
        return new Response(
          `<#r> a <http://www.w3.org/ns/solid/terms#TypeRegistration>;
            <http://www.w3.org/ns/solid/terms#forClass> <${DOCUMENT_CLASS}>;
            <http://www.w3.org/ns/solid/terms#instanceContainer> <${root}docs/>.`,
          { headers: { "content-type": "text/turtle" } },
        );
      }
      throw new Error("Unexpected type-index request");
    });
    await expect(discoverRegistrations(webId, profile, fetch)).resolves.toEqual([
      { forClass: DOCUMENT_CLASS, container: `${root}docs/`, instance: undefined },
    ]);
    expect(fetch.mock.calls.map(([url]) => String(url))).toEqual([publicIndex, privateIndex]);
    expect(fetch.mock.calls.every(([, init]) => (init?.method ?? "GET") === "GET")).toBe(true);
    expect(
      fetch.mock.calls.every(
        ([, init]) => new Headers(init?.headers).get("cache-control") === "no-cache",
      ),
    ).toBe(true);
  });

  it.each([401, 500])("propagates an index failure with status %i", async (status) => {
    const root = `https://docs-cold-error-${status}.example/`;
    const webId = `${root}card#me`;
    const indexUrl = `${root}index.ttl`;
    const profile = turtleToStore(
      `<${webId}> <http://www.w3.org/ns/solid/terms#privateTypeIndex> <${indexUrl}>.`,
      webId,
    );
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(null, { status }));
    await expect(discoverRegistrations(webId, profile, fetch)).rejects.toMatchObject({ status });
  });
});

describe("separately hosted WebIDs", () => {
  it.each([
    "https://identity.docs-profile.example/card#me",
    "https://docs-profile.example/other-storage/card#me",
  ])("creates documents when the profile at %s links another storage's index", async (webId) => {
    const root = "https://docs-profile.example/selected/";
    const otherRoot = "https://docs-profile.example/other-storage/";
    const indexUrl = `${otherRoot}index.ttl`;
    const storage = createMemoryStorage({ root });
    const profile = `<${webId}> <http://www.w3.org/ns/pim/space#storage> <${root}>, <${otherRoot}>;
      <http://www.w3.org/ns/solid/terms#privateTypeIndex> <${indexUrl}>.`;
    let index = "";
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url === webId.split("#")[0] && method === "GET")
        return new Response(profile, {
          headers: { "content-type": "text/turtle", etag: '"profile"' },
        });
      if (url === indexUrl && method === "GET")
        return new Response(index, { headers: { "content-type": "text/turtle", etag: '"index"' } });
      if (url === indexUrl && method === "PUT") {
        expect(init?.redirect).toBe("manual");
        expect(new Headers(init?.headers).get("content-type")).toBe("text/turtle");
        expect(new Headers(init?.headers).get("if-match")).toBe('"index"');
        index = String(init?.body);
        return new Response(null, { status: 205, headers: { etag: '"updated"' } });
      }
      throw new Error("Unexpected profile/index request");
    });
    const store = createDocsStore({ podRoot: root, webId, fetchImpl: fetch, storage });
    const created = await store.create({ title: "Separate WebID" });
    expect((await store.read(created.url))?.data.title).toBe("Separate WebID");
    expect(new TypeIndexDataset(turtleToStore(index, indexUrl), DataFactory).all()).toEqual([
      { forClass: DOCUMENT_CLASS, container: store.container, instance: undefined },
    ]);
    await expect(
      discoverRegistrations(webId, turtleToStore(profile, webId), fetch, storage),
    ).resolves.toEqual([
      { forClass: DOCUMENT_CLASS, container: store.container, instance: undefined },
    ]);
    expect(
      fetch.mock.calls.every(([, init]) => ["GET", "PUT"].includes(init?.method ?? "GET")),
    ).toBe(true);
  });

  it.each([
    { etag: '"index"', status: 412, expectedStatus: 412 },
    { etag: null, status: 205, expectedStatus: 428 },
    { etag: "*", status: 205, expectedStatus: 428 },
  ])("keeps external index writes conditional with ETag $etag (PUT $status)", async ({
    etag,
    status,
    expectedStatus,
  }) => {
    const root = "https://docs-external-index.example/";
    const webId = "https://identity.docs-external-index.example/card#me";
    const indexUrl = "https://identity.docs-external-index.example/index.ttl";
    const storage = createMemoryStorage({ root });
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url === webId.split("#")[0] && method === "GET")
        return new Response(
          `<${webId}> <http://www.w3.org/ns/solid/terms#privateTypeIndex> <${indexUrl}>.`,
          { headers: { "content-type": "text/turtle" } },
        );
      if (url === indexUrl && method === "GET")
        return new Response("", {
          headers: { "content-type": "text/turtle", ...(etag ? { etag } : {}) },
        });
      if (url === indexUrl && method === "PUT") {
        expect(init?.redirect).toBe("manual");
        expect(new Headers(init?.headers).get("if-match")).toBe(etag);
        return new Response(null, { status });
      }
      throw new Error("Unexpected profile/index request");
    });
    await expect(
      ensureTypeRegistrations({
        webId,
        podRoot: root,
        registrations: [{ forClass: DOCUMENT_CLASS, container: `${root}docs/` }],
        storage,
        fetchImpl: fetch,
      }),
    ).rejects.toMatchObject({ status: expectedStatus });
    expect(fetch.mock.calls.filter(([, init]) => init?.method === "PUT")).toHaveLength(
      etag === '"index"' ? 1 : 0,
    );
  });

  it.each([
    205, 412,
  ])("conditionally links a new index from an external profile (PUT %i)", async (status) => {
    const root = "https://docs-bootstrap.example/";
    const webId = "https://identity.docs-bootstrap.example/card#me";
    const storage = createMemoryStorage({ root });
    let profile = `<${webId}> a <http://xmlns.com/foaf/0.1/Person>.`;
    const fetch = vi.fn<typeof globalThis.fetch>(async (_input, init) => {
      if (init?.method === "PUT") {
        expect(init.redirect).toBe("manual");
        expect(new Headers(init.headers).get("if-match")).toBe('"profile"');
        if (status === 205) profile = String(init.body);
        return new Response(null, { status });
      }
      return new Response(profile, {
        headers: { "content-type": "text/turtle", etag: '"profile"' },
      });
    });
    const store = createDocsStore({ podRoot: root, webId, storage, fetchImpl: fetch });
    if (status === 412) {
      await expect(store.create({ title: "Conflict" })).rejects.toMatchObject({ status: 412 });
    } else {
      await store.create({ title: "Bootstrap" });
      expect(typeIndexLinks(webId, turtleToStore(profile, webId)).privateIndex).toBe(
        `${root}settings/privateTypeIndex.ttl`,
      );
    }
  });
});
