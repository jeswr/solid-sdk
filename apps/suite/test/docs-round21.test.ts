// @vitest-environment jsdom
// AUTHORED-BY Codex
import { Blob as NodeBlob, File as NodeFile } from "node:buffer";
import { createRequire } from "node:module";
import { generateJSON, getSchema, type JSONContent } from "@tiptap/react";
import { prosemirrorJSONToYDoc, yDocToProsemirrorJSON } from "@tiptap/y-tiptap";
import { Packer } from "docx";
import { openArrayBuffer } from "mammoth/lib/zipfile";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { applyUpdate, encodeStateAsUpdate } from "yjs";
import { baseExtensions } from "../src/apps/docs/editor/extensions";
import { convertImport, importDocument } from "../src/apps/docs/editor/import-document";
import { DocumentPersistence } from "../src/apps/docs/editor/persistence";
import { toDocx } from "../src/apps/docs/lib/convert/docx-export";
import { wordCount } from "../src/apps/docs/lib/editor/logic";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import { buildDemoSeed, DEMO_NAME, DEMO_ROOT, DEMO_WEBID } from "../src/lib/demo-pod/seed";
import type { PodSession } from "../src/lib/session/pod-session";

const { IDBFactory, IDBKeyRange: KeyRange } = createRequire(
  `${process.cwd()}/../../packages/solid-offline/package.json`,
)("fake-indexeddb") as { IDBFactory: new () => IDBFactory; IDBKeyRange: typeof IDBKeyRange };
const runtimes: DocumentPersistence[] = [];
const schema = getSchema(baseExtensions(vi.fn()));
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
function replace(runtime: DocumentPersistence, json: JSONContent, html: string) {
  const fragment = runtime.doc.getXmlFragment("prosemirror");
  fragment.delete(0, fragment.length);
  const seed = prosemirrorJSONToYDoc(schema, json);
  applyUpdate(runtime.doc, encodeStateAsUpdate(seed));
  seed.destroy();
  runtime.change(html, json);
}

async function expectDocxReplacement(content: JSONContent[]) {
  const { session, client } = await fixture();
  const original = schema.nodeFromJSON({ type: "doc", content }).toJSON();
  const runtime = client();
  await runtime.open();
  runtime.title = "Round22 replacement";
  replace(
    runtime,
    schema.nodeFromJSON({ type: "doc", content: [{ type: "paragraph" }] }).toJSON(),
    "<p></p>",
  );
  await runtime.flush();
  const url = runtime.stored?.url as string;
  const data = await Packer.toArrayBuffer(await toDocx(original, vi.fn()));
  const converted = await convertImport(
    new NodeFile([data], "round22.docx") as unknown as File,
    session,
    vi.fn(),
    vi.fn(),
  );
  expect(converted.skipped).toEqual([
    { label: "Some formatting may differ from the original", count: 1 },
  ]);
  expect(converted.json).toEqual(original);
  replace(runtime, converted.json, converted.html);
  await runtime.flush();
  expect(runtime.state).toBe("saved");
  expect(
    generateJSON(
      (await runtime.store.read(url))?.data.body as string,
      baseExtensions(session.fetch),
    ),
  ).toEqual(original);
  await runtime.destroy();
  const reopened = client();
  await reopened.open(url);
  expect(schema.nodeFromJSON(yDocToProsemirrorJSON(reopened.doc)).toJSON()).toEqual(original);
}

it.each([
  "printf 'a  b'",
  "  printf\t'a   b'\t\t  ",
])("round22 DOCX inline code preserves spaces and tabs through replacement, snapshot and reopen: %j", async (code) => {
  await expectDocxReplacement([
    {
      type: "paragraph",
      content: [
        { type: "text", text: "Run " },
        { type: "text", text: code, marks: [{ type: "code" }] },
        { type: "text", text: " now" },
      ],
    },
  ]);
});

it("round22 DOCX checklist preserves Parent, indented Child and Sibling through replacement, snapshot and reopen", async () => {
  const item = (value: string, checked: boolean, child?: JSONContent): JSONContent => ({
    type: "taskItem",
    attrs: { checked },
    content: [
      { type: "paragraph", content: [{ type: "text", text: value }] },
      ...(child ? [child] : []),
    ],
  });
  await expectDocxReplacement([
    {
      type: "taskList",
      content: [
        item("Parent", false, { type: "taskList", content: [item("Child", true)] }),
        item("Sibling", false),
      ],
    },
  ]);
});

