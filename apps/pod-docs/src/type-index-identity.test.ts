// AUTHORED-BY Codex GPT-6

import { createMemoryStorage } from "@jeswr/storage-client/memory";
import { DataFactory } from "n3";
import { describe, expect, it, vi } from "vitest";
import { createDocsStore } from "./store.js";
import { mockFetch, turtleToStore } from "./test-helpers.js";
import { discoverRegistrations, ensureTypeRegistrations, TypeIndexDataset } from "./type-index.js";
import { DOCUMENT_CLASS } from "./vocab.js";

describe("identity document resolution regressions", () => {
  it.each([
    "https://identity.example/",
    "https://pod.example/alice/",
  ])("bootstraps after a same-origin WebID 303 at %s using the canonical profile and its validator", async (identityRoot) => {
    const podRoot = "https://pod.example/alice/";
    const profile = `${identityRoot}id`;
    const canonical = `${identityRoot}profiles/card`;
    const webId = `${profile}#me`;
    const index = `${podRoot}settings/privateTypeIndex.ttl`;
    const { fetch, calls } = mockFetch({
      [`GET ${canonical}`]: {
        body: `<${webId}> a <http://xmlns.com/foaf/0.1/Person>.`,
        etag: '"canonical-profile"',
      },
      [`HEAD ${podRoot}settings/`]: { status: 200 },
      [`PUT ${canonical}`]: { status: 205 },
      [`PUT ${index}`]: { status: 201 },
      [`GET ${index}`]: { body: "", etag: '"index"' },
    });
    const transport = vi.fn<typeof globalThis.fetch>(async (input, init) =>
      String(input) === profile
        ? new Response(null, { status: 303, headers: { location: "profiles/card" } })
        : fetch(input, init),
    );
    await expect(
      ensureTypeRegistrations({
        webId,
        podRoot,
        registrations: [{ forClass: DOCUMENT_CLASS, container: `${podRoot}docs/` }],
        fetchImpl: transport,
      }),
    ).resolves.toEqual({ indexUrl: index, added: 1, bootstrapped: true });
    expect(calls.find((call) => call.method === "PUT" && call.url === canonical)).toMatchObject({
      headers: { "if-match": '"canonical-profile"' },
      body: expect.stringContaining(`<${webId}>`),
    });
    expect(calls.some((call) => call.method === "PUT" && call.url === profile)).toBe(false);
    expect(transport.mock.calls.every(([, init]) => init?.redirect === "manual")).toBe(true);
  });

  it.each([
    "localhost",
    "127.0.0.1",
    "[::1]",
  ])("registers against HTTP CSS at %s only with the explicit development opt-in", async (host) => {
    const podRoot = `http://${host}:3000/alice/`;
    const webId = `${podRoot}profile/card#me`;
    const index = `${podRoot}settings/privateTypeIndex.ttl`;
    const { fetch, calls } = mockFetch({
      [`GET ${podRoot}profile/card`]: {
        body: `<${webId}> <http://www.w3.org/ns/solid/terms#privateTypeIndex> <${index}>.`,
      },
      [`GET ${index}`]: { body: "", etag: '"local-index"' },
      [`PUT ${index}`]: { status: 205 },
    });
    const options = {
      webId,
      podRoot,
      registrations: [{ forClass: DOCUMENT_CLASS, container: `${podRoot}docs/` }],
      fetchImpl: fetch,
      allowInsecureLoopback: true,
    };
    await expect(ensureTypeRegistrations(options)).resolves.toMatchObject({ added: 1 });
    expect(calls.find((call) => call.method === "PUT")).toMatchObject({
      url: index,
      headers: { "if-match": '"local-index"' },
    });
  });

  it("threads the opt-in through document creation with an injected loopback storage client", async () => {
    const podRoot = "http://localhost:3000/alice/";
    const webId = `${podRoot}profile/card#me`;
    const index = `${podRoot}index.ttl`;
    const storage = createMemoryStorage({ root: podRoot });
    await storage.create(podRoot, null, { name: "profile", kind: "container" });
    await storage.create(
      `${podRoot}profile/`,
      `<${webId}> <http://www.w3.org/ns/solid/terms#privateTypeIndex> <${index}>.`,
      {
        name: "card",
        contentType: "text/turtle",
      },
    );
    await storage.create(podRoot, "", { name: "index.ttl", contentType: "text/turtle" });
    const store = createDocsStore({ podRoot, webId, storage, allowInsecureLoopback: true });
    const created = await store.create({ title: "Local CSS document" });
    expect((await store.read(created.url))?.data.title).toBe("Local CSS document");
    expect(
      new TypeIndexDataset((await storage.readRdf(index)).dataset, DataFactory).locate(
        DOCUMENT_CLASS,
      ),
    ).toEqual([{ forClass: DOCUMENT_CLASS, container: store.container, instance: undefined }]);
  });

  it.each([
    { host: "localhost", allowInsecureLoopback: false },
    { host: "127.0.0.1", allowInsecureLoopback: false },
    { host: "[::1]", allowInsecureLoopback: false },
    { host: "pod.example", allowInsecureLoopback: true },
    { host: "localhost.evil.example", allowInsecureLoopback: true },
    { host: "192.168.1.1", allowInsecureLoopback: true },
    { host: "169.254.169.254", allowInsecureLoopback: true },
  ])("refuses HTTP at $host (opt-in: $allowInsecureLoopback) before reading an injected client", async ({
    host,
    allowInsecureLoopback,
  }) => {
    const podRoot = `http://${host}:3000/alice/`;
    const storage = createMemoryStorage({ root: podRoot });
    const read = vi.spyOn(storage, "readRdf");
    await expect(
      ensureTypeRegistrations({
        podRoot,
        webId: `${podRoot}card#me`,
        storage,
        registrations: [],
        allowInsecureLoopback,
      }),
    ).rejects.toMatchObject({ code: "scope" });
    expect(read).not.toHaveBeenCalled();
  });

  it.each([
    { from: "https://id.example/id", to: "https://profiles.example/card" },
    { from: "http://localhost:3000/id", to: "http://127.0.0.1:3000/card" },
  ])("follows a validated cross-origin profile redirect from $from", async ({ from, to }) => {
    const webId = `${from}#me`;
    const storage = createMemoryStorage({ root: "https://pod.example/alice/" });
    const index = `${storage.root}index.ttl`;
    await storage.create(storage.root, "", { name: "index.ttl", contentType: "text/turtle" });
    const transport = vi.fn<typeof globalThis.fetch>(async (input) =>
      String(input) === from
        ? Response.redirect(to, 303)
        : new Response(
            `<${webId}> <http://www.w3.org/ns/solid/terms#privateTypeIndex> <${index}>.`,
            { headers: { "content-type": "text/turtle" } },
          ),
    );
    await expect(
      ensureTypeRegistrations({
        podRoot: storage.root,
        webId,
        storage,
        registrations: [],
        fetchImpl: transport,
        allowInsecureLoopback: true,
      }),
    ).resolves.toMatchObject({ indexUrl: index });
    expect(transport.mock.calls.map(([input]) => String(input))).toEqual([from, to]);
  });

  it.each([
    "http://localhost:3000/card",
    "http://foreign.example/card",
    "https://user:secret@id.example/card",
    "https://id.example/%2fcard",
    "https://id.example/%5ccard",
    "file:///card",
    "https://127.0.0.1/card",
  ])("refuses an unsafe profile redirect to %s before fetching it", async (destination) => {
    const storage = createMemoryStorage({ root: "https://pod.example/" });
    const transport = vi.fn<typeof globalThis.fetch>(
      async (): Promise<Response> => Response.redirect(destination, 303),
    );
    await expect(
      ensureTypeRegistrations({
        podRoot: storage.root,
        webId: "https://id.example/id#me",
        storage,
        registrations: [],
        fetchImpl: transport,
      }),
    ).rejects.toThrow();
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("refuses an HTTPS downgrade even with the loopback opt-in", async () => {
    const storage = createMemoryStorage({ root: "https://pod.example/" });
    const transport = vi.fn<typeof globalThis.fetch>(async () =>
      Response.redirect("http://localhost:3000/card", 303),
    );
    await expect(
      ensureTypeRegistrations({
        podRoot: storage.root,
        webId: "https://id.example/id#me",
        storage,
        registrations: [],
        fetchImpl: transport,
        allowInsecureLoopback: true,
      }),
    ).rejects.toThrow("downgrade");
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it.each(["loop", "overflow"])("bounds profile redirects on %s", async (mode) => {
    const storage = createMemoryStorage({ root: "https://pod.example/" });
    const transport = vi.fn<typeof globalThis.fetch>(
      async (): Promise<Response> =>
        Response.redirect(
          `https://id.example/${mode === "loop" ? "id" : `hop-${transport.mock.calls.length}`}`,
          302,
        ),
    );
    await expect(
      ensureTypeRegistrations({
        podRoot: storage.root,
        webId: "https://id.example/id#me",
        storage,
        registrations: [],
        fetchImpl: transport,
      }),
    ).rejects.toThrow(mode === "loop" ? "loop" : "Too many redirects");
    expect(transport).toHaveBeenCalledTimes(mode === "loop" ? 1 : 6);
  });

  it.each([
    false,
    true,
  ])("resolves same-origin preferences and canonical relative index URLs (other pod: %s)", async (otherPod) => {
    const podRoot = "https://pod.example/alice/";
    const webId = "https://id.example/id#me";
    const preferences = `${podRoot}prefs`;
    const preferencesRoot = otherPod ? "https://other.example/alice/" : podRoot;
    const canonicalPreferences = `${preferencesRoot}settings/prefs.ttl`;
    const index = `${preferencesRoot}settings/index.ttl`;
    const canonicalIndex = `${preferencesRoot}settings/canonical-index.ttl`;
    const profile = turtleToStore(
      `<${webId}>
      <http://www.w3.org/ns/pim/space#storage> <${podRoot}>, <${preferencesRoot}>;
      <http://www.w3.org/ns/pim/space#preferencesFile> <${preferences}>.`,
      "https://id.example/id",
    );
    const { fetch, calls } = mockFetch({
      [`GET ${canonicalPreferences}`]: {
        body: `<${webId}> <http://www.w3.org/ns/solid/terms#privateTypeIndex> <index.ttl>.`,
      },
      [`GET ${canonicalIndex}`]: {
        body: `<#r> a <http://www.w3.org/ns/solid/terms#TypeRegistration>;
          <http://www.w3.org/ns/solid/terms#forClass> <${DOCUMENT_CLASS}>;
          <http://www.w3.org/ns/solid/terms#instanceContainer> <${podRoot}docs/>.`,
      },
    });
    const transport = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      if (String(input) === preferences) return Response.redirect(canonicalPreferences, 303);
      if (String(input) === index) return Response.redirect(canonicalIndex, 307);
      return fetch(input, init);
    });
    await expect(discoverRegistrations(webId, profile, transport)).resolves.toEqual([
      { forClass: DOCUMENT_CLASS, container: `${podRoot}docs/`, instance: undefined },
    ]);
    expect(calls.map((call) => call.url)).toEqual([canonicalPreferences, canonicalIndex]);
  });

  it.each([
    "https://foreign.example/prefs",
    "https://pod.example/alice-evil/prefs",
  ])("refuses unvouched preferences redirect %s before fetching it", async (destination) => {
    const webId = "https://id.example/id#me";
    const preferences = "https://pod.example/alice/prefs";
    const profile = turtleToStore(
      `<${webId}>
        <http://www.w3.org/ns/pim/space#storage> <https://pod.example/alice/>;
        <http://www.w3.org/ns/pim/space#preferencesFile> <${preferences}>.`,
      "https://id.example/id",
    );
    const transport = vi.fn<typeof globalThis.fetch>(async () =>
      Response.redirect(destination, 302),
    );
    await expect(discoverRegistrations(webId, profile, transport)).rejects.toMatchObject({
      cause: { name: "SsrfError" },
    });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("writes a redirected index only at its canonical document using its own ETag", async () => {
    const podRoot = "https://pod.example/alice/";
    const webId = "https://id.example/id#me";
    const index = "https://metadata.example/index";
    const canonical = "https://metadata.example/indexes/current.ttl";
    const storage = createMemoryStorage({ root: podRoot });
    const { fetch, calls } = mockFetch({
      "GET https://id.example/id": {
        body: `<${webId}> <http://www.w3.org/ns/solid/terms#privateTypeIndex> <${index}>.`,
      },
      [`GET ${canonical}`]: { body: "", etag: '"canonical-index"' },
      [`PUT ${canonical}`]: { status: 205 },
    });
    const transport = vi.fn<typeof globalThis.fetch>(async (input, init) =>
      String(input) === index
        ? new Response(null, {
            status: 308,
            headers: { location: canonical, etag: '"redirect-validator"' },
          })
        : fetch(input, init),
    );
    await expect(
      ensureTypeRegistrations({
        podRoot,
        webId,
        storage,
        fetchImpl: transport,
        registrations: [{ forClass: DOCUMENT_CLASS, container: `${podRoot}docs/` }],
      }),
    ).resolves.toMatchObject({ indexUrl: canonical, added: 1 });
    expect(calls.filter((call) => call.method === "PUT")).toEqual([
      expect.objectContaining({
        url: canonical,
        headers: expect.objectContaining({ "if-match": '"canonical-index"' }),
      }),
    ]);
  });

  it("never uses a redirect response's ETag to overwrite an unvalidated canonical index", async () => {
    const storage = createMemoryStorage({ root: "https://pod.example/alice/" });
    const webId = "https://id.example/id#me";
    const index = "https://metadata.example/index";
    const canonical = "https://metadata.example/current.ttl";
    const { fetch, calls } = mockFetch({
      "GET https://id.example/id": {
        body: `<${webId}> <http://www.w3.org/ns/solid/terms#privateTypeIndex> <${index}>.`,
      },
      [`GET ${canonical}`]: { body: "" },
    });
    const transport = vi.fn<typeof globalThis.fetch>(async (input, init) =>
      String(input) === index
        ? new Response(null, {
            status: 301,
            headers: { location: canonical, etag: '"redirect-only"' },
          })
        : fetch(input, init),
    );
    await expect(
      ensureTypeRegistrations({
        podRoot: storage.root,
        webId,
        storage,
        fetchImpl: transport,
        registrations: [{ forClass: DOCUMENT_CLASS, container: `${storage.root}docs/` }],
      }),
    ).rejects.toMatchObject({ code: "precondition-required" });
    expect(calls.some((call) => call.method === "PUT")).toBe(false);
  });

  it.each([
    "native",
    "unreported",
  ])("refuses a %s profile redirect that bypasses visible hop validation", async (mode) => {
    const storage = createMemoryStorage({ root: "https://pod.example/" });
    const response = new Response("", { headers: { "content-type": "text/turtle" } });
    Object.defineProperties(response, {
      redirected: { value: mode === "native" },
      url: { value: "https://id.example/other" },
      type: { value: "basic" },
    });
    const transport = vi.fn<typeof globalThis.fetch>(async () => response);
    await expect(
      ensureTypeRegistrations({
        podRoot: storage.root,
        webId: "https://id.example/id#me",
        storage,
        registrations: [],
        fetchImpl: transport,
      }),
    ).rejects.toMatchObject({ cause: { name: "SsrfError" } });
    expect(transport).toHaveBeenCalledTimes(1);
    expect(response.bodyUsed).toBe(true);
  });

  it.each([
    false,
    true,
  ])("checks a cross-origin index redirect against the WebID's storage claims (vouched: %s)", async (vouched) => {
    const storage = createMemoryStorage({ root: "https://pod.example/alice/" });
    const webId = "https://id.example/id#me";
    const index = "https://metadata.example/index";
    const canonical = "https://second.example/alice/index.ttl";
    const profile = `<${webId}> <http://www.w3.org/ns/solid/terms#privateTypeIndex> <${index}>.
      ${vouched ? `<${webId}> <http://www.w3.org/ns/pim/space#storage> <https://second.example/alice/>.` : ""}`;
    const { fetch, calls } = mockFetch({
      "GET https://id.example/id": { body: profile },
      [`GET ${canonical}`]: { body: "", etag: '"canonical-index"' },
      [`PUT ${canonical}`]: { status: 205 },
    });
    const transport = vi.fn<typeof globalThis.fetch>(async (input, init) =>
      String(input) === index ? Response.redirect(canonical, 302) : fetch(input, init),
    );
    const registration = ensureTypeRegistrations({
      podRoot: storage.root,
      webId,
      storage,
      fetchImpl: transport,
      registrations: [{ forClass: DOCUMENT_CLASS, container: `${storage.root}docs/` }],
    });
    if (vouched) {
      await expect(registration).resolves.toMatchObject({ indexUrl: canonical, added: 1 });
    } else {
      await expect(registration).rejects.toMatchObject({
        cause: { name: "SsrfError" },
      });
      expect(calls.some((call) => call.url === canonical)).toBe(false);
    }
    const discovery = discoverRegistrations(
      webId,
      turtleToStore(profile, "https://id.example/id"),
      transport,
      storage,
    );
    if (vouched) await expect(discovery).resolves.toEqual([]);
    else
      await expect(discovery).rejects.toMatchObject({
        cause: { name: "SsrfError" },
      });
  });
});
