// @vitest-environment jsdom
// AUTHORED-BY Codex
import { Blob as NodeBlob, File as NodeFile } from "node:buffer";
import { createRequire } from "node:module";
import { SolidUpdateStore } from "@jeswr/y-solid";
import { generateHTML, getSchema, type JSONContent } from "@tiptap/react";
import { prosemirrorJSONToYDoc, yDocToProsemirrorJSON } from "@tiptap/y-tiptap";
import { Document, ImageRun, Packer, Paragraph, TextRun } from "docx";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { applyUpdate, Doc, encodeStateAsUpdate, type XmlElement, type XmlText } from "yjs";
import { baseExtensions } from "../src/apps/docs/editor/extensions";
import { convertImport } from "../src/apps/docs/editor/import-document";
import { deleteDocument } from "../src/apps/docs/editor/operations";
import { DocumentPersistence } from "../src/apps/docs/editor/persistence";
import type { StoredDocument } from "../src/apps/docs/lib/model";
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
  for (const runtime of runtimes.splice(0)) {
    runtime.online = false;
    await runtime.destroy();
  }
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
  const client = () => {
    const runtime = new DocumentPersistence(session);
    runtimes.push(runtime);
    return runtime;
  };
  const create = async (text: string) => {
    const runtime = client();
    await runtime.open();
    runtime.title = "Plan";
    edit(runtime, text);
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

it.each([
  "reconnect",
  "reload",
])("merges recovery retries without erasing edits saved to the visible copy on %s", async (retry) => {
  const { pod, session, client, create } = await fixture();
  const original = await create("Original");
  const source = original.stored as StoredDocument;
  original.online = false;
  original.provider?.destroy();
  edit(original, "Offline intent");
  expect((await deleteDocument(source.url, session)).failed).toEqual([]);
  const replacement = await create("Replacement");
  const http = session.fetch;
  let interrupted = true;
  vi.spyOn(session, "fetch").mockImplementation((input, init) =>
    interrupted &&
    String(input).endsWith("/plan-copy.ttl") &&
    init?.method === "PUT" &&
    new Headers(init.headers).has("if-match")
      ? Promise.resolve(new Response(null, { status: 503 }))
      : http(input, init),
  );
  await original.reconnect();
  expect(original.state).toBe("retrying");
  original.online = false;
  const copyUrl = source.url.replace(/\.ttl$/, "-copy.ttl");
  const elsewhere = client();
  await elsewhere.open(copyUrl);
  expect(yDocToProsemirrorJSON(elsewhere.doc)).toEqual(json("Offline intent"));
  interrupted = false;
  edit(elsewhere, "Newer saved copy text");
  await elsewhere.flush();
  expect(elsewhere.state).toBe("saved");
  elsewhere.online = false;
  await elsewhere.destroy();
  let resumed = original;
  if (retry === "reload") {
    await original.destroy();
    resumed = client();
    await resumed.open(source.url);
  }
  await resumed.reconnect();
  const copy = (await client().store.read(copyUrl)) as StoredDocument;
  expect(await replay(copy, session)).toEqual(json("Newer saved copy text"));
  expect(copy.data.body).toBe("<p>Newer saved copy text</p>");
  expect(resumed.state).toBe("saved");
  expect(resumed.recoveredCopy).toBe(copyUrl);
  const reopened = client();
  await reopened.open(copyUrl);
  expect(reopened.state).toBe("saved");
  expect(reopened.body).toBe(copy.data.body);
  expect((await replacement.store.read(source.url))?.data.body).toBe("<p>Replacement</p>");
  expect(
    pod.snapshot().resources.filter(([url]) => /plan-copy(?:-\d+)?\.ttl$/.test(url)),
  ).toHaveLength(1);
});

it.each([
  false,
  true,
])("recovers a closed offline tab's persisted edits along with the reconnecting tab's edits (reload during recovery=%s)", async (reload) => {
  const { pod, session, client, create } = await fixture();
  let first = await create("Original");
  const source = first.stored as StoredDocument;
  const second = client();
  await second.open(source.url);
  first.online = second.online = false;
  first.provider?.destroy();
  second.provider?.destroy();
  append(first, " from tab A");
  append(second, " from closed tab B");
  await vi.waitFor(async () => expect(await second.local?.get("pending")).toBe(1));
  await second.destroy();
  expect(JSON.stringify(yDocToProsemirrorJSON(first.doc))).not.toContain("closed tab B");
  expect((await deleteDocument(source.url, session)).failed).toEqual([]);
  await create("Replacement");
  const retiredMirror = first.local;
  if (reload) {
    const failure = vi
      .spyOn(session, "fetch")
      .mockImplementation((input, init) =>
        String(input).endsWith("/plan-copy.ttl") &&
        init?.method === "PUT" &&
        new Headers(init.headers).has("if-match")
          ? Promise.resolve(new Response(null, { status: 503 }))
          : pod.fetch(input, init),
      );
    await first.reconnect();
    expect(first.state).toBe("retrying");
    first.online = false;
    await first.destroy();
    failure.mockRestore();
    first = client();
    await first.open(source.url);
  }
  await first.reconnect();
  expect(first.state).toBe("saved");
  const recovered = (await client().store.read(first.recoveredCopy as string)) as StoredDocument;
  const body = JSON.stringify(await replay(recovered, session));
  expect(body).toContain("from tab A");
  expect(body).toContain("from closed tab B");
  expect(recovered.data.body).toContain("from closed tab B");
  const reopened = client();
  await reopened.open(source.url);
  expect(reopened.state).toBe("saved");
  expect(reopened.recoveredCopy).toBe(recovered.url);
  expect(reopened.body).toBe("<p>Replacement</p>");
  expect(retiredMirror?.name).not.toBe(first.local?.name);
  expect(
    pod.snapshot().resources.filter(([url]) => /plan-copy(?:-\d+)?\.ttl$/.test(url)),
  ).toHaveLength(1);
});

it.each([
  ["inline.md", "Before ![Chart](https://example.org/chart.png) after"],
  ["html.md", '<p>Before <img src="https://example.org/chart.png" alt="Chart"> after</p>'],
])("imports inline images in %s as blocks in text order with alt text", async (name, source) => {
  const { session } = await fixture();
  const result = await convertImport(
    new NodeFile([source], name) as unknown as File,
    session,
    vi.fn(),
    vi.fn(),
  );
  expect(result.json.content?.map((node) => node.type)).toEqual([
    "paragraph",
    "image",
    "paragraph",
  ]);
  expect(result.json.content?.[0]?.content?.[0]?.text?.trim()).toBe("Before");
  expect(result.json.content?.[1]?.attrs).toMatchObject({
    src: "https://example.org/chart.png",
    alt: "Chart",
  });
  expect(result.json.content?.[2]?.content?.[0]?.text?.trim()).toBe("after");
  getSchema(baseExtensions(session.fetch)).nodeFromJSON(result.json).check();
});

it("imports a DOCX inline image between text runs in schema-valid order with alt text", async () => {
  const { session } = await fixture();
  const docx = new Document({
    sections: [
      {
        children: [
          new Paragraph({
            children: [
              new TextRun("Before "),
              new ImageRun({
                type: "png",
                data: new Uint8Array([1]),
                transformation: { width: 1, height: 1 },
                altText: { title: "Chart", description: "Chart", name: "Chart" },
              }),
              new TextRun(" after"),
            ],
          }),
        ],
      },
    ],
  });
  const result = await convertImport(
    new NodeFile([await Packer.toArrayBuffer(docx)], "inline.docx") as unknown as File,
    session,
    async () => "https://example.org/chart.png",
    vi.fn(),
  );
  expect(result.json.content?.map((node) => node.type)).toEqual([
    "paragraph",
    "image",
    "paragraph",
  ]);
  expect(result.json.content?.[0]?.content?.[0]?.text?.trim()).toBe("Before");
  expect(result.json.content?.[1]?.attrs).toMatchObject({
    src: "https://example.org/chart.png",
    alt: "Chart",
  });
  expect(result.json.content?.[2]?.content?.[0]?.text?.trim()).toBe("after");
  getSchema(baseExtensions(session.fetch)).nodeFromJSON(result.json).check();
});

it("merges fresh local intent and remote edits into the same recovery CRDT on repeated retries", async () => {
  const { pod, session, client, create } = await fixture();
  const original = await create("Original");
  const source = original.stored as StoredDocument;
  original.online = false;
  original.provider?.destroy();
  edit(original, "Offline intent");
  expect((await deleteDocument(source.url, session)).failed).toEqual([]);
  await create("Replacement");
  let interrupted = true;
  const failure = vi
    .spyOn(session, "fetch")
    .mockImplementation((input, init) =>
      interrupted &&
      String(input).endsWith("/plan-copy.ttl") &&
      init?.method === "PUT" &&
      new Headers(init.headers).has("if-match")
        ? Promise.resolve(new Response(null, { status: 503 }))
        : pod.fetch(input, init),
    );
  await original.reconnect();
  expect(original.state).toBe("retrying");
  original.online = false;
  const copyUrl = source.url.replace(/\.ttl$/, "-copy.ttl");
  const elsewhere = client();
  await elsewhere.open(copyUrl);
  interrupted = false;
  append(elsewhere, " from elsewhere");
  await elsewhere.flush();
  expect(elsewhere.state).toBe("saved");
  elsewhere.online = false;
  await elsewhere.destroy();
  append(original, " from original");
  interrupted = true;
  await original.reconnect();
  expect(original.state).toBe("retrying");
  failure.mockRestore();
  await original.reconnect();
  expect(original.state).toBe("saved");
  expect(original.recoveredCopy).toBe(copyUrl);
  const copy = (await client().store.read(copyUrl)) as StoredDocument;
  const body = JSON.stringify(await replay(copy, session));
  for (const text of ["Offline intent", "from elsewhere", "from original"])
    expect(body.split(text)).toHaveLength(2);
  expect(copy.data.body).toContain("from elsewhere");
  expect(copy.data.body).toContain("from original");
  expect(
    pod.snapshot().resources.filter(([url]) => /plan-copy(?:-\d+)?\.ttl$/.test(url)),
  ).toHaveLength(1);
});

it("includes another tab's update arriving during recovery before clearing the shared pending marker", async () => {
  const { pod, session, client, create } = await fixture();
  const first = await create("Original");
  const source = first.stored as StoredDocument;
  const second = client();
  await second.open(source.url);
  first.online = second.online = false;
  first.provider?.destroy();
  second.provider?.destroy();
  append(first, " from A");
  expect((await deleteDocument(source.url, session)).failed).toEqual([]);
  await create("Replacement");
  let arriving = true;
  vi.spyOn(session, "fetch").mockImplementation(async (input, init) => {
    if (
      arriving &&
      String(input).endsWith("/plan-copy.ttl") &&
      init?.method === "PUT" &&
      new Headers(init.headers).has("if-match")
    ) {
      arriving = false;
      append(second, " late from B");
      await second.destroy();
    }
    return pod.fetch(input, init);
  });
  await first.reconnect();
  expect(first.state).toBe("saved");
  const copy = (await client().store.read(first.recoveredCopy as string)) as StoredDocument;
  expect(JSON.stringify(await replay(copy, session))).toContain("late from B");
  expect(copy.data.body).toContain("from A");
  expect(copy.data.body).toContain("late from B");
  expect(
    pod.snapshot().resources.filter(([url]) => /plan-copy(?:-\d+)?\.ttl$/.test(url)),
  ).toHaveLength(1);
});

it("splits inline Markdown images at paragraph edges and inside headings, lists, quotes and table cells", async () => {
  const { session } = await fixture();
  const source = [
    "![First](https://example.org/first.png) trailing",
    "leading ![Last](https://example.org/last.png)",
    "# Before ![Heading](https://example.org/heading.png) after",
    "> Before ![Quote](https://example.org/quote.png) after",
    "- ![List](https://example.org/list.png) after",
    "- [x] ![Task](https://example.org/task.png) after",
    "| Column |\n| --- |\n| Before ![Cell](https://example.org/cell.png) after |",
    "Before ![Unsafe](https://user:pass@example.org/unsafe.png) after",
    "Before ![One](https://example.org/one.png)![Two](https://example.org/two.png) after",
  ].join("\n\n");
  const result = await convertImport(
    new NodeFile([source], "nested.md") as unknown as File,
    session,
    vi.fn(),
    vi.fn(),
  );
  const images: string[] = [];
  function visit(node: JSONContent) {
    if (node.type === "image") images.push(String(node.attrs?.alt));
    if (node.type === "paragraph" || node.type === "heading")
      expect(node.content?.every((child) => child.type !== "image")).not.toBe(false);
    node.content?.forEach(visit);
  }
  visit(result.json);
  expect(images).toEqual([
    "First",
    "Last",
    "Heading",
    "Quote",
    "List",
    "Task",
    "Cell",
    "One",
    "Two",
  ]);
  expect(result.html).not.toContain("user:pass");
  getSchema(baseExtensions(session.fetch)).nodeFromJSON(result.json).check();
});

it.each([
  "insertion",
  "deletion",
])("keeps unseen persisted %s updates pending until recovery confirms them", async (change) => {
  const { IndexeddbPersistence, storeState } = await import("y-indexeddb");
  const { updateMirrorMetadata } = await import("../src/apps/docs/editor/mirror-metadata");
  const docA = new Doc();
  docA.getText("text").insert(0, "Original");
  const mirrorA = new IndexeddbPersistence("pending-confirmation", docA);
  const docB = new Doc();
  const mirrorB = new IndexeddbPersistence("pending-confirmation", docB);
  try {
    await Promise.all([mirrorA.whenSynced, mirrorB.whenSynced]);
    await storeState(mirrorA, true);
    await storeState(mirrorB, true);
    const confirmed = encodeStateAsUpdate(docA);
    if (change === "insertion") docB.getText("text").insert(0, "New ");
    else docB.getText("text").delete(0, 1);
    await mirrorB.set("pending", 1);
    const clear = (state: Uint8Array) =>
      updateMirrorMetadata(
        mirrorA,
        () => ({ pending: 0 }),
        () => true,
        state,
      );
    expect(await clear(confirmed)).toBe(false);
    expect(await mirrorA.get("pending")).toBe(1);
    await storeState(mirrorA, true);
    expect(await clear(encodeStateAsUpdate(docA))).toBe(true);
    expect(await mirrorA.get("pending")).toBe(0);
  } finally {
    await mirrorA.destroy();
    await mirrorB.destroy();
    docA.destroy();
    docB.destroy();
  }
});
