// @vitest-environment jsdom
// AUTHORED-BY Codex
import { Blob as NodeBlob, File as NodeFile } from "node:buffer";
import { createRequire } from "node:module";
import { SolidUpdateStore } from "@jeswr/y-solid";
import { yDocToProsemirrorJSON } from "@tiptap/y-tiptap";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { applyUpdate, Doc, encodeStateAsUpdate, XmlElement, XmlText } from "yjs";
import { copyDocument } from "../src/apps/docs/editor/copy";
import { rowExportJson } from "../src/apps/docs/editor/export-document";
import { importDocument } from "../src/apps/docs/editor/import-document";
import { deleteDocument, restoreDocument } from "../src/apps/docs/editor/operations";
import { DocumentPersistence } from "../src/apps/docs/editor/persistence";
import {
  buildDocument,
  createDocsStore,
  type StoredDocument,
  writeRdf,
} from "../src/apps/docs/lib/model";
import { createSolidDriveClient } from "../src/apps/drive/lib/client/client";
import { listTrash } from "../src/apps/drive/lib/operations/operations";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import { buildDemoSeed, DEMO_NAME, DEMO_ROOT, DEMO_WEBID } from "../src/lib/demo-pod/seed";
import type { PodSession } from "../src/lib/session/pod-session";

const { IDBFactory, IDBKeyRange: KeyRange } = createRequire(
  `${process.cwd()}/../../packages/solid-offline/package.json`,
)("fake-indexeddb") as { IDBFactory: new () => IDBFactory; IDBKeyRange: typeof IDBKeyRange };
const runtimes: DocumentPersistence[] = [];
beforeEach(() => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("IDBKeyRange", KeyRange);
  vi.stubGlobal("BroadcastChannel", undefined);
  vi.stubGlobal("Blob", NodeBlob);
});
afterEach(async () => {
  for (const runtime of runtimes.splice(0)) {
    runtime.online = false;
    await runtime.destroy();
  }
  vi.unstubAllGlobals();
});
const json = (text: string) => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});
function edit(runtime: DocumentPersistence, text: string) {
  const fragment = runtime.doc.getXmlFragment("prosemirror");
  fragment.delete(0, fragment.length);
  const paragraph = new XmlElement("paragraph");
  const content = new XmlText();
  content.insert(0, text);
  paragraph.insert(0, [content]);
  fragment.insert(0, [paragraph]);
  runtime.change(`<p>${text}</p>`, json(text));
}
async function fixture() {
  const pod = createDemoPod({ root: DEMO_ROOT, seed: await buildDemoSeed(Date.now()) });
  const session: PodSession = {
    mode: "demo",
    storageUrl: DEMO_ROOT,
    webId: DEMO_WEBID,
    displayName: DEMO_NAME,
    fetch: pod.fetch,
    subscribe: pod.subscribe,
    reset: async () => {},
  };
  const client = () => {
    const runtime = new DocumentPersistence(session);
    runtimes.push(runtime);
    return runtime;
  };
  const create = async (text: string, title = "Plan") => {
    const runtime = client();
    await runtime.open();
    runtime.title = title;
    edit(runtime, text);
    await runtime.flush();
    expect(runtime.state).toBe("saved");
    return runtime;
  };
  return { pod, session, client, create };
}
async function replay(stored: StoredDocument, session: PodSession) {
  const doc = new Doc();
  try {
    for (const { update } of await new SolidUpdateStore({
      container: stored.data.updateLog as string,
      fetch: session.fetch,
    }).loadUpdates())
      applyUpdate(doc, update);
    return yDocToProsemirrorJSON(doc);
  } finally {
    doc.destroy();
  }
}
async function retire(runtime: DocumentPersistence, session: PodSession) {
  runtime.online = false;
  runtime.provider?.destroy();
  const result = await deleteDocument(runtime.stored?.url as string, session);
  expect(result.failed).toEqual([]);
  return result.done;
}

