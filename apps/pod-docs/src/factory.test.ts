// AUTHORED-BY Codex GPT-6.1-Sol

import { createMemoryStorage } from "@jeswr/storage-client/memory";
import { DataFactory } from "n3";
import { describe, expect, it, vi } from "vitest";
import { createDocsStore } from "./store.js";
import { turtleToStore } from "./test-helpers.js";
import { discoverRegistrations, TypeIndexDataset, typeIndexLinks } from "./type-index.js";
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
      if (method === "HEAD")
        return new Response(null, {
          headers: {
            "updates-via": "wss://docs-profile.example/updates",
            ...(url === otherRoot
              ? { link: '<http://www.w3.org/ns/pim/space#Storage>; rel="type"' }
              : {}),
          },
        });
      if (method === "OPTIONS") return new Response(null, { status: 204 });
      if (url === indexUrl && method === "GET")
        return new Response(index, { headers: { "content-type": "text/turtle", etag: '"index"' } });
      if (url === indexUrl && method === "PUT") {
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
      fetch.mock.calls.some(
        ([url, init]) => String(url) === webId.split("#")[0] && init?.method === "HEAD",
      ),
    ).toBe(false);
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
