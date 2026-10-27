// @vitest-environment jsdom
// AUTHORED-BY Codex
import { Blob as NodeBlob, File as NodeFile } from "node:buffer";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { SolidUpdateStore } from "@jeswr/y-solid";
import { generateJSON, getSchema, type JSONContent } from "@tiptap/react";
import { prosemirrorJSONToYDoc, yDocToProsemirrorJSON } from "@tiptap/y-tiptap";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { applyUpdate, Doc, encodeStateAsUpdate } from "yjs";
import { copyDocument } from "../src/apps/docs/editor/copy";
import { baseExtensions } from "../src/apps/docs/editor/extensions";
import { importDocument } from "../src/apps/docs/editor/import-document";
import { deleteDocument, restoreDocument } from "../src/apps/docs/editor/operations";
import { DocumentPersistence } from "../src/apps/docs/editor/persistence";
import {
  buildDocument,
  type DocsStore,
  type StoredDocument,
  writeRdf,
} from "../src/apps/docs/lib/model";
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
  return { pod, session, client };
}
async function replay(stored: StoredDocument, session: PodSession) {
  const doc = new Doc();
  for (const { update } of await new SolidUpdateStore({
    container: stored.data.updateLog as string,
    fetch: session.fetch,
  }).loadUpdates())
    applyUpdate(doc, update);
  return doc;
}
async function legacyDocument(store: DocsStore, session: PodSession, identity: string) {
  const stored = await store.create({
    title: "Legacy",
    body: "<p>Original</p>",
    format: "text/html",
  });
  const extensions = baseExtensions(session.fetch);
  const seed = prosemirrorJSONToYDoc(
    getSchema(extensions),
    generateJSON(stored.data.body, extensions),
  );
  if (identity === "log") seed.getMap("document").set("instanceId", stored.data.instanceId);
  await writeRdf(
    stored.url,
    buildDocument(stored.url, {
      ...stored.data,
      instanceId: identity === "snapshot" ? stored.data.instanceId : undefined,
    }),
    { etag: stored.etag, fetchImpl: session.fetch },
  );
  await new SolidUpdateStore({
    container: stored.data.updateLog as string,
    fetch: session.fetch,
  }).appendUpdate(encodeStateAsUpdate(seed));
  seed.destroy();
  return stored;
}

it.each([
  "DOCX",
  "Markdown",
])("imports %s through Upload and opens it in the editor", async (format) => {
  const { session, client } = await fixture();
  const file =
    format === "DOCX"
      ? new NodeFile([await readFile("e2e/fixtures/docs-import.docx")], "docs-import.docx")
      : new NodeFile(
          [
            '---\ntitle: "Launch plan"\n---\n# Plan\n\n- [x] Ready\n\n| Owner | Task |\n| --- | --- |\n| Alice | Review |\n\n**Bold** and ==highlighted==\n',
          ],
          "plan.md",
          { type: "text/markdown" },
        );
  const imported = await importDocument(file as unknown as File, session, vi.fn());
  expect(imported.skipped).toEqual(format === "DOCX" ? [{ label: "Footnotes", count: 1 }] : []);
  const runtime = client();
  await runtime.open(imported.url);
  expect(runtime.title).toBe(format === "DOCX" ? "docs-import" : "Launch plan");
  const content = yDocToProsemirrorJSON(runtime.doc) as JSONContent;
  expect(content.content?.map((node) => node.type)).toContain("heading");
  expect(content.content?.map((node) => node.type)).toContain("table");
  expect(JSON.stringify(content)).toContain("Alice");
  expect(runtime.doc.getMap("document").get("instanceId")).toBe(runtime.stored?.data.instanceId);
  const remote = await replay(runtime.stored as StoredDocument, session);
  try {
    expect(remote.getMap("document").get("instanceId")).toBe(runtime.stored?.data.instanceId);
    expect(yDocToProsemirrorJSON(remote)).toEqual(content);
  } finally {
    remote.destroy();
  }
});

it.each([
  "neither",
  "snapshot",
  "log",
])("opens a legacy document with identity in %s and claims it before editing", async (identity) => {
  const { session, client } = await fixture();
  const runtime = client();
  const stored = await legacyDocument(runtime.store, session, identity);
  const originalId = stored.data.instanceId;
  const before = await runtime.store.read(stored.url);
  await runtime.open(stored.url);
  expect(yDocToProsemirrorJSON(runtime.doc)).toMatchObject({
    content: [{ type: "paragraph", content: [{ text: "Original" }] }],
  });
  expect(runtime.stored?.data.instanceId).toEqual(expect.any(String));
  expect({ ...runtime.stored?.data, instanceId: undefined }).toEqual({
    ...before?.data,
    instanceId: undefined,
  });
  await runtime.forceSave();
  expect(runtime.state).toBe("saved");
  const saved = (await runtime.store.read(stored.url)) as StoredDocument;
  expect(saved.data.instanceId).toEqual(expect.any(String));
  if (identity !== "neither") expect(saved.data.instanceId).toBe(originalId);
  const remote = await replay(saved, session);
  try {
    expect(remote.getMap("document").get("instanceId")).toBe(saved.data.instanceId);
  } finally {
    remote.destroy();
  }
  await runtime.destroy();
  const reopened = client();
  await reopened.open(stored.url);
  expect(yDocToProsemirrorJSON(reopened.doc)).toEqual(yDocToProsemirrorJSON(runtime.doc));
});