it("imports a reused filename into an incarnation mirror without replaying the trashed body", async () => {
  const { session, client } = await fixture();
  const upload = (text: string) =>
    importDocument(new NodeFile([text], "plan.md") as unknown as File, session, vi.fn());
  const first = await upload("Deleted body");
  expect((await deleteDocument(first.url, session)).failed).toEqual([]);
  const second = await upload("Replacement body");
  expect(second.url).toBe(first.url);
  const stored = (await client().store.read(second.url)) as StoredDocument;
  expect(await replay(stored, session)).toEqual(json("Replacement body"));
  const opened = client();
  await opened.open(second.url);
  expect(yDocToProsemirrorJSON(opened.doc)).toEqual(json("Replacement body"));
});

it.each([
  true,
  false,
])("recovers edits when resolving a title conflict after replacement (keepMine=%s)", async (keepMine) => {
  const { session, client, create } = await fixture();
  const original = await create("Original body");
  const stored = original.stored as StoredDocument;
  original.online = false;
  original.provider?.destroy();
  original.title = "My title";
  edit(original, "My pending body");
  await original.store.save(
    stored,
    { title: "Their title" },
    {
      regenerate: () => ({ body: stored.data.body, format: "text/html" }),
    },
  );
  await original.reconnect();
  expect(original.conflict).toBeDefined();
  await retire(original, session);
  const replacement = await create("Replacement body");
  expect(replacement.stored?.url).toBe(stored.url);
  original.online = true;
  await original.resolveTitle(keepMine);
  expect(original.recoveredCopy).toBeDefined();
  expect((await client().store.read(original.recoveredCopy as string))?.data).toMatchObject({
    body: "<p>My pending body</p>",
    title: "Copy of Recovered edits — My title",
  });
  expect((await client().store.read(stored.url))?.data.body).toBe("<p>Replacement body</p>");
  expect(await replay(replacement.stored as StoredDocument, session)).toEqual(
    json("Replacement body"),
  );
});

it.each([
  "reconnect",
  "offline reload",
])("claims legacy identity before pending edits can cross into a replacement on %s", async (mode) => {
  const { session, client, create } = await fixture();
  const original = client();
  const stored = await original.store.create({ title: "Plan", body: "<p>Legacy body</p>" });
  await writeRdf(stored.url, buildDocument(stored.url, { ...stored.data, instanceId: undefined }), {
    etag: stored.etag,
    fetchImpl: session.fetch,
  });
  const seed = new Doc();
  const paragraph = new XmlElement("paragraph");
  const text = new XmlText();
  text.insert(0, "Legacy body");
  paragraph.insert(0, [text]);
  seed.getXmlFragment("prosemirror").insert(0, [paragraph]);
  await new SolidUpdateStore({
    container: stored.data.updateLog as string,
    fetch: session.fetch,
  }).appendUpdate(encodeStateAsUpdate(seed));
  seed.destroy();
  await original.open(stored.url);
  original.online = false;
  original.provider?.destroy();
  edit(original, "Offline legacy edits");
  await vi.waitFor(async () => expect(await original.local?.get("pending")).toBe(1));
  let resumed = original;
  if (mode === "offline reload") {
    await original.destroy();
    resumed = new DocumentPersistence({
      ...session,
      fetch: async () => {
        throw new TypeError("offline");
      },
    });
    runtimes.push(resumed);
    await resumed.open(stored.url);
    expect(yDocToProsemirrorJSON(resumed.doc)).toEqual(json("Offline legacy edits"));
    await resumed.destroy();
  }
  await retire(original, session);
  const replacement = await create("Replacement body");
  expect(replacement.stored?.url).toBe(stored.url);
  if (mode === "offline reload") {
    resumed = client();
    await resumed.open(stored.url);
  } else await resumed.reconnect();
  expect(resumed.recoveredCopy).toBeDefined();
  expect((await original.store.read(resumed.recoveredCopy as string))?.data.body).toBe(
    "<p>Offline legacy edits</p>",
  );
  expect((await original.store.read(stored.url))?.data.body).toBe("<p>Replacement body</p>");
  expect(await replay(replacement.stored as StoredDocument, session)).toEqual(
    json("Replacement body"),
  );
});

