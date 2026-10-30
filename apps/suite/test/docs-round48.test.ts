// @vitest-environment jsdom
// AUTHORED-BY Codex
import { Blob as NodeBlob } from "node:buffer";
import { createRequire } from "node:module";
import { SolidUpdateStore } from "@jeswr/y-solid";
import { generateHTML, getSchema, type JSONContent } from "@tiptap/react";
import { yDocToProsemirrorJSON } from "@tiptap/y-tiptap";
import { Packer } from "docx";
import { openArrayBuffer } from "mammoth/lib/zipfile";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { IndexeddbPersistence } from "y-indexeddb";
import {
  applyUpdate,
  Doc,
  encodeStateAsUpdate,
  encodeStateVector,
  mergeUpdates,
  XmlElement,
  XmlText,
} from "yjs";
import { listLocalDrafts } from "../src/apps/docs/editor/drafts";
import { rowExportJson } from "../src/apps/docs/editor/export-document";
import { baseExtensions } from "../src/apps/docs/editor/extensions";
import { hasUnconfirmedLocalState } from "../src/apps/docs/editor/local-state";
import { DocumentPersistence } from "../src/apps/docs/editor/persistence";
import { coversUpdates } from "../src/apps/docs/editor/update-coverage";
import { toDocx } from "../src/apps/docs/lib/convert/docx-export";
import { importDocx } from "../src/apps/docs/lib/convert/docx-import";
import { embeddedDocument } from "../src/apps/docs/lib/convert/docx-payload";
import { importMarkdown } from "../src/apps/docs/lib/convert/markdown";
import { importHtml } from "../src/apps/docs/lib/convert/schema";
import { buildDocument, writeRdf } from "../src/apps/docs/lib/model";
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
  vi.restoreAllMocks();
  for (const runtime of runtimes.splice(0)) {
    runtime.online = false;
    await runtime.destroy();
  }
  vi.unstubAllGlobals();
});
function capture(runtime: DocumentPersistence) {
  const json = yDocToProsemirrorJSON(runtime.doc) as JSONContent;
  runtime.change(generateHTML(json, baseExtensions(runtime.session.fetch)), json);
}
function append(runtime: DocumentPersistence, value: string) {
  const paragraph = new XmlElement("paragraph");
  const text = new XmlText();
  text.insert(0, value);
  paragraph.insert(0, [text]);
  runtime.doc.getXmlFragment("prosemirror").push([paragraph]);
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
  const original = client();
  await original.open();
  original.online = false;
  original.title = "Plan";
  append(original, "Original");
  await original.reconnect();
  expect(original.state).toBe("saved");
  return { session, client, original, url: original.stored?.url as string };
}
/** Let the real Yjs delta transaction commit while every pending write aborts. */
async function orphanEdit(runtime: DocumentPersistence, edit = () => append(runtime, "Offline")) {
  runtime.online = false;
  runtime.provider?.destroy();
  const database = runtime.local?.db as IDBDatabase;
  const transact = database.transaction.bind(database);
  const failing = vi.spyOn(database, "transaction").mockImplementation((names, mode, options) => {
    const transaction = transact(names, mode, options);
    if (mode === "readwrite" && transaction.objectStoreNames.contains("custom")) {
      const request = transaction.objectStore("custom").get("pending");
      request.onsuccess = () => transaction.abort();
    }
    return transaction;
  });
  edit();
  await runtime.flush();
  expect(runtime.localState).toBe("retrying");
  expect(Boolean(await runtime.local?.get("pending"))).toBe(false);
  await runtime.destroy();
  failing.mockRestore();
}
async function logText(runtime: DocumentPersistence) {
  const doc = new Doc();
  try {
    for (const { update } of await new SolidUpdateStore({
      container: runtime.stored?.data.updateLog as string,
      fetch: runtime.session.fetch,
    }).loadUpdates())
      applyUpdate(doc, update);
    return doc.getXmlFragment("prosemirror").toString();
  } finally {
    doc.destroy();
  }
}