it.each([
  "live",
  "cached",
])("keeps %s legacy edits in place when another session establishes identity", async (mode) => {
  const { session, client } = await fixture();
  const pending = client();
  const stored = await legacyDocument(pending.store, session, "neither");
  await pending.open(stored.url);
  // A second browser has its own durable cache of the same legacy document.
  const pendingDB = indexedDB;
  vi.stubGlobal("indexedDB", new IDBFactory());
  const migrating = client();
  await migrating.open(stored.url);
  pending.online = false;
  pending.provider?.destroy();
  pending.title = "Local title";
  pending.change(pending.body, yDocToProsemirrorJSON(pending.doc));
  await vi.waitFor(async () => expect(await pending.local?.get("pending")).toBe(1));
  if (mode === "cached") await pending.destroy();
  await migrating.forceSave();
  expect(migrating.stored?.data.instanceId).toEqual(expect.any(String));
  vi.stubGlobal("indexedDB", pendingDB);
  const resumed = mode === "cached" ? client() : pending;
  if (mode === "cached") await resumed.open(stored.url);
  resumed.online = true;
  await resumed.flush();
  expect(resumed.state).toBe("saved");
  expect(resumed.recoveredCopy).toBeUndefined();
  expect(resumed.stored?.url).toBe(stored.url);
  expect(resumed.stored?.data.title).toBe("Local title");
  expect(resumed.stored?.data.instanceId).toBe(migrating.stored?.data.instanceId);
});

it("keeps new, copied, recovered-edit and restored documents bound to their own logs", async () => {
  const { session, client } = await fixture();
  const original = client();
  await original.open();
  const extensions = baseExtensions(session.fetch);
  const json = generateJSON("<p>Original</p>", extensions);
  const seed = prosemirrorJSONToYDoc(getSchema(extensions), json);
  applyUpdate(original.doc, encodeStateAsUpdate(seed));
  seed.destroy();
  original.title = "Plan";
  original.change("<p>Original</p>", json);
  await original.flush();
  const stored = original.stored as StoredDocument;
  const check = async (document: StoredDocument) => {
    expect(document.data.instanceId).toEqual(expect.any(String));
    const replayed = await replay(document, session);
    try {
      expect(replayed.getMap("document").get("instanceId")).toBe(document.data.instanceId);
      const opened = client();
      await opened.open(document.url);
      expect(yDocToProsemirrorJSON(opened.doc)).toEqual(yDocToProsemirrorJSON(replayed));
    } finally {
      replayed.destroy();
    }
  };
  await check(stored);
  const copy = await copyDocument(original.store, stored, session, json);
  expect(copy.data.instanceId).not.toBe(stored.data.instanceId);
  await check(copy);

  original.online = false;
  original.provider?.destroy();
  original.title = "Offline title";
  original.change("<p>Original</p>", json);
  const recovered = client();
  await recovered.open(stored.url, true);
  expect(recovered.stored?.data.instanceId).toBe(stored.data.instanceId);
  await check(recovered.stored as StoredDocument);
  original.online = true;
  await original.flush();
  expect(original.recoveredCopy).toEqual(expect.any(String));
  const edits = (await original.store.read(original.recoveredCopy as string)) as StoredDocument;
  expect(edits.data.instanceId).not.toBe(stored.data.instanceId);
  await check(edits);

  const trashed = await deleteDocument(stored.url, session);
  expect(trashed.failed).toEqual([]);
  // Restoring beside a new occupant also exercises log relocation.
  await original.store.create({ title: "Plan", body: "<p>Replacement</p>" });
  const restored = await restoreDocument(trashed.done, session);
  expect(restored.failed).toEqual([]);
  const target = restored.done.find(({ entry }) => entry.original === stored.url)?.url as string;
  expect(target).not.toBe(stored.url);
  const restoredDocument = (await original.store.read(target)) as StoredDocument;
  expect(restoredDocument.data.instanceId).toBe(stored.data.instanceId);
  await check(restoredDocument);
});

it("establishes a legacy identity in both the recovered snapshot and its new log", async () => {
  const { session, client } = await fixture();
  const runtime = client();
  const stored = await legacyDocument(runtime.store, session, "neither");
  await runtime.open(stored.url, true);
  expect(runtime.stored?.data.instanceId).toEqual(expect.any(String));
  const remote = await replay(runtime.stored as StoredDocument, session);
  try {
    expect(remote.getMap("document").get("instanceId")).toBe(runtime.stored?.data.instanceId);
    const opened = client();
    await opened.open(stored.url);
    expect(yDocToProsemirrorJSON(opened.doc)).toEqual(yDocToProsemirrorJSON(remote));
  } finally {
    remote.destroy();
  }
});
