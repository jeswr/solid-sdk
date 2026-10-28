// @vitest-environment jsdom
// AUTHORED-BY Codex
import { Blob as NodeBlob } from "node:buffer";
import { createRequire } from "node:module";
import { SolidUpdateStore } from "@jeswr/y-solid";
import { generateHTML, getSchema, type JSONContent } from "@tiptap/react";
import { prosemirrorJSONToYDoc, yDocToProsemirrorJSON } from "@tiptap/y-tiptap";
import { act, createElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { IndexeddbPersistence } from "y-indexeddb";
import { applyUpdate, Doc, encodeStateAsUpdate, type XmlElement, type XmlText } from "yjs";
import { baseExtensions } from "../src/apps/docs/editor/extensions";
import { DocumentPersistence } from "../src/apps/docs/editor/persistence";
import type { StoredDocument } from "../src/apps/docs/lib/model";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import { buildDemoSeed, DEMO_NAME, DEMO_ROOT, DEMO_WEBID } from "../src/lib/demo-pod/seed";
import type { PodSession } from "../src/lib/session/pod-session";

const view = vi.hoisted(() => ({ runtime: null as DocumentPersistence | null }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/docs/d/test",
}));
vi.mock("@/components/interim-shell/suite-frame", () => ({
  SuiteFrame: ({ context, children }: { context: ReactNode; children: ReactNode }) =>
    createElement("div", null, context, children),
}));
vi.mock("../src/apps/docs/hooks/use-document", () => ({
  useDocument: () => ({ runtime: view.runtime, error: null }),
}));
vi.mock("@tiptap/react", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  useEditor: () => null,
}));

import { DocumentEditor } from "../src/apps/docs/components/document-editor";

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
  for (const runtime of runtimes.splice(0)) {
    runtime.online = false;
    await runtime.destroy();
  }
  view.runtime = null;
  document.body.replaceChildren();
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

async function titleInput(runtime: DocumentPersistence) {
  view.runtime = runtime;
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const render = () =>
    act(async () =>
      root.render(
        createElement(DocumentEditor, { session: runtime.session, resource: runtime.stored?.url }),
      ),
    );
  await render();
  const input = host.querySelector<HTMLInputElement>(
    '[aria-label="Document title"]',
  ) as HTMLInputElement;
  return {
    input,
    render,
    close: () => act(async () => root.unmount()),
    type: (text: string) =>
      act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
          input,
          text,
        );
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }),
  };
}

it("adopts a remote rename while an unchanged title is focused and never submits it on blur", async () => {
  const { create } = await fixture();
  const runtime = await create();
  const source = runtime.stored as StoredDocument;
  const ui = await titleInput(runtime);
  const rename = vi.spyOn(runtime, "rename");
  try {
    await act(async () => ui.input.focus());
    await runtime.store.save(
      source,
      { title: "Remote title" },
      {
        regenerate: () => ({ body: source.data.body, format: "text/html" }),
      },
    );
    await act(async () => runtime.reconnect());
    await ui.render();
    expect(ui.input.value).toBe("Remote title");
    await act(async () => ui.input.blur());
    await runtime.flush();
    expect((await runtime.store.read(source.url))?.data.title).toBe("Remote title");
    expect(rename).not.toHaveBeenCalled();
    expect(ui.input.value).toBe("Remote title");
  } finally {
    await ui.close();
  }
});

it.each([
  false,
  true,
])("raises the title conflict for a remote rename during a dirty focus session (pending body=%s)", async (pendingBody) => {
  const { create } = await fixture();
  const runtime = await create();
  const source = runtime.stored as StoredDocument;
  const ui = await titleInput(runtime);
  try {
    await act(async () => ui.input.focus());
    await ui.type("My title");
    if (pendingBody) {
      runtime.online = false;
      runtime.provider?.destroy();
      append(runtime, " pending body");
    }
    await runtime.store.save(
      source,
      { title: "Remote title" },
      {
        regenerate: () => ({ body: source.data.body, format: "text/html" }),
      },
    );
    if (pendingBody)
      vi.spyOn(runtime.store, "save").mockRejectedValue(new Error("Snapshot write failed"));
    await act(async () => runtime.reconnect());
    await ui.render();
    await runtime.flush();
    expect(runtime.conflict?.localTitle).toBe("My title");
    expect(runtime.conflict?.remoteTitle).toBe("Remote title");
    expect((await runtime.store.read(source.url))?.data.title).toBe("Remote title");
  } finally {
    await ui.close();
  }
});

