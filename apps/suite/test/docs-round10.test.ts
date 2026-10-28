// @vitest-environment jsdom
// AUTHORED-BY Codex
import { Blob as NodeBlob } from "node:buffer";
import { createRequire } from "node:module";
import { SolidUpdateStore } from "@jeswr/y-solid";
import { generateHTML, getSchema, type JSONContent } from "@tiptap/react";
import { prosemirrorJSONToYDoc, yDocToProsemirrorJSON } from "@tiptap/y-tiptap";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { IndexeddbPersistence, storeState } from "y-indexeddb";
import { applyUpdate, Doc, encodeStateAsUpdate, type XmlElement, type XmlText } from "yjs";
import { copyDocument } from "../src/apps/docs/editor/copy";
import { rowExportJson } from "../src/apps/docs/editor/export-document";
import { baseExtensions } from "../src/apps/docs/editor/extensions";
import { loadPersistedLocalState } from "../src/apps/docs/editor/local-state";
import * as mirrorMetadata from "../src/apps/docs/editor/mirror-metadata";
import { deleteDocument, restoreDocument } from "../src/apps/docs/editor/operations";
import { DocumentPersistence } from "../src/apps/docs/editor/persistence";
import type { StoredDocument } from "../src/apps/docs/lib/model";
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
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const json = (text: string): JSONContent => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});
function capture(runtime: DocumentPersistence) {
  const content = yDocToProsemirrorJSON(runtime.doc) as JSONContent;
  runtime.change(generateHTML(content, baseExtensions(runtime.session.fetch)), content);
}
function edit(runtime: DocumentPersistence, text: string) {
  const fragment = runtime.doc.getXmlFragment("prosemirror");
  fragment.delete(0, fragment.length);
  const seed = prosemirrorJSONToYDoc(getSchema(baseExtensions(runtime.session.fetch)), json(text));
  applyUpdate(runtime.doc, encodeStateAsUpdate(seed));
  seed.destroy();
  capture(runtime);
}
function append(runtime: DocumentPersistence, text: string) {
  const paragraph = runtime.doc.getXmlFragment("prosemirror").get(0) as XmlElement;
  const content = paragraph.get(0) as XmlText;
  content.insert(content.length, text);
  capture(runtime);
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
  const client = (draftId?: string) => {
    const runtime = new DocumentPersistence(session, draftId);
    runtimes.push(runtime);
    return runtime;
  };
  const create = async () => {
    const runtime = client();
    await runtime.open();
    runtime.title = "Plan";
    edit(runtime, "Original");
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

it.each([
  "reconnect",
  "flush",
  "unload",
])("%s promotes a shared draft with a closed offline tab's edits and redirects to the complete document", async (path) => {
  const { session, client } = await fixture();
  const first = client("shared");
  const second = client("shared");
  await first.open();
  await second.open();
  first.online = second.online = false;
  if (path === "reconnect") {
    first.title = "Plan";
    edit(first, "Text from tab A");
  }
  second.title = "Plan";
  edit(second, "Text from closed tab B");
  await vi.waitFor(async () => expect(await second.local?.get("pending")).toBe(1));
  await second.destroy();
  expect(JSON.stringify(yDocToProsemirrorJSON(first.doc))).not.toContain("closed tab B");
  first.online = true;
  if (path === "unload") await first.destroy();
  else if (path === "flush") await first.flush();
  else await first.reconnect();
  expect(first.state).toBe("saved");
  expect(first.stored?.data.body).toContain("Text from closed tab B");
  const content = yDocToProsemirrorJSON(first.doc);
  expect(JSON.stringify(content)).toContain("Text from closed tab B");
  expect(await replay(first.stored as StoredDocument, session)).toEqual(content);
  const reopened = client("shared");
  await reopened.open();
  expect(reopened.stored?.url).toBe(first.stored?.url);
  expect(yDocToProsemirrorJSON(reopened.doc)).toEqual(content);
});

it.each([
  true,
  false,
])("title-conflict resolution (keep mine=%s) merges a closed tab's persisted edits", async (keepMine) => {
  const { session, client, create } = await fixture();
  const first = await create();
  const source = first.stored as StoredDocument;
  const second = client();
  await second.open(source.url);
  first.online = second.online = false;
  first.provider?.destroy();
  second.provider?.destroy();
  first.rename("My title");
  await first.store.save(
    source,
    { title: "Remote title" },
    {
      regenerate: () => ({ body: source.data.body, format: "text/html" }),
    },
  );
  await first.reconnect();
  expect(first.conflict).toBeDefined();
  append(second, " from closed tab B");
  await second.destroy();
  await first.resolveTitle(keepMine);
  expect(first.state).toBe("saved");
  const saved = (await first.store.read(source.url)) as StoredDocument;
  expect(saved.data.title).toBe(keepMine ? "My title" : "Remote title");
  expect(saved.data.body).toContain("from closed tab B");
  expect(await replay(saved, session)).toEqual(json("Original from closed tab B"));
  expect(await first.local?.get("pending")).toBe(0);
});

it.each([
  "reconnect",
  "reload",
  "draft URL",
])("%s retains edits made in an offline tab after another tab promoted the draft", async (path) => {
  const { session, client } = await fixture();
  let first = client("late-draft");
  const second = client("late-draft");
  await first.open();
  await second.open();
  first.online = second.online = false;
  first.title = second.title = "Plan";
  edit(first, "From A");
  await first.reconnect();
  const source = first.stored as StoredDocument;
  first.online = false;
  first.provider?.destroy();
  edit(second, "Late offline tab B");
  await second.destroy();
  if (path !== "reconnect") {
    await first.destroy();
    first = client(path === "draft URL" ? "late-draft" : undefined);
    await first.open(path === "draft URL" ? undefined : source.url);
  }
  await first.reconnect();
  expect(first.state).toBe("saved");
  const saved = (await first.store.read(source.url)) as StoredDocument;
  expect(saved.data.body).toContain("Late offline tab B");
  expect(JSON.stringify(await replay(saved, session))).toContain("Late offline tab B");
});

it.each([
  "draft",
  "existing",
])("%s save includes a late tab update before acknowledging the shared mirror", async (kind) => {
  const { pod, session, client, create } = await fixture();
  const first = kind === "draft" ? client("shared-race") : await create();
  if (kind === "draft") await first.open();
  const second = client(kind === "draft" ? "shared-race" : undefined);
  await second.open(first.stored?.url);
  first.online = second.online = false;
  first.provider?.destroy();
  second.provider?.destroy();
  first.title = second.title = "Plan";
  if (kind === "draft") edit(first, "From tab A");
  else append(first, " from tab A");
  let arrived = false;
  vi.spyOn(session, "fetch").mockImplementation(async (input, init) => {
    if (!arrived && init?.method === "PUT" && String(input).includes("/updates/")) {
      arrived = true;
      if (kind === "draft") edit(second, "Late tab B");
      else append(second, " late tab B");
      await second.destroy();
    }
    return pod.fetch(input, init);
  });
  await first.reconnect();
  expect(arrived).toBe(true);
  expect(first.state).toBe("saved");
  const saved = (await first.store.read(first.stored?.url as string)) as StoredDocument;
  expect(saved.data.body.toLowerCase()).toContain("late tab b");
  expect(JSON.stringify(await replay(saved, session)).toLowerCase()).toContain("late tab b");
  expect(await first.local?.get("pending")).toBe(0);
  const reopened = client(kind === "draft" ? "shared-race" : undefined);
  await reopened.open(kind === "draft" ? undefined : saved.url);
  expect(yDocToProsemirrorJSON(reopened.doc)).toEqual(await replay(saved, session));
});

it.each([
  "insertion",
  "deletion",
])("retains a late %s until the pod covers the shared mirror at acknowledgement", async (change) => {
  const { session, client, create } = await fixture();
  const first = await create();
  const second = client();
  await second.open(first.stored?.url);
  first.online = second.online = false;
  first.provider?.destroy();
  second.provider?.destroy();
  append(first, " from A");
  const updateMetadata = mirrorMetadata.updateMirrorMetadata;
  let arrived = false;
  let refused = false;
  vi.spyOn(mirrorMetadata, "updateMirrorMetadata").mockImplementation(
    async (mirror, update, active, confirmed) => {
      let injecting = false;
      if (confirmed && !arrived && mirror.name === first.local?.name) {
        arrived = injecting = true;
        if (change === "insertion") append(second, " from B");
        else {
          const paragraph = second.doc.getXmlFragment("prosemirror").get(0) as XmlElement;
          (paragraph.get(0) as XmlText).delete(0, 1);
          capture(second);
        }
        await second.destroy();
      }
      const cleared = await updateMetadata(mirror, update, active, confirmed);
      if (injecting) refused = !cleared;
      return cleared;
    },
  );
  await first.reconnect();
  expect(arrived).toBe(true);
  expect(refused).toBe(true);
  expect(first.state).toBe("saved");
  const saved = (await first.store.read(first.stored?.url as string)) as StoredDocument;
  const content = JSON.stringify(await replay(saved, session));
  if (change === "insertion") expect(content).toContain("from B");
  else expect(content).toContain("riginal");
  expect(content).toContain("from A");
  expect(saved.data.body).toBe(first.body);
  expect(await first.local?.get("pending")).toBe(0);
});

it("loads all mirror updates even after another tab compacts below this tab's read cursor", async () => {
  const docA = new Doc();
  docA.getText("text").insert(0, "Original");
  const mirrorA = new IndexeddbPersistence("compacted", docA);
  const docB = new Doc();
  const mirrorB = new IndexeddbPersistence("compacted", docB);
  try {
    await Promise.all([mirrorA.whenSynced, mirrorB.whenSynced]);
    await storeState(mirrorA, true);
    await storeState(mirrorB, true);
    docB.getText("text").delete(0, 1);
    await storeState(mirrorB, true);
    // Simulate a replacement/compaction of the persisted key range. The
    // provider's incremental cursor must not limit a publisher's read.
    const db = mirrorB.db as IDBDatabase;
    await new Promise<void>((resolve) => {
      const tx = db.transaction("updates", "readwrite");
      tx.objectStore("updates").clear();
      tx.objectStore("updates").put(encodeStateAsUpdate(docB), 1);
      tx.oncomplete = () => resolve();
    });
    expect(docA.getText("text").toString()).toBe("Original");
    expect(await loadPersistedLocalState(docA, mirrorA)).toBe(true);
    expect(docA.getText("text").toString()).toBe("riginal");
  } finally {
    await mirrorA.destroy();
    await mirrorB.destroy();
    docA.destroy();
    docB.destroy();
  }
});

it("cross-tab notifications hydrate open offline tabs and stop listening on close", async () => {
  const channels = new Set<Channel>();
  class Channel {
    onmessage: (() => void) | null = null;
    constructor(readonly name: string) {
      channels.add(this);
    }
    postMessage() {
      for (const channel of channels)
        if (channel !== this && channel.name === this.name)
          queueMicrotask(() => channel.onmessage?.());
    }
    close() {
      this.onmessage = null;
      channels.delete(this);
    }
  }
  vi.stubGlobal("BroadcastChannel", Channel);
  const { client, create } = await fixture();
  const first = await create();
  const second = client();
  await second.open(first.stored?.url);
  first.online = second.online = false;
  first.provider?.destroy();
  second.provider?.destroy();
  append(second, " live from B");
  await vi.waitFor(() =>
    expect(yDocToProsemirrorJSON(first.doc)).toEqual(json("Original live from B")),
  );
  expect(first.body).toBe("<p>Original live from B</p>");
  await second.destroy();
  await first.reconnect();
  expect(first.stored?.data.body).toBe("<p>Original live from B</p>");
  first.online = false;
  await first.destroy();
  expect(channels.size).toBe(0);
});

it("exports and copies the full update log after restoring a document with a stale snapshot", async () => {
  const { session, client, create } = await fixture();
  const original = await create();
  const source = original.stored as StoredDocument;
  append(original, " durable log text");
  await original.provider?.flush();
  original.online = false;
  await original.destroy();
  expect((await original.store.read(source.url))?.data.body).toBe("<p>Original</p>");
  const trashed = await deleteDocument(source.url, session);
  expect(trashed.failed).toEqual([]);
  expect((await restoreDocument(trashed.done, session)).failed).toEqual([]);
  expect(await rowExportJson(source.url, session)).toEqual(json("Original durable log text"));
  const stale = (await original.store.read(source.url)) as StoredDocument;
  const copy = await copyDocument(client().store, stale, session);
  expect(copy.data.body).toBe("<p>Original durable log text</p>");
  expect(await replay(copy, session)).toEqual(json("Original durable log text"));
});

it.each([
  "reconnect",
  "flush",
  "unload",
])("%s publishes a closed offline tab's edits from the shared incarnation mirror", async (path) => {
  const { session, client, create } = await fixture();
  const first = await create();
  const source = first.stored as StoredDocument;
  const second = client();
  await second.open(source.url);
  first.online = second.online = false;
  first.provider?.destroy();
  second.provider?.destroy();
  append(second, " updated text from B");
  await vi.waitFor(async () => expect(await second.local?.get("pending")).toBe(1));
  await second.destroy();
  expect(yDocToProsemirrorJSON(first.doc)).toEqual(json("Original"));
  first.online = true;
  if (path === "unload") await first.destroy();
  else if (path === "flush") await first.flush();
  else await first.reconnect();
  const stored = (await first.store.read(source.url)) as StoredDocument;
  expect(stored.data.body).toBe("<p>Original updated text from B</p>");
  expect(await replay(stored, session)).toEqual(json("Original updated text from B"));
  const reopened = client();
  await reopened.open(source.url);
  expect(await reopened.local?.get("pending")).toBe(0);
  expect(reopened.state).toBe("saved");
});

it("list copying replays a durable edit whose snapshot PUT failed", async () => {
  const { pod, session, client, create } = await fixture();
  const original = await create();
  const source = original.stored as StoredDocument;
  const failure = vi
    .spyOn(session, "fetch")
    .mockImplementation((input, init) =>
      String(input) === source.url && init?.method === "PUT"
        ? Promise.resolve(new Response(null, { status: 503 }))
        : pod.fetch(input, init),
    );
  append(original, " updated text");
  await original.provider?.flush();
  await original.flush();
  expect(original.state).toBe("retrying");
  original.online = false;
  await original.destroy();
  failure.mockRestore();
  const store = client().store;
  const stale = (await store.read(source.url)) as StoredDocument;
  expect(stale.data.body).toBe("<p>Original</p>");
  expect(await replay(stale, session)).toEqual(json("Original updated text"));
  const copy = await copyDocument(store, stale, session);
  expect(copy.data.body).toBe("<p>Original updated text</p>");
  expect(await replay(copy, session)).toEqual(json("Original updated text"));
  expect(await rowExportJson(source.url, session)).toEqual(json("Original updated text"));
});
