// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Codex GPT-6.1-Sol
import type { StorageClient } from "@jeswr/storage-client";
import { StorageError } from "@jeswr/storage-client";
import { createMemoryStorage } from "@jeswr/storage-client/memory";
import { DataFactory, Store } from "n3";
import { describe, expect, it, vi } from "vitest";
import { OutOfScopeError } from "./errors.js";
import { deleteRdf, requireEtag, writeRdf } from "./rdf-io.js";
import { createDocsStore } from "./store.js";
import { mockFetch, turtleToStore } from "./test-helpers.js";
import { discoverRegistrations, TypeIndexDataset } from "./type-index.js";
import { DOCUMENT_CLASS } from "./vocab.js";

const ROOT = "https://docs.example/";
const WEBID = `${ROOT}card#me`;

it.each([
  "https://docs.example/primary/",
  "https://primary.example/primary/",
])("creates documents in the selected pod while registering privately in %s", async (primary) => {
  const selected = `${ROOT}selected/`;
  const webId = "https://identity.example/alice#me";
  const profileUrl = "https://identity.example/alice";
  const preferences = `${primary}prefs.ttl`;
  const privateIndex = `${primary}private.ttl`;
  const publicIndex = `${primary}public.ttl`;
  const storage = createMemoryStorage({ root: selected });
  const profile = `<${webId}>
      <http://www.w3.org/ns/pim/space#storage> <${primary}>, <${selected}>;
      <http://www.w3.org/ns/pim/space#preferencesFile> <${preferences}>;
      <http://www.w3.org/ns/solid/terms#publicTypeIndex> <${publicIndex}>.`;
  const { fetch, calls } = mockFetch({
    [`GET ${profileUrl}`]: { body: profile },
    [`GET ${preferences}`]: {
      body: `<${webId}> <http://www.w3.org/ns/solid/terms#privateTypeIndex> <${privateIndex}>.`,
    },
    [`GET ${privateIndex}`]: { body: "", etag: '"private-v1"' },
    [`PUT ${privateIndex}`]: { status: 205 },
  });
  const transport = vi.fn(fetch);
  const store = createDocsStore({ podRoot: selected, webId, storage, fetchImpl: transport });
  const created = await store.create({ title: "Selected pod document" });
  expect(storage.isWithinStorage(created.url)).toBe(true);
  expect((await store.read(created.url))?.data.title).toBe("Selected pod document");
  const writes = calls.filter((call) => call.method !== "GET");
  expect(writes).toHaveLength(1);
  expect(writes[0]).toMatchObject({
    url: privateIndex,
    method: "PUT",
    headers: { "if-match": '"private-v1"', "content-type": "text/turtle" },
  });
  expect(
    new TypeIndexDataset(turtleToStore(writes[0]?.body ?? "", privateIndex), DataFactory).locate(
      DOCUMENT_CLASS,
    ),
  ).toEqual([{ forClass: DOCUMENT_CLASS, container: store.container, instance: undefined }]);
  expect(calls.map((call) => call.url)).toEqual([
    profileUrl,
    preferences,
    privateIndex,
    privateIndex,
  ]);
  expect(transport.mock.calls.every(([, init]) => init?.redirect === "manual")).toBe(true);
});

it.each([
  401, 403, 404, 500,
])("refuses document creation when another pod's preferences return %s", async (status) => {
  const primary = `${ROOT}primary/`;
  const selected = `${ROOT}selected/`;
  const preferences = `${primary}prefs.ttl`;
  const publicIndex = `${primary}public.ttl`;
  const storage = createMemoryStorage({ root: selected });
  const { fetch, calls } = mockFetch({
    [`GET ${WEBID.split("#")[0]}`]: {
      body: `<${WEBID}>
          <http://www.w3.org/ns/pim/space#storage> <${primary}>, <${selected}>;
          <http://www.w3.org/ns/pim/space#preferencesFile> <${preferences}>;
          <http://www.w3.org/ns/solid/terms#publicTypeIndex> <${publicIndex}>.`,
    },
    [`GET ${preferences}`]: { status },
  });
  const store = createDocsStore({ podRoot: selected, webId: WEBID, storage, fetchImpl: fetch });
  await expect(store.create({ title: "Must stay private" })).rejects.toMatchObject({ status });
  expect(calls.map((call) => call.url)).toEqual([WEBID.split("#")[0], preferences]);
  expect(await store.list()).toEqual([]);
});

