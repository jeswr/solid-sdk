// @vitest-environment jsdom
// AUTHORED-BY Codex
import { Blob as NodeBlob, File as NodeFile } from "node:buffer";
import { createRequire } from "node:module";
import { generateHTML, getSchema, type JSONContent } from "@tiptap/react";
import { prosemirrorJSONToYDoc, yDocToProsemirrorJSON } from "@tiptap/y-tiptap";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { applyUpdate, encodeStateAsUpdate } from "yjs";
import { baseExtensions } from "../src/apps/docs/editor/extensions";
import { importDocument } from "../src/apps/docs/editor/import-document";
import { DocumentPersistence } from "../src/apps/docs/editor/persistence";
import { useDocument } from "../src/apps/docs/hooks/use-document";
import { saveStatus } from "../src/apps/docs/lib/editor/logic";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import { buildDemoSeed, DEMO_NAME, DEMO_ROOT, DEMO_WEBID } from "../src/lib/demo-pod/seed";
import type { PodSession } from "../src/lib/session/pod-session";

const navigation = vi.hoisted(() => ({
  router: { replace: vi.fn() },
  params: new URLSearchParams(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => navigation.router,
  useSearchParams: () => navigation.params,
}));

const { IDBFactory, IDBKeyRange: KeyRange } = createRequire(
  `${process.cwd()}/../../packages/solid-offline/package.json`,
)("fake-indexeddb") as { IDBFactory: new () => IDBFactory; IDBKeyRange: typeof IDBKeyRange };
const runtimes: DocumentPersistence[] = [];
beforeEach(() => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("IDBKeyRange", KeyRange);
  vi.stubGlobal("BroadcastChannel", undefined);
  vi.stubGlobal("Blob", NodeBlob);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});
afterEach(async () => {
  vi.restoreAllMocks();
  for (const runtime of runtimes.splice(0)) {
    runtime.online = false;
    await runtime.destroy();
  }
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});
async function fixture() {
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
  const client = () => {
    const runtime = new DocumentPersistence(session);
    runtimes.push(runtime);
    return runtime;
  };
  return { session, client };
}
function edit(runtime: DocumentPersistence, value: string) {
  const json: JSONContent = {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: value }] }],
  };
  const extensions = baseExtensions(runtime.session.fetch);
  const seed = prosemirrorJSONToYDoc(getSchema(extensions), json);
  const fragment = runtime.doc.getXmlFragment("prosemirror");
  fragment.delete(0, fragment.length);
  applyUpdate(runtime.doc, encodeStateAsUpdate(seed));
  seed.destroy();
  runtime.change(generateHTML(json, extensions), json);
}

it("round27 Markdown upload commits decoded entities to the pod snapshot and reopens them intact", async () => {
  const { session, client } = await fixture();
  const uploaded = await importDocument(
    new NodeFile(["caf&eacute; &copy; 2026"], "entities.md") as unknown as File,
    session,
    vi.fn(),
  );
  expect(uploaded.skipped).toEqual([]);
  const runtime = client();
  await runtime.open(uploaded.url);
  expect((await runtime.store.read(uploaded.url))?.data.body).toContain("café © 2026");
  expect(runtime.body).toContain("café © 2026");
  await runtime.destroy();
  const reopened = client();
  await reopened.open(uploaded.url);
  expect(
    getSchema(baseExtensions(session.fetch)).nodeFromJSON(yDocToProsemirrorJSON(reopened.doc))
      .textContent,
  ).toBe("café © 2026");
});

