// AUTHORED-BY Codex GPT-6.1-Sol
// @vitest-environment jsdom
import { Blob as NodeBlob } from "node:buffer";
import { createRequire } from "node:module";
import { SolidUpdateStore } from "@jeswr/y-solid";
import { getSchema, type JSONContent } from "@tiptap/react";
import {
  prosemirrorJSONToYDoc,
  prosemirrorToYXmlFragment,
  yDocToProsemirrorJSON,
} from "@tiptap/y-tiptap";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { encodeStateAsUpdate } from "yjs";
import { copyDocument } from "../src/apps/docs/editor/copy";
import { baseExtensions } from "../src/apps/docs/editor/extensions";
import { deleteDocument, deleteForever, restoreDocument } from "../src/apps/docs/editor/operations";
import { DocumentPersistence } from "../src/apps/docs/editor/persistence";
import { createDocsStore, docContainerUrls } from "../src/apps/docs/lib/model";
import { type DocumentVersion, DocumentVersionStore } from "../src/apps/docs/lib/model/versions";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import { buildDemoSeed, DEMO_ROOT, DEMO_WEBID } from "../src/lib/demo-pod/seed";
import type { PodSession } from "../src/lib/session/pod-session";

const { IDBFactory, IDBKeyRange: KeyRange } = createRequire(
  `${process.cwd()}/../../packages/solid-offline/package.json`,
)("fake-indexeddb") as { IDBFactory: new () => IDBFactory; IDBKeyRange: typeof IDBKeyRange };
beforeEach(() => {
  vi.stubGlobal("Blob", NodeBlob);
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("IDBKeyRange", KeyRange);
});
afterEach(() => vi.unstubAllGlobals());
async function fixture() {
  const pod = createDemoPod({ root: DEMO_ROOT, seed: await buildDemoSeed(Date.now()) });
  const session = { storageUrl: DEMO_ROOT, webId: DEMO_WEBID, fetch: pod.fetch } as PodSession;
  const store = createDocsStore({ podRoot: DEMO_ROOT, webId: DEMO_WEBID, fetchImpl: pod.fetch });
  const original = await store.create({ title: "History" });
  const layout = docContainerUrls(original.url);
  const src = `${layout.assets}old-image.png`;
  await pod.fetch(src, {
    method: "PUT",
    headers: { "content-type": "image/png" },
    body: "old image",
  });
  const json: JSONContent = {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "Old content" }] },
      { type: "image", attrs: { src } },
    ],
  };
  const doc = prosemirrorJSONToYDoc(getSchema(baseExtensions(pod.fetch)), json);
  doc.getMap("document").set("instanceId", original.data.instanceId);
  await new SolidUpdateStore({ container: layout.updateLog, fetch: pod.fetch }).appendUpdate(
    encodeStateAsUpdate(doc),
  );
  const versions = new DocumentVersionStore(layout.versions, pod.fetch);
  await versions.create(doc, { kind: "named", name: "First draft", creator: DEMO_WEBID });
  await versions.create(doc, { kind: "automatic" });
  doc.destroy();
  return { pod, session, store, original, layout, src, versions };
}
it("copies named and automatic snapshots, including historical assets, into the copy's identity", async () => {
  const { pod, session, store, original, versions, src } = await fixture();
  const copy = await copyDocument(store, original, session, {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "New content without image" }] },
    ],
  });
  const history = new DocumentVersionStore(docContainerUrls(copy.url).versions, pod.fetch);
  const rows = await history.list();
  expect(rows).toHaveLength(2);
  expect(rows.map((row) => row.kind).sort()).toEqual(["automatic", "named"]);
  expect(rows.find((row) => row.kind === "named")).toMatchObject({
    name: "First draft",
    creator: DEMO_WEBID,
  });
  for (const row of rows) {
    const snapshot = await history.load(row, copy.data.instanceId as string);
    const replay = JSON.stringify(yDocToProsemirrorJSON(snapshot));
    expect(replay).toContain("Old content");
    expect(replay).toContain(`${copy.data.assets}old-image.png`);
    expect(replay).not.toContain(src);
    snapshot.destroy();
  }
  expect(await (await pod.fetch(`${copy.data.assets}old-image.png`)).text()).toBe("old image");
  expect(await versions.list()).toHaveLength(2);
});
it("moves versions with trash, relocates metadata/binary asset links on renamed restore, and permanently deletes them", async () => {
  const { pod, session, store, original, versions, layout } = await fixture();
  const before = await versions.list();
  await pod.fetch(`${layout.versions}orphan.bin`, {
    method: "PUT",
    headers: { "content-type": "application/octet-stream" },
    body: "unrecognised snapshot",
  });
  const trashed = await deleteDocument(original.url, session);
  expect(trashed.failed).toEqual([]);
  expect((await pod.fetch(before[0]?.snapshot as string)).status).toBe(404);
  const replacement = await store.create({ title: "History" });
  expect(replacement.url).toBe(original.url);
  const restored = await restoreDocument(trashed.done, session);
  expect(restored.failed).toEqual([]);
  const target = restored.done.find((item) => item.url.endsWith(".ttl"))?.url as string;
  expect(target).not.toBe(original.url);
  const after = docContainerUrls(target);
  const history = new DocumentVersionStore(after.versions, pod.fetch);
  const rows = await history.list();
  expect(rows).toHaveLength(2);
  expect(await (await pod.fetch(`${after.versions}orphan.bin`)).text()).toBe(
    "unrecognised snapshot",
  );
  for (const row of rows) {
    expect(row.snapshot.startsWith(after.versions)).toBe(true);
    const snapshot = await history.load(row, original.data.instanceId as string);
    const replay = JSON.stringify(yDocToProsemirrorJSON(snapshot));
    expect(replay).toContain(`${after.assets}old-image.png`);
    expect(replay).not.toContain(layout.assets);
    snapshot.destroy();
  }
  const discarded = await deleteDocument(target, session);
  expect(discarded.failed).toEqual([]);
  const removed = await deleteForever(discarded.done, session, true);
  expect(removed.failed).toEqual([]);
  const companion = discarded.done.find((entry) => entry.url.endsWith("/"));
  expect((await pod.fetch(`${companion?.url}versions/`)).status).toBe(404);
});
it("copies and trashes old documents with no versions container", async () => {
  const { pod, store, session, original, versions } = await fixture();
  for (const row of await versions.list())
    for (const url of [row.snapshot, row.url]) await pod.fetch(url, { method: "DELETE" });
  await pod.fetch(versions.container, { method: "DELETE" });
  const copy = await copyDocument(store, original, session);
  expect(
    await new DocumentVersionStore(docContainerUrls(copy.url).versions, pod.fetch).list(),
  ).toEqual([]);
  const result = await deleteDocument(original.url, session);
  expect(result.failed).toEqual([]);
  const restored = await restoreDocument(result.done, session);
  expect(restored.failed).toEqual([]);
});

