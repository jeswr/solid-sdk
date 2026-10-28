// @vitest-environment jsdom
// AUTHORED-BY Codex
import { Blob as NodeBlob } from "node:buffer";
import { createRequire } from "node:module";
import { SolidUpdateStore } from "@jeswr/y-solid";
import { Editor, generateHTML, getSchema, type JSONContent } from "@tiptap/react";
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

const view = vi.hoisted(() => ({
  runtime: null as DocumentPersistence | null,
  editor: null as Editor | null,
  params: new URLSearchParams(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => view.params,
  usePathname: () => "/docs/d/test",
}));
vi.mock("@/components/interim-shell/suite-frame", () => ({
  SuiteFrame: ({
    context,
    children,
    actions,
  }: {
    context: ReactNode;
    children: ReactNode;
    actions: ReactNode;
  }) => createElement("div", null, context, actions, children),
}));
vi.mock("../src/apps/docs/hooks/use-document", () => ({
  useDocument: () => ({ runtime: view.runtime, error: null }),
}));
vi.mock("../src/apps/docs/components/file-menu", () => ({
  FileMenu: ({ print }: { print: () => void }) =>
    createElement("button", { type: "button", onClick: print }, "Print document"),
}));
vi.mock("@tiptap/react", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  useEditor: () => view.editor,
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
  view.editor?.destroy();
  view.editor = null;
  view.params = new URLSearchParams();
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

it.each([
  "draft",
  "existing",
  "named existing",
])("keeps typing a focused title across this tab's %s autosave", async (kind) => {
  broadcasts();
  const { client, create } = await fixture();
  const runtime = kind === "draft" ? client() : await create();
  if (kind === "draft") await runtime.open();
  if (kind === "existing") {
    // Existing documents can also have an empty title; body autosave supplies the default.
    const stored = runtime.stored as StoredDocument;
    await runtime.store.save(
      stored,
      { title: "" },
      {
        regenerate: () => ({ body: stored.data.body, format: "text/html" }),
      },
    );
    await runtime.reconnect();
  }
  const ui = await titleInput(runtime);
  try {
    await act(async () => ui.input.focus());
    await ui.type("P");
    if (kind !== "draft") append(runtime, " autosaved body");
    await act(async () => runtime.flush());
    await ui.render();
    expect(runtime.state).toBe("saved");
    const completed = kind === "draft" ? "Plan" : "Planning";
    await ui.type(completed);
    await ui.render();
    expect(runtime.conflict).toBeUndefined();
    await act(async () => ui.input.blur());
    await act(async () => runtime.flush());
    expect(runtime.conflict).toBeUndefined();
    expect(runtime.state).toBe("saved");
    expect((await runtime.store.read(runtime.stored?.url as string))?.data.title).toBe(completed);
  } finally {
    await ui.close();
  }
});

it("still detects another writer's rename when this tab autosaves its body before rendering", async () => {
  const { create } = await fixture();
  const runtime = await create();
  const source = runtime.stored as StoredDocument;
  const ui = await titleInput(runtime);
  try {
    await act(async () => ui.input.focus());
    await ui.type("My title");
    await runtime.store.save(
      source,
      { title: "Remote title" },
      {
        regenerate: () => ({ body: source.data.body, format: "text/html" }),
      },
    );
    await act(async () => runtime.forceSave());
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
  "list",
  "editor menu",
])("prints from the %s only after its private image fetch and decode finish", async (entry) => {
  const { client } = await fixture();
  const runtime = client();
  await runtime.open();
  runtime.readOnly = true;
  let finishFetch!: (response: Response) => void;
  const pendingImage = new Promise<Response>((resolve) => {
    finishFetch = resolve;
  });
  const fetchImage = vi.fn(() => pendingImage.then((response) => response.clone()));
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  URL.createObjectURL = vi.fn(() => "blob:private-image");
  URL.revokeObjectURL = vi.fn();
  view.editor = new Editor({
    extensions: baseExtensions(fetchImage),
    content: {
      type: "doc",
      content: [
        {
          type: "image",
          attrs: {
            src: `${DEMO_ROOT}private.png`,
            alt: "Project diagram",
          },
        },
      ],
    },
  });
  view.params = new URLSearchParams(entry === "list" ? "print=1" : "");
  const print = vi.spyOn(window, "print").mockImplementation(() => {});
  const ui = await titleInput(runtime);
  try {
    if (entry === "editor menu")
      await act(async () => {
        const button = [...document.querySelectorAll("button")].find(
          (button) => button.textContent === "Print document",
        );
        expect(button).toBeDefined();
        button?.click();
      });
    await act(async () => {
      await new Promise(requestAnimationFrame);
    });
    expect(fetchImage).toHaveBeenCalled();
    expect(print).not.toHaveBeenCalled();
    finishFetch(new Response("png", { headers: { "Content-Type": "image/png" } }));
    const image = view.editor.view.dom.querySelector("img") as HTMLImageElement;
    await vi.waitFor(() => expect(image.getAttribute("src")).toBe("blob:private-image"));
    expect(print).not.toHaveBeenCalled();
    Object.defineProperty(image, "naturalWidth", { value: 100 });
    image.dispatchEvent(new Event("load"));
    await vi.waitFor(() => expect(print).toHaveBeenCalledOnce());
  } finally {
    await ui.close();
  }
});

it("recovers late edits transitively from a retired promotion's draft mirror, with cycles", async () => {
  broadcasts();
  const { pod, session, client } = await fixture();
  const original = client("retired-shared-draft");
  const second = client("retired-shared-draft");
  await original.open();
  await second.open();
  original.online = second.online = false;
  original.rename("Plan");
  edit(original, "Original");
  await original.reconnect();
  const source = original.stored as StoredDocument;
  const log = source.data.updateLog as string;
  const retiredName = original.local?.name as string;
  original.online = false;
  original.provider?.destroy();
  await original.destroy();
  const retiredDoc = new Doc();
  const retired = new IndexeddbPersistence(second.local?.name as string, retiredDoc);
  await retired.whenSynced;
  try {
    // A stale backlink must not make either lineage walker loop forever.
    await retired.set("previousMirrors", JSON.stringify([retiredName]));
    const updates = await new SolidUpdateStore({
      container: log,
      fetch: session.fetch,
    }).loadUpdates();
    await session.fetch(updates[0]?.url as string, {
      method: "PUT",
      body: "broken update",
      headers: { "Content-Type": "application/octet-stream" },
    });
    const recovered = client();
    await recovered.open(source.url, true);
    const oldResources = pod.snapshot().resources.filter(([url]) => url.startsWith(log));
    append(second, " late from B");
    await second.destroy();
    expect(await retired.get("pending")).toBe(1);
    for (let retry = 0; retry < 3; retry++) await recovered.reconnect();
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