it.each([
  "preferences",
  "index",
])("refuses an unadvertised sibling pod's %s before public registration", async (target) => {
  const primary = `${ROOT}primary/`;
  const selected = `${ROOT}selected/`;
  const foreign = `${ROOT}primary-evil/private.ttl`;
  const preferences = target === "preferences" ? foreign : `${primary}prefs.ttl`;
  const storage = createMemoryStorage({ root: selected });
  const { fetch, calls } = mockFetch({
    [`GET ${WEBID.split("#")[0]}`]: {
      body: `<${WEBID}>
          <http://www.w3.org/ns/pim/space#storage> <${primary}>, <${selected}>;
          <http://www.w3.org/ns/pim/space#preferencesFile> <${preferences}>;
          <http://www.w3.org/ns/solid/terms#publicTypeIndex> <${primary}public.ttl>.`,
    },
    [`GET ${primary}prefs.ttl`]: {
      body: `<${WEBID}> <http://www.w3.org/ns/solid/terms#privateTypeIndex> <${foreign}>.`,
    },
  });
  const store = createDocsStore({ podRoot: selected, webId: WEBID, storage, fetchImpl: fetch });
  await expect(store.create({ title: "Must stay private" })).rejects.toMatchObject({
    code: "scope",
  });
  expect(calls.some((call) => call.url === foreign || call.method !== "GET")).toBe(false);
  expect(await store.list()).toEqual([]);
});

it("keeps document registration private when the profile links its private index via preferences", async () => {
  const storage = createMemoryStorage({ root: ROOT });
  const settings = await storage.create(ROOT, null, { kind: "container", name: "settings" });
  const privateIndex = await storage.create(settings.url, "", {
    name: "private.ttl",
    contentType: "text/turtle",
  });
  const preferences = await storage.create(
    settings.url,
    `<${WEBID}> <http://www.w3.org/ns/solid/terms#privateTypeIndex> <${privateIndex.url}>.`,
    { name: "prefs.ttl", contentType: "text/turtle" },
  );
  const publicIndex = await storage.create(ROOT, "", {
    name: "public.ttl",
    contentType: "text/turtle",
  });
  const profile = await storage.create(
    ROOT,
    `<${WEBID}> <http://www.w3.org/ns/pim/space#preferencesFile> <${preferences.url}>;
      <http://www.w3.org/ns/solid/terms#publicTypeIndex> <${publicIndex.url}>.`,
    { name: "card", contentType: "text/turtle" },
  );
  const fetch = vi.fn<typeof globalThis.fetch>(async () => {
    throw new Error("Unexpected HTTP request");
  });
  const store = createDocsStore({ podRoot: ROOT, webId: WEBID, storage, fetchImpl: fetch });
  const created = await store.create({ title: "Private collection" });
  expect((await store.read(created.url))?.data.title).toBe("Private collection");
  const registered = await storage.readRdf(privateIndex.url);
  expect(new TypeIndexDataset(registered.dataset, DataFactory).locate(DOCUMENT_CLASS)).toEqual([
    { forClass: DOCUMENT_CLASS, container: store.container, instance: undefined },
  ]);
  expect((await storage.head(publicIndex.url)).etag).toBe(publicIndex.etag);
  expect(await (await storage.read(publicIndex.url)).text()).toBe("");
  await expect(
    discoverRegistrations(WEBID, (await storage.readRdf(profile.url)).dataset, fetch, storage),
  ).resolves.toEqual([
    { forClass: DOCUMENT_CLASS, container: store.container, instance: undefined },
  ]);
  expect(fetch).not.toHaveBeenCalled();
});

async function setup(protocol: "solid" | "lws") {
  const storage = createMemoryStorage({ protocol, root: ROOT, pageSize: 1 });
  if (protocol === "solid") {
    await storage.create(
      ROOT,
      `<${WEBID}> <http://www.w3.org/ns/solid/terms#privateTypeIndex> <${ROOT}index.ttl>.`,
      { name: "card", contentType: "text/turtle" },
    );
    await storage.create(ROOT, "", { name: "index.ttl", contentType: "text/turtle" });
  }
  const store = createDocsStore({ podRoot: ROOT, webId: WEBID, storage });
  return { storage, store };
}

