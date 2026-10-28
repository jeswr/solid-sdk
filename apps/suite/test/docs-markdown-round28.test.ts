// @vitest-environment jsdom
// AUTHORED-BY Codex
import { Blob as NodeBlob, File as NodeFile } from "node:buffer";
import { createRequire } from "node:module";
import type { JSONContent } from "@tiptap/react";
import { yDocToProsemirrorJSON } from "@tiptap/y-tiptap";
import { expect, it, vi } from "vitest";
import { importDocument } from "../src/apps/docs/editor/import-document";
import { DocumentPersistence } from "../src/apps/docs/editor/persistence";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import { buildDemoSeed, DEMO_NAME, DEMO_ROOT, DEMO_WEBID } from "../src/lib/demo-pod/seed";
import type { PodSession } from "../src/lib/session/pod-session";

const { IDBFactory, IDBKeyRange: KeyRange } = createRequire(
  `${process.cwd()}/../../packages/solid-offline/package.json`,
)("fake-indexeddb") as { IDBFactory: new () => IDBFactory; IDBKeyRange: typeof IDBKeyRange };

it("round28 upload preserves an escaped ampersand in a contract URL through pod snapshot reopen", async () => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("IDBKeyRange", KeyRange);
  vi.stubGlobal("BroadcastChannel", undefined);
  vi.stubGlobal("Blob", NodeBlob);
  const pod = createDemoPod({ root: DEMO_ROOT, seed: await buildDemoSeed(Date.now()) });
  const session: PodSession = {
    mode: "demo",
    webId: DEMO_WEBID,
    storageUrl: DEMO_ROOT,
    displayName: DEMO_NAME,
    fetch: pod.fetch,
    subscribe: pod.subscribe,
    reset: async () => {},
  };
  const opened = new DocumentPersistence(session);
  const reopened = new DocumentPersistence(session);
  try {
    const uploaded = await importDocument(
      new NodeFile(
        [String.raw`[contract](https://files.example.org/terms/\&copy;.pdf)`],
        "contract.md",
      ) as unknown as File,
      session,
      vi.fn(),
    );
    expect(uploaded.skipped).toEqual([]);
    const expected = "https://files.example.org/terms/&copy;.pdf";
    for (const runtime of [opened, reopened]) {
      await runtime.open(uploaded.url);
      const json = yDocToProsemirrorJSON(runtime.doc) as JSONContent;
      expect(json.content?.[0]?.content?.[0]).toMatchObject({
        text: "contract",
        marks: [{ type: "link", attrs: { href: expected } }],
      });
      expect((await runtime.store.read(uploaded.url))?.data.body).toContain(
        "https://files.example.org/terms/&amp;copy;.pdf",
      );
      await runtime.destroy();
    }
  } finally {
    await opened.destroy();
    await reopened.destroy();
    vi.unstubAllGlobals();
  }
});
