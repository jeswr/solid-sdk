// @vitest-environment jsdom
// AUTHORED-BY Codex
import { Blob as NodeBlob } from "node:buffer";
import { createRequire } from "node:module";
import { SolidUpdateStore } from "@jeswr/y-solid";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { applyUpdate, Doc, XmlElement, XmlText } from "yjs";
import { deleteDocument } from "../src/apps/docs/editor/operations";
import { DocumentPersistence } from "../src/apps/docs/editor/persistence";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import { buildDemoSeed, DEMO_NAME, DEMO_ROOT, DEMO_WEBID } from "../src/lib/demo-pod/seed";
import type { PodSession } from "../src/lib/session/pod-session";

// Exercise the real y-indexeddb provider using the workspace's installed fixture.
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
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.destroy()));
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
  const original = client();
  await original.open();
  original.title = "Plan";
  edit(original, "Original");
  await original.flush();
  const stored = original.stored;
  if (!stored) throw new Error("Missing fixture");
  original.online = false;
  original.provider?.destroy();
  edit(original, "Offline body");
  await vi.waitFor(async () => expect(await original.local?.get("pending")).toBe(1));
  await original.destroy();
  return { original, stored, client, session };
}
it("reopens real IndexedDB body-only pending edits under the remote title", async () => {
  const { original, stored, client } = await fixture();
  await original.store.save(
    stored,
    { title: "Remote title" },
    { regenerate: () => ({ body: stored.data.body, format: "text/html" }) },
  );
  const opening = client();
  await opening.open(stored.url);
  expect(opening.conflict).toBeUndefined();
  expect(opening.title).toBe("Remote title");
  opening.capture("<p>Offline body</p>", json("Offline body"));
  await opening.flush();
  expect(opening.state).toBe("saved");
  expect(opening.stored?.data).toMatchObject({
    title: "Remote title",
    body: "<p>Offline body</p>",
  });
  expect(await opening.local?.get("pending")).toBe(0);
});
it("recovers real IndexedDB edits after the snapshot and log URLs are reused", async () => {
  const { original, stored, client, session } = await fixture();
  expect((await deleteDocument(stored.url, session)).failed).toEqual([]);
  const replacement = client();
  await replacement.open();
  replacement.title = "Plan";
  edit(replacement, "Replacement");
  await replacement.flush();
  expect(replacement.stored?.url).toBe(stored.url);
  expect(replacement.stored?.data.instanceId).not.toBe(stored.data.instanceId);
  const opening = client();
  await opening.open(stored.url);
  await opening.flush();
  expect(opening.recoveredCopy).toBeDefined();
  expect((await original.store.read(opening.recoveredCopy as string))?.data.body).toBe(
    "<p>Offline body</p>",
  );
  expect((await original.store.read(stored.url))?.data.body).toBe("<p>Replacement</p>");
  const doc = new Doc();
  try {
    for (const { update } of await new SolidUpdateStore({
      container: stored.data.updateLog as string,
      fetch: session.fetch,
    }).loadUpdates())
      applyUpdate(doc, update);
    expect(doc.getXmlFragment("prosemirror").toString()).toBe("<paragraph>Replacement</paragraph>");
  } finally {
    doc.destroy();
  }
});