describe.each(["solid", "lws"] as const)("Docs on memory %s", (protocol) => {
  it("creates, reads, saves with history, lists all pages and conditionally removes documents", async () => {
    const { storage, store } = await setup(protocol);
    const first = await store.create({
      title: "First",
      body: "one",
      creator: WEBID,
      now: new Date(0),
    });
    const second = await store.create({ title: "Second", body: "two" });
    const doc = await store.read(first.url);
    expect(doc?.data.body).toBe("one");
    expect(doc?.data.revisions[0]?.id).toBe(`${first.url}#rev-0`);
    const saved = await store.save(
      first.url,
      {
        title: "First",
        body: "updated",
        creator: doc?.data.creator,
        created: doc?.data.created,
        priorRevisions: doc?.data.revisions,
      },
      first.etag,
    );
    await expect(
      store.save(first.url, { title: "First", body: "lost" }, first.etag),
    ).rejects.toMatchObject({
      code: "precondition-failed",
    });
    await expect(store.save(first.url, { title: "First", body: "unsafe" })).rejects.toMatchObject({
      code: "precondition-required",
    });
    await expect(store.remove(first.url, first.etag)).rejects.toMatchObject({
      code: "precondition-failed",
    });
    const current = await store.read(first.url);
    expect(current?.data.body).toBe("updated");
    expect(current?.data.created).toBe(new Date(0).toISOString());
    expect(current?.data.revisions.map((r) => r.id)).toEqual([
      `${first.url}#rev-1`,
      `${first.url}#rev-0`,
    ]);
    await storage.create(store.container, "stray", { name: "stray", contentType: "text/plain" });
    await storage.create(store.container, null, { name: "sub", kind: "container" });
    expect((await store.list()).map((entry) => entry.url).sort()).toEqual(
      [first.url, second.url].sort(),
    );
    await store.remove(first.url, saved.etag);
    await store.remove(first.url); // idempotent even when parentOf needs a HEAD (LWS)
    await store.remove(second.url); // no prior validator: observe a fresh HEAD
    expect(await store.list()).toEqual([]);
    await expect(
      store.share(`${ROOT}other`, { agent: { public: true }, modes: ["read"] }),
    ).rejects.toThrow();
  });

  it("rejects resources outside the collection and forwards sharing capability failures", async () => {
    const { storage, store } = await setup(protocol);
    const created = await store.create({ title: "Shared" });
    const outside = await storage.create(ROOT, "other", {
      name: "other",
      contentType: "text/plain",
    });
    await expect(store.read(outside.url)).rejects.toBeInstanceOf(OutOfScopeError);
    await expect(store.read("https://foreign.example/private")).rejects.toBeInstanceOf(
      OutOfScopeError,
    );
    await expect(
      store.share(created.url, { agent: { public: true }, modes: ["read"] }),
    ).rejects.toMatchObject({ code: "unsupported" });
  });
});

it("binds new RDF to an unrelated server URL while preserving absolute authorship", async () => {
  const { storage } = await setup("lws");
  const collection = await storage.create(ROOT, null, { kind: "container", name: "collection" });
  const author = `${collection.url}person#me`;
  let assigned = "";
  const create = vi.fn<StorageClient["create"]>(async (_parent, body, opts) => {
    const result = await storage.create(ROOT, body, { ...opts, name: "server-selected" });
    assigned = result.url;
    return result;
  });
  const head: StorageClient["head"] = async (url, opts) => {
    const result = await storage.head(url, opts);
    return url === assigned ? { ...result, parent: collection.url } : result;
  };
  const store = createDocsStore({
    podRoot: ROOT,
    webId: WEBID,
    storage: { ...storage, create, head },
    container: collection.url,
  });
  const result = await store.create({ title: "Requested title", body: "body", creator: author });
  expect(result.url).toBe(`${ROOT}server-selected`);
  const doc = await store.read(result.url);
  expect(doc?.data.revisions[0]?.id).toBe(`${result.url}#rev-0`);
  expect(doc?.data.creator).toBe(author);
  expect(doc?.data.revisions[0]?.attributedTo).toBe(author);
  expect(create.mock.calls[0]?.[1]).toContain("<#it>");
});