it.each([
  false,
  true,
])("runs automatic history only after saving, without blocking save on denied history (%s)", async (denied) => {
  const { pod, session, original, versions, layout } = await fixture();
  for (const row of await versions.list())
    for (const url of [row.snapshot, row.url]) await pod.fetch(url, { method: "DELETE" });
  const http: typeof fetch = (input, init) =>
    denied && String(input).startsWith(layout.versions)
      ? Promise.resolve(new Response(null, { status: 403 }))
      : pod.fetch(input, init);
  const account = {
    ...session,
    fetch: http,
    displayName: "Alice",
    mode: "demo",
    subscribe: pod.subscribe,
    reset: async () => {},
  } as PodSession;
  const log = vi.spyOn(console, "warn").mockImplementation(() => {});
  const runtime = new DocumentPersistence(account);
  try {
    await runtime.open(original.url);
    const json: JSONContent = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Saved automatic content" }] },
      ],
    };
    prosemirrorToYXmlFragment(
      getSchema(baseExtensions(http)).nodeFromJSON(json),
      runtime.doc.getXmlFragment("prosemirror"),
    );
    runtime.change("<p>Saved automatic content</p>", json);
    await runtime.flush();
    expect(runtime.state).toBe("saved");
    if (denied)
      await vi.waitFor(() =>
        expect(log).toHaveBeenCalledWith("Automatic document version failed", expect.any(Error)),
      );
    else {
      await vi.waitFor(async () => expect(await versions.list()).toHaveLength(1));
      const row = (await versions.list())[0];
      expect(row?.kind).toBe("automatic");
      const snapshot = await versions.load(
        row as NonNullable<typeof row>,
        original.data.instanceId as string,
      );
      expect(JSON.stringify(yDocToProsemirrorJSON(snapshot))).toContain("Saved automatic content");
      snapshot.destroy();
    }
  } finally {
    await runtime.destroy();
    log.mockRestore();
  }
});