it("refuses a selected snapshot and companion from different recorded trash pairs at the same paths", async () => {
  const { session, create } = await fixture();
  const first = await create("First body");
  const firstTrash = await retire(first, session);
  const second = await create("Second body");
  const secondTrash = await retire(second, session);
  const snapshot = firstTrash.find((entry) => !entry.original.endsWith("/"));
  const companion = secondTrash.find((entry) => entry.original.endsWith("/"));
  if (!snapshot || !companion) throw new Error("Missing fixture pair");
  const restored = await restoreDocument([snapshot, companion], session);
  expect(restored.done).toEqual([]);
  expect(restored.failed).toHaveLength(2);
  const client = createSolidDriveClient({ storageUrl: session.storageUrl, fetch: session.fetch });
  expect(await listTrash(client, `${session.storageUrl}drive/`)).toHaveLength(4);
});

it("validates the remote incarnation before exporting a cached row", async () => {
  const { session, create } = await fixture();
  const original = await create("Deleted body");
  const url = original.stored?.url as string;
  await retire(original, session);
  // A second device cannot invalidate the first device's IndexedDB.
  const firstDB = indexedDB;
  vi.stubGlobal("indexedDB", new IDBFactory());
  const replacement = await create("Replacement body");
  expect(replacement.stored?.url).toBe(url);
  vi.stubGlobal("indexedDB", firstDB);
  expect(await rowExportJson(url, session)).toEqual(json("Replacement body"));
});

it("keeps a copied document at a reused slug separate from its deleted mirror", async () => {
  const { session, client, create } = await fixture();
  const original = await create("Original body");
  const copy = await copyDocument(original.store, original.stored as StoredDocument, session);
  const opened = client();
  await opened.open(copy.url);
  await retire(opened, session);
  original.online = false;
  original.provider?.destroy();
  edit(original, "New copy body");
  const replacement = await copyDocument(
    original.store,
    original.stored as StoredDocument,
    session,
    json("New copy body"),
  );
  expect(replacement.url).toBe(copy.url);
  const reopened = client();
  await reopened.open(replacement.url);
  expect(yDocToProsemirrorJSON(reopened.doc)).toEqual(json("New copy body"));
});

it("rejects a replaced copy reservation even when its derivation link matches", async () => {
  const { session, create } = await fixture();
  const original = await create("Original body");
  const source = original.stored as StoredDocument;
  let reservation: StoredDocument | undefined;
  await expect(
    copyDocument(original.store, source, session, undefined, {
      onReserved: async (copy) => {
        reservation = copy;
        throw new Error("Interrupted");
      },
    }),
  ).rejects.toThrow("Interrupted");
  if (!reservation) throw new Error("Missing reservation");
  expect((await deleteDocument(reservation.url, session)).failed).toEqual([]);
  const replacement = await original.store.create({
    title: "Plan copy",
    body: "<p>Replacement copy</p>",
    wasDerivedFrom: `${source.url}#it`,
  });
  expect(replacement.url).toBe(reservation.url);
  await expect(
    copyDocument(original.store, source, session, undefined, { reservation }),
  ).rejects.toThrow();
  expect(
    await new SolidUpdateStore({
      container: replacement.data.updateLog as string,
      fetch: session.fetch,
    }).loadUpdates(),
  ).toEqual([]);
  expect((await original.store.read(replacement.url))?.data.body).toBe("<p>Replacement copy</p>");
});