it.each([
  true,
  false,
])("keeps a late draft title pending without broadcasts until conflict resolution (keep mine=%s)", async (keepMine) => {
  const { client } = await fixture();
  const first = client("late-title");
  const second = client("late-title");
  await first.open();
  await second.open();
  first.online = second.online = false;
  first.rename("Plan");
  edit(first, "Original");
  await first.reconnect();
  const source = first.stored as StoredDocument;
  // B has never loaded a pod title; pasting into the blank input is local intent.
  second.rename("B title");
  await second.destroy();
  await first.reconnect();
  expect(first.conflict?.localTitle).toBe("B title");
  expect(first.conflict?.remoteTitle).toBe("Plan");
  const doc = new Doc();
  const mirror = new IndexeddbPersistence(second.local?.name as string, doc);
  try {
    await mirror.whenSynced;
    expect(await mirror.get("pending")).toBe(1);
    expect((await first.store.read(source.url))?.data.title).toBe("Plan");
    await first.resolveTitle(keepMine);
    expect(first.state).toBe("saved");
    expect((await first.store.read(source.url))?.data.title).toBe(keepMine ? "B title" : "Plan");
    expect(await mirror.get("pending")).toBe(0);
  } finally {
    await mirror.destroy();
    doc.destroy();
  }
});

it("asks about a never-promoted tab's title when that tab reconnects without broadcasts", async () => {
  const { client } = await fixture();
  const first = client("reconnecting-title");
  const second = client("reconnecting-title");
  await first.open();
  await second.open();
  first.online = second.online = false;
  first.rename("Plan");
  edit(first, "Original");
  await first.reconnect();
  second.rename("B title");
  await second.reconnect();
  expect(second.conflict?.localTitle).toBe("B title");
  expect(second.conflict?.remoteTitle).toBe("Plan");
  expect((await first.store.read(first.stored?.url as string))?.data.title).toBe("Plan");
  await second.resolveTitle(true);
  expect(second.state).toBe("saved");
  expect((await first.store.read(first.stored?.url as string))?.data.title).toBe("B title");
});

it.each([
  "reconnect",
  "flush",
  "forceSave",
  "unload",
  "retry",
])("%s discovers late pending edits after recovery retired their mirror", async (path) => {
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
  const { pod, session, client, create } = await fixture();
  const original = await create();
  const source = original.stored as StoredDocument;
  const second = client();
  await second.open(source.url);
  original.online = second.online = false;
  original.provider?.destroy();
  second.provider?.destroy();
  await original.destroy();
  const retiredDoc = new Doc();
  const retired = new IndexeddbPersistence(second.local?.name as string, retiredDoc);
  await retired.whenSynced;
  try {
    const log = source.data.updateLog as string;
    const updates = await new SolidUpdateStore({
      container: log,
      fetch: session.fetch,
    }).loadUpdates();
    expect(updates.length).toBeGreaterThan(0);
    const corrupt = updates[0]?.url as string;
    await session.fetch(corrupt, {
      method: "PUT",
      body: "broken update",
      headers: { "Content-Type": "application/octet-stream" },
    });
    const first = client();
    await expect(first.open(source.url)).rejects.toThrow();
    first.online = false;
    await first.destroy();
    const recovered = client();
    await recovered.open(source.url, true);
    expect(recovered.stored?.data.updateLog).not.toBe(log);
    const oldResources = pod.snapshot().resources.filter(([url]) => url.startsWith(log));
    // The old tab edits only after A has finished moving to the recovered log.
    append(second, " late from B");
    await second.destroy();
    expect(await retired.get("pending")).toBe(1);
    if (path === "retry") {
      const failure = vi
        .spyOn(session, "fetch")
        .mockImplementation((input, init) =>
          String(input).endsWith("/plan-copy.ttl") &&
          init?.method === "PUT" &&
          new Headers(init.headers).has("if-match")
            ? Promise.resolve(new Response(null, { status: 503 }))
            : pod.fetch(input, init),
        );
      await recovered.reconnect();
      expect(recovered.state).toBe("retrying");
      expect(await retired.get("pending")).toBe(1);
      failure.mockRestore();
    }
    if (path === "unload") await recovered.destroy();
    else if (path === "forceSave") await recovered.forceSave();
    else if (path === "flush") await recovered.flush();
    else for (let retry = 0; retry < 3; retry++) await recovered.reconnect();
    expect(recovered.state).toBe("saved");
    expect(recovered.recoveredCopy).toBeDefined();
    const copy = (await recovered.store.read(recovered.recoveredCopy as string)) as StoredDocument;
    expect(copy.data.body).toBe("<p>Original late from B</p>");
    expect(await replay(copy, session)).toEqual(json("Original late from B"));
    expect(await replay(recovered.stored as StoredDocument, session)).toEqual(json("Original"));
    expect(await retired.get("pending")).toBe(0);
    expect(
      pod.snapshot().resources.filter(([url]) => /plan-copy(?:-\d+)?\.ttl$/.test(url)),
    ).toHaveLength(1);
    expect(pod.snapshot().resources.filter(([url]) => url.startsWith(log))).toEqual(oldResources);
  } finally {
    await retired.destroy();
    retiredDoc.destroy();
  }
});
