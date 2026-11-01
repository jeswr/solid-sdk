// AUTHORED-BY Codex GPT-6.1-Sol
import type { StorageClient } from "@jeswr/storage-client";
import { StorageError } from "@jeswr/storage-client";
import { createMemoryStorage } from "@jeswr/storage-client/memory";
import { Store } from "n3";
import { describe, expect, it, vi } from "vitest";
import { OutOfScopeError } from "./errors.js";
import { deleteRdf, requireEtag, writeRdf } from "./rdf-io.js";
import { createDocsStore } from "./store.js";
import { DOCUMENT_CLASS } from "./vocab.js";

const ROOT = "https://docs.example/";
const WEBID = `${ROOT}card#me`;

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