it.each([
  "identity only",
  "different body",
  "missing document",
  "still legacy",
  "write denied",
])("conditionally claims legacy identity across a concurrent %s change", async (change) => {
  const { session, client } = await fixture();
  const store = client().store;
  const created = await store.create({ title: "Legacy", body: "<p>Original</p>" });
  await writeRdf(
    created.url,
    buildDocument(created.url, { ...created.data, instanceId: undefined }),
    {
      etag: created.etag,
      fetchImpl: session.fetch,
    },
  );
  const legacy = (await store.read(created.url)) as StoredDocument;
  let intercepted = false;
  const racing = createDocsStore({
    podRoot: session.storageUrl,
    webId: session.webId,
    fetchImpl: async (input, init) => {
      if (!intercepted && String(input) === legacy.url && init?.method === "PUT") {
        intercepted = true;
        expect(new Headers(init.headers).get("if-match")).toBe(legacy.etag);
        if (change === "write denied") return new Response(null, { status: 403 });
        if (change === "missing document") {
          await session.fetch(legacy.url, {
            method: "PUT",
            body: "",
            headers: { "content-type": "text/turtle" },
          });
        } else {
          // Change only the identifier through the claim path, retaining history.
          if (change === "identity only") await store.claimIdentity(legacy, "other-tab");
          else
            await writeRdf(
              legacy.url,
              buildDocument(legacy.url, {
                ...legacy.data,
                body: change === "different body" ? "<p>Replacement</p>" : legacy.data.body,
                instanceId: change === "still legacy" ? undefined : "replacement",
              }),
              { etag: legacy.etag, fetchImpl: session.fetch },
            );
        }
        return new Response(null, { status: 412 });
      }
      return session.fetch(input, init);
    },
  });
  if (change === "identity only") {
    const claimed = await racing.claimIdentity(legacy, "this-tab");
    expect(claimed.data.instanceId).toBe("other-tab");
    expect(await store.claimIdentity(claimed, "ignored")).toEqual(claimed);
  } else await expect(racing.claimIdentity(legacy, "this-tab")).rejects.toThrow();
  expect(intercepted).toBe(true);
  if (change === "identity only")
    expect((await store.claimIdentity(legacy, "stale-tab")).data.instanceId).toBe("other-tab");
  else if (change !== "write denied")
    await expect(store.claimIdentity(legacy, "stale-tab")).rejects.toThrow();
});

it("joins a concurrent first-open identity claim before the claim read starts", async () => {
  const { session, client } = await fixture();
  const store = client().store;
  const created = await store.create({ title: "Legacy", body: "<p>Original</p>" });
  await writeRdf(
    created.url,
    buildDocument(created.url, { ...created.data, instanceId: undefined }),
    {
      etag: created.etag,
      fetchImpl: session.fetch,
    },
  );
  const legacy = (await store.read(created.url)) as StoredDocument;
  const first = await store.claimIdentity(legacy, "first-tab");
  const second = await store.claimIdentity(legacy, "second-tab");
  expect(second).toEqual(first);
});

it.each([
  undefined,
  "existing-log-id",
])("assigns legacy identity atomically on first save (%s)", async (instanceId) => {
  const { session, client } = await fixture();
  const store = client().store;
  const created = await store.create({ title: "Legacy", body: "<p>Original</p>" });
  await writeRdf(
    created.url,
    buildDocument(created.url, { ...created.data, instanceId: undefined }),
    {
      etag: created.etag,
      fetchImpl: session.fetch,
    },
  );
  const legacy = (await store.read(created.url)) as StoredDocument;
  const saved = await store.save(
    legacy,
    { body: "<p>Edited</p>", instanceId },
    {
      regenerate: () => ({ body: "<p>Edited</p>", format: "text/html" }),
    },
  );
  expect(saved.data.instanceId).toEqual(instanceId ?? expect.any(String));
  expect((await store.read(saved.url))?.data.body).toBe("<p>Edited</p>");
});