it.each([
  "acknowledged",
  "legacy",
])("round48 %s unmarked offline deltas reach the pod log before Saved and survive a cleared cache", async (cache) => {
  const { original, client, url } = await fixture();
  if (cache === "legacy") await original.local?.del("confirmed");
  await orphanEdit(original);
  const reopened = client();
  await reopened.open(url);
  expect(reopened.doc.getXmlFragment("prosemirror").toString()).toContain("Offline");
  expect(reopened.state).not.toBe("saved");
  expect(reopened.body).toContain("Offline");
  await reopened.forceSave();
  expect(reopened.state).toBe("saved");
  expect(await logText(reopened)).toContain("Offline");
  await reopened.destroy();
  vi.stubGlobal("indexedDB", new IDBFactory());
  const clean = client();
  await clean.open(url);
  expect(clean.doc.getXmlFragment("prosemirror").toString()).toContain("Offline");
});

it("round48 row export retains unmarked deltas for the next editor save", async () => {
  const { original, client, session, url } = await fixture();
  await orphanEdit(original);
  expect(JSON.stringify(await rowExportJson(url, session))).toContain("Offline");
  const reopened = client();
  await reopened.open(url);
  await reopened.flush();
  expect(reopened.state).toBe("saved");
  expect(await logText(reopened)).toContain("Offline");
});

it("round48 newer pod updates advance an older mirror acknowledgement without false pending edits", async () => {
  const { original, client, url } = await fixture();
  original.online = false;
  await original.destroy();
  const previousDevice = indexedDB;
  vi.stubGlobal("indexedDB", new IDBFactory());
  const other = client();
  await other.open(url);
  append(other, "From another device");
  await other.flush();
  expect(other.state).toBe("saved");
  other.online = false;
  await other.destroy();
  vi.stubGlobal("indexedDB", previousDevice);
  const reopened = client();
  await reopened.open(url);
  expect(reopened.body).toContain("From another device");
  expect(reopened.state).toBe("saved");
});

it("round48 unmarked deletion-only deltas reach the pod log", async () => {
  const { original, client, url } = await fixture();
  await orphanEdit(original, () => {
    original.doc.getXmlFragment("prosemirror").delete(0, 1);
    capture(original);
  });
  const reopened = client();
  await reopened.open(url);
  expect(reopened.state).not.toBe("saved");
  await reopened.flush();
  expect(reopened.state).toBe("saved");
  expect(await logText(reopened)).not.toContain("Original");
});

it("round48 recovered body edits do not resurrect stale title intent", async () => {
  const { original, client, url } = await fixture();
  await orphanEdit(original);
  const store = client().store;
  await store.save(
    original.stored as NonNullable<typeof original.stored>,
    { title: "Remote" },
    {
      regenerate: () => ({ body: original.body, format: "text/html" }),
    },
  );
  const reopened = client();
  await reopened.open(url);
  expect(reopened.title).toBe("Remote");
  expect(reopened.conflict).toBeUndefined();
  await reopened.flush();
  expect(reopened.state).toBe("saved");
  expect(await logText(reopened)).toContain("Offline");
});

it("round48 unmarked dependent structs remain pending without their missing predecessors", async () => {
  const source = new Doc();
  const target = new Doc();
  const mirror = new IndexeddbPersistence("dependent-structs", target);
  try {
    await mirror.whenSynced;
    source.getText("text").insert(0, "First");
    const vector = encodeStateVector(source);
    source.getText("text").insert(5, "Second");
    const delta = encodeStateAsUpdate(source, vector);
    const database = mirror.db as IDBDatabase;
    await new Promise<void>((resolve) => {
      const transaction = database.transaction("updates", "readwrite");
      transaction.objectStore("updates").add(delta);
      transaction.oncomplete = () => resolve();
    });
    await mirror.set("pending", 0);
    const confirmed = encodeStateAsUpdate(target);
    await mirror.set("confirmed", Uint8Array.from(confirmed).buffer);
    expect(coversUpdates(confirmed, [delta])).toBe(false);
    expect(await hasUnconfirmedLocalState(mirror)).toBe(true);
  } finally {
    await mirror.destroy();
    source.destroy();
    target.destroy();
  }
});