it("round27 aborted offline local transactions never claim device success", async () => {
  const { client } = await fixture();
  const runtime = client();
  await runtime.open();
  edit(runtime, "Original");
  await runtime.flush();
  runtime.online = false;
  runtime.provider?.destroy();
  const database = runtime.local?.db as IDBDatabase;
  const transact = database.transaction.bind(database);
  const failing = vi.spyOn(database, "transaction").mockImplementation((names, mode, options) => {
    const transaction = transact(names, mode, options);
    // Abort after requests succeed, before commit: request success is not durability.
    if (mode === "readwrite") {
      queueMicrotask(() => {
        const name = transaction.objectStoreNames[0] as string;
        const request = transaction.objectStore(name).get(name === "custom" ? "pending" : 1);
        request.onsuccess = () => transaction.abort();
      });
    }
    return transaction;
  });
  edit(runtime, "Visible but not saved");
  await vi.waitFor(() => expect(runtime.state).toBe("retrying"));
  expect(runtime.localState).toBe("retrying");
  expect(runtime.hasUnsavedChanges).toBe(true);
  expect(saveStatus(runtime.state, runtime.localState, false, 0, 0)).toBe(
    "Offline — Not saved — retrying on this device",
  );
  expect(runtime.body).toContain("Visible but not saved");
  failing.mockRestore();
  const reader = client();
  await reader.open(runtime.stored?.url);
  expect(reader.body).toContain("Original");
  expect(reader.body).not.toContain("Visible but not saved");
  reader.online = false;
  await reader.destroy();
  await runtime.flush();
  expect(runtime.localState).toBe("saved");
  expect(runtime.hasUnsavedChanges).toBe(false);
  expect(saveStatus(runtime.state, runtime.localState, false, 0, 0)).toBe(
    "Offline — Saved on this device",
  );
  await runtime.destroy();
  const reopened = client();
  await reopened.open(runtime.stored?.url);
  expect(reopened.body).toContain("Visible but not saved");
});

it("round27 beforeunload guards the latest edit until its own local transaction commits", async () => {
  const { session } = await fixture();
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  let current: DocumentPersistence | null = null;
  function Harness() {
    current = useDocument(session, undefined).runtime;
    return null;
  }
  const completions: (() => void)[] = [];
  let held = 0;
  let transactions: ReturnType<typeof vi.spyOn> | undefined;
  try {
    await act(async () => root.render(createElement(Harness)));
    await vi.waitFor(async () => {
      await act(async () => {});
      expect(current).not.toBeNull();
    });
    const runtime = current as unknown as DocumentPersistence;
    runtime.online = false;
    const database = runtime.local?.db as IDBDatabase;
    const transact = database.transaction.bind(database);
    transactions = vi.spyOn(database, "transaction").mockImplementation((names, mode, options) => {
      const transaction = transact(names, mode, options);
      if (
        transaction.objectStoreNames.contains("custom") &&
        transaction.objectStoreNames.contains("updates")
      ) {
        held++;
        // Hold the real completion notification after all requests have succeeded.
        // The runtime must not infer a commit from request success.
        let complete: (() => void) | undefined;
        Object.defineProperty(transaction, "oncomplete", {
          set: (callback: () => void) => {
            complete = callback;
          },
        });
        transaction.addEventListener("complete", () => completions.push(() => complete?.()));
      }
      return transaction;
    });
    await act(async () => edit(runtime, "First edit"));
    await vi.waitFor(() => expect(completions.length).toBeGreaterThanOrEqual(1));
    expect(runtime.localState).toBe("saving");
    const unload = () => {
      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };
    await act(async () => expect(unload()).toBe(true));
    await act(async () => edit(runtime, "Latest edit"));
    // An older transaction's completion cannot acknowledge the latest edit.
    await act(async () => completions.shift()?.());
    held--;
    expect(runtime.localState).toBe("saving");
    expect(runtime.hasUnsavedChanges).toBe(true);
    transactions.mockRestore();
    await vi.waitFor(() => expect(completions.length).toBe(held));
    await act(async () => {
      for (const complete of completions.splice(0)) complete();
    });
    expect(runtime.localState).toBe("saved");
    expect(runtime.hasUnsavedChanges).toBe(false);
    await act(async () => expect(unload()).toBe(false));
  } finally {
    transactions?.mockRestore();
    await act(async () => {
      for (const complete of completions.splice(0)) complete();
    });
    await act(async () => root.unmount());
  }
});