it("recovers edits when replacement races the conditional snapshot PUT", async () => {
  const { session, create } = await fixture();
  const original = await create("Original body");
  original.online = false;
  original.provider?.destroy();
  edit(original, "Pending body");
  let replacement: DocumentPersistence | undefined;
  const save = original.store.save.bind(original.store);
  vi.spyOn(original.store, "save").mockImplementationOnce(async (stored, input, options) => {
    await retire(original, session);
    replacement = await create("Replacement body");
    original.online = true;
    return save(stored, input, { ...options, wait: async () => {} });
  });
  original.online = true;
  await original.flush();
  expect(original.state).toBe("saved");
  expect(original.recoveredCopy).toBeDefined();
  expect((await original.store.read(original.recoveredCopy as string))?.data.body).toBe(
    "<p>Pending body</p>",
  );
  expect(await replay(replacement?.stored as StoredDocument, session)).toEqual(
    json("Replacement body"),
  );
});

it("refetches read-only legacy row content instead of merging a URL-only cache", async () => {
  const { session, client } = await fixture();
  const original = client();
  const url = `${original.store.legacyContainer}plan.ttl`;
  await writeRdf(url, buildDocument(url, { title: "Plan", body: "<p>Deleted body</p>" }), {
    createOnly: true,
    fetchImpl: session.fetch,
  });
  await original.open(url);
  expect(yDocToProsemirrorJSON(original.doc)).toEqual(json("Deleted body"));
  const stored = (await original.store.read(url)) as StoredDocument;
  await writeRdf(url, buildDocument(url, { title: "Plan", body: "<p>Replacement body</p>" }), {
    etag: stored.etag,
    fetchImpl: session.fetch,
  });
  expect(await rowExportJson(url, session)).toEqual(json("Replacement body"));
});

it("exports matching pending edits without acknowledging or saving an uncaptured snapshot", async () => {
  const { session, create } = await fixture();
  const original = await create("Original body");
  const stored = original.stored as StoredDocument;
  original.online = false;
  original.provider?.destroy();
  edit(original, "Pending body");
  await vi.waitFor(async () => expect(await original.local?.get("pending")).toBe(1));
  expect(await rowExportJson(stored.url, session)).toEqual(json("Pending body"));
  expect(await original.store.read(stored.url)).toEqual(stored);
  expect(await original.local?.get("pending")).toBe(1);
});

it.each([
  "empty",
  "corrupt",
])("recovers an identity-free snapshot when its retired log is %s", async (log) => {
  const { session, client } = await fixture();
  const runtime = client();
  const created = await runtime.store.create({ title: "Legacy", body: "<p>Saved body</p>" });
  await writeRdf(
    created.url,
    buildDocument(created.url, { ...created.data, instanceId: undefined }),
    {
      etag: created.etag,
      fetchImpl: session.fetch,
    },
  );
  if (log === "corrupt")
    await new SolidUpdateStore({
      container: created.data.updateLog as string,
      fetch: session.fetch,
    }).appendUpdate(new Uint8Array([255]));
  await runtime.open(created.url, true);
  expect(runtime.stored?.data.instanceId).toEqual(expect.any(String));
  expect(runtime.stored?.data.updateLog).not.toBe(created.data.updateLog);
  expect(await replay(runtime.stored as StoredDocument, session)).toEqual(json("Saved body"));
});

it("surfaces identity validation failures instead of exporting a stale offline cache", async () => {
  const { session, create } = await fixture();
  const original = await create("Original body");
  const stored = original.stored as StoredDocument;
  original.online = false;
  original.provider?.destroy();
  await writeRdf(
    stored.url,
    buildDocument(stored.url, {
      ...stored.data,
      instanceId: undefined,
      body: "<p>Replacement body</p>",
    }),
    { etag: stored.etag, fetchImpl: session.fetch },
  );
  await new SolidUpdateStore({
    container: stored.data.updateLog as string,
    fetch: session.fetch,
  }).appendUpdate(new Uint8Array([255]));
  await expect(rowExportJson(stored.url, session)).rejects.toThrow();
});
