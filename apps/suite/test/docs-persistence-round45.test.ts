// @vitest-environment jsdom
// AUTHORED-BY Codex
import { Blob as NodeBlob } from "node:buffer";
import { createRequire } from "node:module";
import { generateHTML, type JSONContent } from "@tiptap/react";
import { yDocToProsemirrorJSON } from "@tiptap/y-tiptap";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { XmlElement, XmlText } from "yjs";
import { baseExtensions } from "../src/apps/docs/editor/extensions";
import { DocumentPersistence } from "../src/apps/docs/editor/persistence";
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
function broadcasts() {
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
}
function capture(runtime: DocumentPersistence) {
  const json = yDocToProsemirrorJSON(runtime.doc) as JSONContent;
  runtime.change(generateHTML(json, baseExtensions(runtime.session.fetch)), json);
}
function appendParagraph(runtime: DocumentPersistence, text: string) {
  const paragraph = new XmlElement("paragraph");
  const content = new XmlText();
  content.insert(0, text);
  paragraph.insert(0, [content]);
  runtime.doc.getXmlFragment("prosemirror").push([paragraph]);
  capture(runtime);
}
async function fixture() {
  const pod = createDemoPod({ root: DEMO_ROOT, seed: await buildDemoSeed(Date.now()) });
  let offline = false;
  const session: PodSession = {
    mode: "demo",
    storageUrl: DEMO_ROOT,
    webId: DEMO_WEBID,
    displayName: DEMO_NAME,
    fetch: (input, init) => {
      if (offline) return Promise.reject(new TypeError("offline"));
      return pod.fetch(input, init);
    },
    subscribe: pod.subscribe,
    reset: async () => {},
  };
  const client = () => {
    const runtime = new DocumentPersistence(session);
    runtimes.push(runtime);
    return runtime;
  };
  const original = client();
  await original.open();
  original.online = false;
  original.title = "Plan";
  appendParagraph(original, "Original");
  await original.reconnect();
  expect(original.state).toBe("saved");
  return {
    pod,
    session,
    client,
    original,
    url: original.stored?.url as string,
    offline: (value: boolean) => {
      offline = value;
    },
  };
}

it.each([
  { broadcast: true, keepMine: true },
  { broadcast: false, keepMine: false },
])("round45 competing pending renames survive offline navigation and reload ($broadcast; keep mine $keepMine)", async ({
  broadcast,
  keepMine,
}) => {
  if (broadcast) broadcasts();
  const { client, original: a, url, offline } = await fixture();
  const b = client();
  await b.open(url);
  await a.forceSave();
  await b.forceSave();
  offline(true);
  a.online = b.online = false;
  appendParagraph(b, "Body from B");
  await b.flush();
  a.stageTitle("Rename in A");
  await a.flush();
  b.stageTitle("Rename in B");
  await b.flush();
  // A rejected shared-slot write must have an equally durable fallback.
  expect(b.localState).toBe("saved");
  b.release();
  await b.destroy();
  await a.destroy();
  const reopened = client();
  await reopened.open(url);
  expect(reopened.body).toContain("Body from B");
  offline(false);
  for (let attempt = 0; attempt < 3 && !reopened.conflict; attempt++) await reopened.reconnect();
  expect(reopened.conflict?.localTitle).toBe("Rename in B");
  expect(reopened.conflict?.remoteTitle).toBe("Rename in A");
  expect((await reopened.store.read(url))?.data.body).toContain("Body from B");
  reopened.online = false;
  await reopened.destroy();
  const again = client();
  await again.open(url);
  expect(again.conflict?.localTitle).toBe("Rename in B");
  await again.resolveTitle(keepMine);
  expect(again.conflict).toBeUndefined();
  const chosen = keepMine ? "Rename in B" : "Rename in A";
  expect((await again.store.read(url))?.data.title).toBe(chosen);
  await again.destroy();
  const settled = client();
  await settled.open(url);
  await settled.reconnect();
  expect(settled.title).toBe(chosen);
  expect(settled.conflict).toBeUndefined();
});

it("round45 automatic compaction applies unseen device updates before later polls skip the merged resource", async () => {
  const { original: a, url, session } = await fixture();
  const b = new DocumentPersistence(session);
  runtimes.push(b);
  // A separate IndexedDB models the other device's lack of a shared browser cache.
  vi.stubGlobal("indexedDB", new IDBFactory());
  await b.open(url);
  appendParagraph(b, "Remote paragraph");
  await b.flush();
  expect(a.doc.getXmlFragment("prosemirror").toString()).not.toContain("Remote paragraph");
  const provider = a.provider as NonNullable<typeof a.provider>;
  const compact = vi.spyOn(provider, "compact");
  for (let index = 0; index < 200; index++) a.doc.getMap("counter").set("value", index);
  capture(a);
  await a.flush();
  await vi.waitFor(() => expect(compact).toHaveResolved());
  expect(a.doc.getXmlFragment("prosemirror").toString()).toContain("Remote paragraph");
  await a.reconnect();
  expect(a.doc.getXmlFragment("prosemirror").toString()).toContain("Remote paragraph");
  expect((await a.store.read(url))?.data.body).toContain("Remote paragraph");
});

it("round45 editing an adopted pending rename retains the earlier owner's intent", async () => {
  const { client, original: a, url, offline } = await fixture();
  offline(true);
  a.online = false;
  a.stageTitle("Rename in A");
  await a.flush();
  const b = client();
  await b.open(url);
  expect(b.title).toBe("Rename in A");
  b.stageTitle("Rename in B");
  await b.flush();
  await a.destroy();
  await b.destroy();
  const reopened = client();
  await reopened.open(url);
  offline(false);
  for (let attempt = 0; attempt < 3 && !reopened.conflict; attempt++) await reopened.reconnect();
  expect(reopened.conflict?.localTitle).toBe("Rename in B");
  expect(reopened.conflict?.remoteTitle).toBe("Rename in A");
});

it("round45 even single-resource compaction applies an unseen full state", async () => {
  const { original: a, url, session, pod } = await fixture();
  vi.stubGlobal("indexedDB", new IDBFactory());
  const b = new DocumentPersistence(session);
  runtimes.push(b);
  await b.open(url);
  appendParagraph(b, "Single remote paragraph");
  await b.flush();
  const full = await b.provider?.persistFullState();
  expect(full).toBeDefined();
  for (const resource of (await b.provider?.store.listUpdateUrls()) ?? [])
    if (resource !== full?.url) await pod.fetch(resource, { method: "DELETE" });
  expect(a.doc.getXmlFragment("prosemirror").toString()).not.toContain("Single remote paragraph");
  expect(await a.provider?.compact()).toBeUndefined();
  expect(a.doc.getXmlFragment("prosemirror").toString()).toContain("Single remote paragraph");
  expect(await a.provider?.sync()).toBe(0);
});