it("round21 clamps Markdown H4 for upload, replacement, pod snapshot and reopen", async () => {
  const { session, client } = await fixture();
  const file = new NodeFile(["#### Detail\n\nBody"], "detail.md") as unknown as File;
  const converted = await convertImport(file, session, vi.fn(), vi.fn());
  expect(converted.json.content?.[0]?.attrs?.level).toBe(3);
  expect(wordCount(converted.json).words).toBe(2);
  const uploaded = await importDocument(file, session, vi.fn());
  const runtime = client();
  await runtime.open(uploaded.url);
  replace(runtime, converted.json, converted.html);
  await runtime.flush();
  expect(runtime.state).toBe("saved");
  expect((await runtime.store.read(uploaded.url))?.data.body).toContain("<h3>Detail</h3>");
  await runtime.destroy();
  const reopened = client();
  await reopened.open(uploaded.url);
  expect(schema.nodeFromJSON(yDocToProsemirrorJSON(reopened.doc)).toJSON()).toEqual(converted.json);
  await reopened.flush();
  expect(reopened.state).toBe("saved");
});

it.each([
  "if ready:\n    launch()",
  "if ready:\n    launch()\n\tfinish()",
  "\n\nif ready:\n    launch()\n\n",
])("round21 DOCX code retains its style and indentation through replacement, snapshot and reopen: %j", async (code) => {
  const { session, client } = await fixture();
  const original = schema
    .nodeFromJSON({
      type: "doc",
      content: [{ type: "codeBlock", content: [{ type: "text", text: code }] }],
    })
    .toJSON();
  const data = await Packer.toArrayBuffer(await toDocx(original, vi.fn()));
  const converted = await convertImport(
    new NodeFile([data], "code.docx") as unknown as File,
    session,
    vi.fn(),
    vi.fn(),
  );
  expect(converted.json).toEqual(original);
  expect(converted.skipped).toEqual([
    { label: "Some formatting may differ from the original", count: 1 },
  ]);
  const archive = await openArrayBuffer(data);
  const xml = await archive.read("word/document.xml", "utf-8");
  expect(xml).toContain('<w:pStyle w:val="Code"');
  expect(xml).toContain('xml:space="preserve">    launch()');
  if (code.includes("\t")) expect(xml).toContain("<w:tab/>");
  const runtime = client();
  await runtime.open();
  runtime.title = "Code";
  replace(runtime, converted.json, converted.html);
  await runtime.flush();
  expect(runtime.state).toBe("saved");
  const url = runtime.stored?.url as string;
  expect(
    generateJSON(
      (await runtime.store.read(url))?.data.body as string,
      baseExtensions(session.fetch),
    ),
  ).toEqual(original);
  await runtime.destroy();
  const reopened = client();
  await reopened.open(url);
  expect(schema.nodeFromJSON(yDocToProsemirrorJSON(reopened.doc)).toJSON()).toEqual(original);
});

it.each([
  { type: "heading", attrs: { level: 4 }, content: [{ type: "text", text: "Detail" }] },
  { type: "paragraph", content: [{ type: "paragraph" }] },
])("round21 invalid saved documents stop retrying after reopen and can save after repair: %j", async (node) => {
  const { client } = await fixture();
  const runtime = client();
  await runtime.open();
  runtime.title = "Repair";
  const valid = {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: "Valid" }] }],
  };
  replace(runtime, valid, "<p>Valid</p>");
  await runtime.flush();
  const url = runtime.stored?.url as string;
  replace(runtime, { type: "doc", content: [node] }, "<p>Invalid</p>");
  await runtime.flush();
  expect(runtime.state).toBe("failed");
  expect((await runtime.store.read(url))?.data.body).toBe("<p>Valid</p>");
  await runtime.destroy();
  const reopened = client();
  await reopened.open(url);
  const timer = vi.spyOn(globalThis, "setTimeout");
  await reopened.flush();
  expect(reopened.state).toBe("failed");
  expect(timer.mock.calls.some(([, delay]) => delay === 4000)).toBe(false);
  replace(reopened, valid, "<p>Valid</p>");
  await reopened.flush();
  expect(reopened.state).toBe("saved");
});

it("round21 invalid snapshot validation surfaces failure without scheduling endless retries", async () => {
  const { client } = await fixture();
  const runtime = client();
  await runtime.open();
  runtime.title = "Invalid snapshot";
  const invalid = {
    type: "doc",
    content: [
      { type: "heading", attrs: { level: 4 }, content: [{ type: "text", text: "Detail" }] },
    ],
  };
  replace(runtime, invalid, "<h4>Detail</h4>");
  const reconnect = vi.spyOn(runtime, "reconnect");
  const timer = vi.spyOn(globalThis, "setTimeout");
  await runtime.flush();
  expect(runtime.state).toBe("failed");
  expect(timer.mock.calls.some(([, delay]) => delay === 4000)).toBe(false);
  expect(reconnect).not.toHaveBeenCalled();
  const notify = vi.fn();
  runtime.notify = notify;
  await runtime.flush();
  expect(notify).not.toHaveBeenCalled();
});