it("round48 an active publisher recovers unmarked deltas in a retired log exactly once", async () => {
  const { original, client, url } = await fixture();
  const active = client();
  await active.open(url, true);
  await active.forceSave();
  await orphanEdit(original);
  await active.forceSave();
  expect(active.state).toBe("saved");
  expect(active.recoveredCopy).toBeDefined();
  const recovered = active.recoveredCopy as string;
  expect(JSON.stringify(await rowExportJson(recovered, active.session))).toContain("Offline");
  expect(await logText(active)).not.toContain("Offline");
  await active.forceSave();
  expect(active.recoveredCopy).toBe(recovered);
});

it("round48 draft discovery and promotion recover unmarked deltas", async () => {
  const { client, session } = await fixture();
  const draft = client();
  await draft.open();
  await orphanEdit(draft);
  expect(await listLocalDrafts(session.webId)).toContainEqual({
    id: draft.draftId,
    title: "Untitled document",
  });
  const reopened = client(draft.draftId);
  await reopened.open();
  expect(reopened.body).toContain("Offline");
  await reopened.reconnect();
  expect(reopened.state).toBe("saved");
  expect(await logText(reopened)).toContain("Offline");
});

it("round48 log acknowledgement tolerates equivalent uncollected deletion structs", () => {
  const doc = new Doc({ gc: false });
  try {
    doc.getText("text").insert(0, "Removed");
    const insert = encodeStateAsUpdate(doc);
    const vector = encodeStateVector(doc);
    doc.getText("text").delete(0, 7);
    const deletion = encodeStateAsUpdate(doc, vector);
    expect(coversUpdates(mergeUpdates([insert, deletion]), [insert, deletion])).toBe(true);
  } finally {
    doc.destroy();
  }
});

it("round48 edited DOCX fallback retains separators between marked Markdown soft lines", async () => {
  const original = importMarkdown("*First*\n**Second**\n\nFinal", "soft.md").json;
  const zip = await openArrayBuffer(await Packer.toArrayBuffer(await toDocx(original, vi.fn())));
  zip.write(
    "word/document.xml",
    (await zip.read("word/document.xml", "utf-8")).replace("Final", "Edited"),
  );
  expect(await embeddedDocument(zip)).toBeUndefined();
  const imported = await importDocx(await zip.toArrayBuffer(), {
    uploadImage: vi.fn(),
    progress: vi.fn(),
  });
  expect(imported.json).toBeUndefined();
  expect(imported.html).toContain("</em>\n<strong>");
  const json = importHtml(imported.html).json;
  expect(getSchema(baseExtensions(globalThis.fetch)).nodeFromJSON(json).textContent).toBe(
    "First SecondEdited",
  );
  expect(json.content?.[0]?.content).toEqual([
    { type: "text", marks: [{ type: "italic" }], text: "First" },
    { type: "text", text: " " },
    { type: "text", marks: [{ type: "bold" }], text: "Second" },
  ]);
});

it.each([
  " ",
  "\n",
  "\t",
  "\r\n",
])("round48 HTML import keeps the inline separator %j without adding block whitespace", (space) => {
  const imported = importHtml(`<p><em>First</em>${space}<strong>Second</strong></p>\n<p>Final</p>`);
  expect(imported.json.content).toHaveLength(2);
  expect(getSchema(baseExtensions(globalThis.fetch)).nodeFromJSON(imported.json).textContent).toBe(
    "First SecondFinal",
  );
  expect(importHtml("<pre><code>First\n  Second</code></pre>").json.content?.[0]?.content).toEqual([
    { type: "text", text: "First\n  Second" },
  ]);
});

it("round48 legacy HTML snapshot hydration preserves separators between marks", async () => {
  const { client, session } = await fixture();
  const runtime = client();
  const url = `${runtime.store.legacyContainer}soft.ttl`;
  await writeRdf(
    url,
    buildDocument(url, {
      title: "Legacy soft lines",
      body: "<p><em>First</em>\n<strong>Second</strong></p>",
    }),
    { fetchImpl: session.fetch, createOnly: true },
  );
  await runtime.open(url);
  expect(runtime.readOnly).toBe(true);
  expect(
    getSchema(baseExtensions(session.fetch)).nodeFromJSON(yDocToProsemirrorJSON(runtime.doc))
      .textContent,
  ).toBe("First Second");
});