it("checks LWS logical parentage and preserves a slashless collection identifier", async () => {
  const { storage } = await setup("lws");
  const created = await storage.create(ROOT, `<#it> a <${DOCUMENT_CLASS}>.`, {
    name: "unrelated-id",
    contentType: "text/turtle",
  });
  const opaque = `${ROOT}opaque`;
  const head = vi.fn<StorageClient["head"]>(async (url) => ({
    ...(await storage.head(url)),
    parent: opaque,
  }));
  const store = createDocsStore({
    podRoot: ROOT,
    webId: WEBID,
    storage: { ...storage, head },
    container: opaque,
  });
  expect(await store.read(created.url)).toBeDefined();
  expect(head).toHaveBeenCalledWith(created.url, { revalidate: true });
  head.mockImplementation(async (url) => ({ ...(await storage.head(url)), parent: ROOT }));
  await expect(store.read(created.url)).rejects.toBeInstanceOf(OutOfScopeError);
});

it("shares Solid documents through the advertised ACL with a conditional write", async () => {
  const { storage: memory, store: original } = await setup("solid");
  const file = await original.create({ title: "Share me" });
  const acl = await memory.create(ROOT, "", { name: "doc.acl", contentType: "text/turtle" });
  const storage: StorageClient = {
    ...memory,
    features: {
      ...memory.features,
      accessControl: { state: "available", detail: { model: "wac" }, evidence: "fixture" },
    },
    async head(url, opts) {
      return {
        ...(await memory.head(url, opts)),
        links: new Map([["acl", [{ target: acl.url, params: {} }]]]),
      };
    },
  };
  const store = createDocsStore({
    podRoot: ROOT,
    webId: WEBID,
    storage,
    container: original.container,
  });
  const grant = await store.share(file.url, { agent: { public: true }, modes: ["read"] });
  expect(grant.id).toContain(acl.url);
  expect(await (await memory.read(acl.url)).text()).toContain("http://xmlns.com/foaf/0.1/Agent");
});

it("propagates collection creation failures, refusing explicit missing containers", async () => {
  const { storage } = await setup("lws");
  const head = vi.fn<StorageClient["head"]>(async () => {
    throw new StorageError("forbidden", { url: ROOT, method: "HEAD", status: 403 });
  });
  const store = createDocsStore({ podRoot: ROOT, webId: WEBID, storage: { ...storage, head } });
  await expect(store.create({ title: "Denied" })).rejects.toMatchObject({ code: "forbidden" });
});

it("keeps missing validators and unsupported exact-name LWS RDF creation fail-closed", async () => {
  const { storage } = await setup("lws");
  expect(() => requireEtag("*", ROOT)).toThrow(StorageError);
  await expect(
    writeRdf(`${ROOT}new`, new Store(), { storage, createOnly: true }),
  ).rejects.toMatchObject({ code: "unsupported" });
  const file = await storage.create(ROOT, "file", { name: "file", contentType: "text/plain" });
  const head: StorageClient["head"] = async (url) => ({ ...(await storage.head(url)), etag: null });
  await expect(deleteRdf(file.url, undefined, { ...storage, head })).rejects.toMatchObject({
    code: "precondition-required",
  });
});

it("bootstraps a missing Solid settings container and index through SDK creates", async () => {
  const storage = createMemoryStorage({ root: ROOT });
  await storage.create(ROOT, `<${WEBID}> a <http://xmlns.com/foaf/0.1/Person>.`, {
    name: "card",
    contentType: "text/turtle",
  });
  const store = createDocsStore({ podRoot: ROOT, webId: WEBID, storage });
  const created = await store.create({ title: "First document" });
  expect((await store.read(created.url))?.data.title).toBe("First document");
  expect(await (await storage.read(`${ROOT}card`)).text()).toContain("privateTypeIndex");
  expect(await (await storage.read(`${ROOT}settings/privateTypeIndex.ttl`)).text()).toContain(
    store.container,
  );
});

