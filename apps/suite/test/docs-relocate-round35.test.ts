// @vitest-environment jsdom
// AUTHORED-BY Codex
import { Blob as NodeBlob } from "node:buffer";
import { createRequire } from "node:module";
import { SolidUpdateStore } from "@jeswr/y-solid";
import { generateHTML, generateJSON, getSchema, type JSONContent } from "@tiptap/react";
import { prosemirrorJSONToYDoc, yDocToProsemirrorJSON } from "@tiptap/y-tiptap";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { applyUpdate, Doc, encodeStateAsUpdate } from "yjs";
import { copyDocument } from "../src/apps/docs/editor/copy";
import { baseExtensions } from "../src/apps/docs/editor/extensions";
import { deleteDocument, restoreDocument } from "../src/apps/docs/editor/operations";
import { importMarkdown } from "../src/apps/docs/lib/convert/markdown";
import { createDocsStore, docContainerUrls } from "../src/apps/docs/lib/model";
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

it("round35 copies remap nested image and text links to copied assets in snapshot and replay", async () => {
  const pod = createDemoPod({ root: DEMO_ROOT, seed: await buildDemoSeed(Date.now()) });
  const session = { storageUrl: DEMO_ROOT, webId: DEMO_WEBID, fetch: pod.fetch } as PodSession;
  const store = createDocsStore({ podRoot: DEMO_ROOT, webId: DEMO_WEBID, fetchImpl: pod.fetch });
  const original = await store.create({ title: "Plan" });
  const src = `${original.data.assets}chart.png`;
  await pod.fetch(src, { method: "PUT", headers: { "content-type": "image/png" }, body: "pixels" });
  const json = importMarkdown(`[![Chart](${src})](${src})\n\n[Full size](${src})`, "chart.md").json;
  const copy = await copyDocument(store, original, session, json);
  const expected = `${copy.data.assets}chart.png`;
  const fresh = new Doc();
  try {
    for (const { update } of await new SolidUpdateStore({
      container: copy.data.updateLog as string,
      fetch: pod.fetch,
    }).loadUpdates())
      applyUpdate(fresh, update);
    const replayed = yDocToProsemirrorJSON(fresh) as JSONContent;
    expect(replayed.content?.[0]?.attrs).toMatchObject({ src: expected, link: { href: expected } });
    expect(replayed.content?.[1]?.content?.[0]?.marks?.[0]?.attrs?.href).toBe(expected);
    expect(copy.data.body).not.toContain(src);
  } finally {
    fresh.destroy();
  }
});
afterEach(() => vi.unstubAllGlobals());

it.each([
  "asset",
  "document",
])("round35 renamed restore relocates nested image %s hyperlinks in fresh Yjs replay", async (destination) => {
  const root = DEMO_ROOT;
  const pod = createDemoPod({ root, seed: await buildDemoSeed(Date.now()) });
  const session = { storageUrl: root, webId: DEMO_WEBID, fetch: pod.fetch } as PodSession;
  const store = createDocsStore({ podRoot: root, webId: session.webId, fetchImpl: pod.fetch });
  const original = await store.create({ title: "Plan" });
  const layout = docContainerUrls(original.url);
  const src = `${layout.assets}chart.png`;
  const href = destination === "asset" ? src : `${original.url}#chart`;
  await pod.fetch(src, { method: "PUT", headers: { "content-type": "image/png" }, body: "pixels" });
  const json = importMarkdown(
    `[![Chart](${src})](${href})\n\n[Text link](${href})`,
    "chart.md",
  ).json;
  const extensions = baseExtensions(pod.fetch);
  const body = generateHTML(json, extensions);
  const snapshot = { body, format: "text/html" };
  await store.save(original, snapshot, { regenerate: () => snapshot });
  const doc = prosemirrorJSONToYDoc(getSchema(extensions), json);
  doc.getMap("document").set("instanceId", original.data.instanceId);
  const log = new SolidUpdateStore({ container: layout.updateLog, fetch: pod.fetch });
  await log.appendUpdate(encodeStateAsUpdate(doc));
  doc.destroy();
  const trashed = await deleteDocument(original.url, session);
  expect(trashed.failed).toEqual([]);
  const replacement = await store.create({ title: "Plan" });
  expect(replacement.url).toBe(original.url);
  const restored = await restoreDocument(trashed.done, session);
  expect(restored.failed).toEqual([]);
  const url = restored.done.find((entry) => entry.url.endsWith(".ttl"))?.url as string;
  expect(url).not.toBe(original.url);
  const after = docContainerUrls(url);
  const expectedHref = destination === "asset" ? `${after.assets}chart.png` : `${url}#chart`;
  const fresh = new Doc();
  try {
    for (const { update } of await new SolidUpdateStore({
      container: after.updateLog,
      fetch: pod.fetch,
    }).loadUpdates())
      applyUpdate(fresh, update);
    const replayed = yDocToProsemirrorJSON(fresh) as JSONContent;
    expect(replayed.content?.[0]?.attrs).toMatchObject({
      src: `${after.assets}chart.png`,
      link: { href: expectedHref },
    });
    expect(replayed.content?.[1]?.content?.[0]?.marks?.[0]?.attrs?.href).toBe(expectedHref);
    const stored = await store.read(url);
    expect(generateJSON(stored?.data.body as string, extensions)).toEqual(
      getSchema(extensions).nodeFromJSON(replayed).toJSON(),
    );
    expect((await pod.fetch(`${after.assets}chart.png`)).status).toBe(200);
  } finally {
    fresh.destroy();
  }
});
