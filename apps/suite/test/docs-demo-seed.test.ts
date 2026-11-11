// AUTHORED-BY Codex GPT-6.1
// @vitest-environment jsdom
import { createRequire } from "node:module";
import { fetchRdf } from "@jeswr/fetch-rdf";
import { Editor } from "@tiptap/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { editorExtensions } from "../src/apps/docs/editor/extensions";
import { DocumentPersistence } from "../src/apps/docs/editor/persistence";
import { parseDocument } from "../src/apps/docs/lib/model/document";
import { createDocsStore } from "../src/apps/docs/lib/model/store";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import { buildDemoSeed, DEMO_NAME, DEMO_ROOT, DEMO_WEBID } from "../src/lib/demo-pod/seed";
import type { PodSession } from "../src/lib/session/pod-session";

// Use the same IndexedDB shim as the other Docs integration tests, with real mirrors.
const { IDBFactory, IDBKeyRange: KeyRange } = createRequire(
  `${process.cwd()}/../../packages/solid-offline/package.json`,
)("fake-indexeddb") as { IDBFactory: new () => IDBFactory; IDBKeyRange: typeof IDBKeyRange };
const runtimes: DocumentPersistence[] = [];
beforeEach(() => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("IDBKeyRange", KeyRange);
  vi.stubGlobal("BroadcastChannel", undefined);
});
afterEach(async () => {
  for (const runtime of runtimes.splice(0)) {
    runtime.online = false;
    await runtime.destroy();
  }
  vi.unstubAllGlobals();
});

it("opens every seeded Docs document through the editor loader with its title and body", async () => {
  // Keep the production seed options and await initialization just as getDemoPod does.
  const seed = await buildDemoSeed(Date.now());
  const pod = createDemoPod({ root: DEMO_ROOT, seed });
  const session: PodSession = {
    mode: "demo",
    webId: DEMO_WEBID,
    storageUrl: DEMO_ROOT,
    displayName: DEMO_NAME,
    fetch: pod.fetch,
    subscribe: pod.subscribe,
    reset: async () => {},
  };
  // Inspect the seed itself so a document silently omitted from list() cannot escape testing.
  const documents = [];
  for (const file of seed) {
    if (file.contentType !== "text/turtle" || file.path.endsWith("/")) continue;
    const url = new URL(file.path, DEMO_ROOT).href;
    const { dataset } = await fetchRdf(url, { fetch: pod.fetch });
    const data = parseDocument(url, dataset);
    if (data) documents.push({ url, data });
  }
  expect(documents).toEqual(
    expect.arrayContaining([
      {
        url: `${DEMO_ROOT}docs/launch.ttl`,
        data: expect.objectContaining({
          title: "Launch plan",
          body: "A shared plan for the next chapter.",
          format: "text/plain",
        }),
      },
    ]),
  );
  const store = createDocsStore({ podRoot: DEMO_ROOT, webId: DEMO_WEBID, fetchImpl: pod.fetch });
  expect((await store.list()).map(({ url }) => url).sort()).toEqual(
    documents.map(({ url }) => url).sort(),
  );
  for (const { url, data } of documents) {
    // useDocument, called by DocumentEditor, awaits this exact open path.
    const runtime = new DocumentPersistence(session);
    runtimes.push(runtime);
    await runtime.open(url);
    expect(runtime.title).toBe(data.title);
    expect(runtime.stored?.data.body).toBe(data.body);
    expect(runtime.provider?.synced).toBe(true);
    const editor = new Editor({
      element: document.createElement("div"),
      extensions: editorExtensions(runtime.doc, session.fetch),
    });
    try {
      const expectedText =
        data.format === "text/plain"
          ? data.body
          : new window.DOMParser().parseFromString(data.body, "text/html").body.textContent;
      expect(editor.getText()).toBe(expectedText);
    } finally {
      editor.destroy();
    }
    await runtime.destroy();
  }
});