it("refuses a missing explicitly selected collection instead of creating elsewhere", async () => {
  const { storage } = await setup("lws");
  const create = vi.fn(storage.create);
  const store = createDocsStore({
    podRoot: ROOT,
    webId: WEBID,
    storage: { ...storage, create },
    container: `${ROOT}selected`,
  });
  await expect(store.create({ title: "Fail" })).rejects.toMatchObject({ code: "not-found" });
  expect(create).not.toHaveBeenCalled();
});

it("single-flights initial collection creation for concurrent LWS document creates", async () => {
  const { storage } = await setup("lws");
  const create = vi.fn(storage.create);
  const store = createDocsStore({ podRoot: ROOT, webId: WEBID, storage: { ...storage, create } });
  const docs = await Promise.all([store.create({ title: "One" }), store.create({ title: "Two" })]);
  expect(new Set(docs.map((doc) => doc.url)).size).toBe(2);
  expect(create.mock.calls.filter((call) => call[2]?.kind === "container")).toHaveLength(1);
});

it("refuses a collection masquerading as a document in both protocols", async () => {
  for (const protocol of ["solid", "lws"] as const) {
    const { storage, store } = await setup(protocol);
    await store.create({ title: "Prepare" });
    const child = await storage.create(store.container, null, { kind: "container", name: "child" });
    await expect(store.remove(child.url)).rejects.toBeInstanceOf(OutOfScopeError);
  }
});

it("rejects same-origin resources outside the discovered storage root before reading", async () => {
  const root = `${ROOT}pod/`;
  const storage = createMemoryStorage({ protocol: "lws", root });
  const head = vi.fn(storage.head);
  const store = createDocsStore({ podRoot: root, webId: WEBID, storage: { ...storage, head } });
  await expect(store.read(`${ROOT}private`)).rejects.toBeInstanceOf(OutOfScopeError);
  expect(head).not.toHaveBeenCalled();
});

it("does not bootstrap an unreadable Solid settings container", async () => {
  const storage = createMemoryStorage({ root: ROOT });
  await storage.create(ROOT, `<${WEBID}> a <http://xmlns.com/foaf/0.1/Person>.`, {
    name: "card",
    contentType: "text/turtle",
  });
  const head: StorageClient["head"] = async (url, opts) => {
    if (url === `${ROOT}settings/`)
      throw new StorageError("forbidden", { url, method: "HEAD", status: 403 });
    return storage.head(url, opts);
  };
  const create = vi.fn(storage.create);
  const store = createDocsStore({
    podRoot: ROOT,
    webId: WEBID,
    storage: { ...storage, head, create },
  });
  await expect(store.create({ title: "Denied" })).rejects.toMatchObject({ code: "forbidden" });
  expect(create.mock.calls.every((call) => call[2]?.name !== "settings")).toBe(true);
});

describe.each(["not-found", "forbidden"] as const)("listing failures: %s", (code) => {
  it.each([
    true,
    false,
  ])("propagates a failed continuation page (empty first page=%s)", async (empty) => {
    const { storage, store: original } = await setup("lws");
    const doc = await original.create({ title: "Readable document" });
    const failure = new StorageError(code, {
      url: `${ROOT}cursor?opaque=1`,
      method: "GET",
      status: code === "not-found" ? 404 : 403,
    });
    const store = createDocsStore({
      podRoot: ROOT,
      webId: WEBID,
      container: original.container,
      storage: {
        ...storage,
        async *listAll() {
          if (!empty) {
            const entry = (await storage.list(original.container)).items.find(
              (e) => e.url === doc.url,
            );
            expect(entry).toBeDefined();
            yield entry as NonNullable<typeof entry>;
          }
          throw failure;
        },
      },
    });
    await expect(store.list()).rejects.toBe(failure);
  });
  it("returns empty only when the initial collection request fails", async () => {
    const { storage, store: original } = await setup("lws");
    const failure = new StorageError(code, { url: original.container, method: "GET" });
    const store = createDocsStore({
      podRoot: ROOT,
      webId: WEBID,
      storage: {
        ...storage,
        async *listAll() {
          yield* [];
          throw failure;
        },
      },
    });
    expect(await store.list()).toEqual([]);
  });
});