it("recovers the retired document's archived versions instead of a replacement's history", async () => {
  const { pod, session, store, original, versions } = await fixture();
  const rows = await versions.list();
  const trashed = await deleteDocument(original.url, session);
  expect(trashed.failed).toEqual([]);
  const tree = trashed.done.find((entry) => entry.url.endsWith("/"))?.url as string;
  const metadata = `${tree}versions/${new URL(rows[0]?.url as string).pathname.split("/").at(-1)}`;
  const archived = await (await pod.fetch(metadata)).text();
  const replacement = await store.create({ title: "History" });
  expect(replacement.url).toBe(original.url);
  const doc = prosemirrorJSONToYDoc(getSchema(baseExtensions(pod.fetch)), {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: "Unrelated replacement" }] }],
  });
  doc.getMap("document").set("instanceId", replacement.data.instanceId);
  await versions.create(doc, { kind: "named", name: "Replacement history" });
  doc.destroy();
  const copy = await copyDocument(
    store,
    original,
    session,
    {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Offline edits" }] }],
    },
    { recovery: { update: undefined, onUpdate: async () => {} } },
  );
  const history = new DocumentVersionStore(docContainerUrls(copy.url).versions, pod.fetch);
  const copied = await history.list();
  expect(copied).toHaveLength(2);
  expect(copied.some((row) => row.name === "Replacement history")).toBe(false);
  expect(copied.some((row) => row.name === "First draft")).toBe(true);
  for (const row of copied) {
    const snapshot = await history.load(row, copy.data.instanceId as string);
    expect(JSON.stringify(yDocToProsemirrorJSON(snapshot))).toContain("Old content");
    snapshot.destroy();
  }
  expect(await (await pod.fetch(metadata)).text()).toBe(archived);
});

// AUTHORED-BY Claude Opus 5.5
it("copies past unreadable versions and turns a deleted history-only image into a placeholder", async () => {
  const { pod, session, store, original, versions, src, layout } = await fixture();
  const [newest] = await versions.list();
  // A corrupt snapshot must not block the copy; the other version still copies.
  await pod.fetch((newest as NonNullable<typeof newest>).snapshot, {
    method: "PUT",
    headers: { "content-type": "application/octet-stream" },
    body: new Uint8Array([255]),
  });
  await pod.fetch(src, { method: "DELETE" });
  const log = vi.spyOn(console, "warn").mockImplementation(() => {});
  const copy = await copyDocument(store, original, session, {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: "Current text" }] }],
  });
  const history = new DocumentVersionStore(docContainerUrls(copy.url).versions, pod.fetch);
  const rows = await history.list();
  expect(rows).toHaveLength(1);
  const snapshot = await history.load(rows[0] as DocumentVersion, copy.data.instanceId as string);
  const replay = JSON.stringify(yDocToProsemirrorJSON(snapshot));
  expect(replay).toContain("Old content");
  expect(replay).toContain("[Image unavailable]");
  snapshot.destroy();
  expect(log).toHaveBeenCalledWith(
    "Skipped an unreadable version while copying",
    expect.any(Error),
  );
  // An unreadable history listing is skipped the same way.
  const denied: typeof fetch = (input, init) =>
    String(input) === layout.versions
      ? Promise.resolve(new Response(null, { status: 500 }))
      : pod.fetch(input, init);
  const second = await copyDocument(
    store,
    original,
    { ...session, fetch: denied },
    {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Current text" }] }],
    },
  );
  expect(
    await new DocumentVersionStore(docContainerUrls(second.url).versions, pod.fetch).list(),
  ).toEqual([]);
  log.mockRestore();
});
