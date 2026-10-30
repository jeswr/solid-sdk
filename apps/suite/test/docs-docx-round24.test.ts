// @vitest-environment jsdom
// AUTHORED-BY Codex
import { Blob as NodeBlob, File as NodeFile } from "node:buffer";
import { createRequire } from "node:module";
import { Editor, generateHTML, type JSONContent } from "@tiptap/react";
import { yDocToProsemirrorJSON } from "@tiptap/y-tiptap";
import { Packer } from "docx";
import { openArrayBuffer } from "mammoth/lib/zipfile";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { baseExtensions, editorExtensions } from "../src/apps/docs/editor/extensions";
import {
  convertImport,
  importDocument,
  uploadImportImage,
} from "../src/apps/docs/editor/import-document";
import { deleteDocument } from "../src/apps/docs/editor/operations";
import { DocumentPersistence } from "../src/apps/docs/editor/persistence";
import { importDocx } from "../src/apps/docs/lib/convert/docx-import";
import { embeddedDocument } from "../src/apps/docs/lib/convert/docx-payload";
import { normaliseImport } from "../src/apps/docs/lib/convert/schema";
import { createDocsStore, docContainerUrls } from "../src/apps/docs/lib/model";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import { buildDemoSeed, DEMO_NAME, DEMO_ROOT, DEMO_WEBID } from "../src/lib/demo-pod/seed";
import type { PodSession } from "../src/lib/session/pod-session";
import { legacyDocx } from "./helpers/docs-legacy-docx";

const { IDBFactory, IDBKeyRange: KeyRange } = createRequire(
  `${process.cwd()}/../../packages/solid-offline/package.json`,
)("fake-indexeddb") as { IDBFactory: new () => IDBFactory; IDBKeyRange: typeof IDBKeyRange };
const runtimes: DocumentPersistence[] = [];
const pixel = new Uint8Array(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=",
    "base64",
  ),
);
beforeEach(() => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("IDBKeyRange", KeyRange);
  vi.stubGlobal("BroadcastChannel", undefined);
  vi.stubGlobal("Blob", NodeBlob);
  vi.stubGlobal("fetch", vi.fn());
  vi.stubGlobal("URL", class extends URL {});
  URL.createObjectURL = vi.fn(() => "blob:imported-image");
  URL.revokeObjectURL = vi.fn();
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
    storageUrl: DEMO_ROOT,
    webId: DEMO_WEBID,
    displayName: DEMO_NAME,
    fetch: vi.fn(pod.fetch),
    subscribe: pod.subscribe,
    reset: async () => {},
  };
  const store = createDocsStore({
    podRoot: session.storageUrl,
    webId: session.webId,
    fetchImpl: session.fetch,
  });
  const original = await store.create({ title: "Original", body: "<p></p>" });
  const src = await uploadImportImage(session, original.url, pixel.buffer, "image/png");
  const json = normaliseImport({
    type: "doc",
    content: [{ type: "image", attrs: { src, alt: "Uploaded pixel", width: 24, height: 24 } }],
  }).json;
  const snapshot = { body: generateHTML(json, baseExtensions(session.fetch)), format: "text/html" };
  await store.save(original, snapshot, { regenerate: () => snapshot });
  const data = await Packer.toArrayBuffer(
    await legacyDocx(json, async (url) => ({
      data: new Uint8Array(await (await session.fetch(url)).arrayBuffer()),
      type: "png",
      width: 1,
      height: 1,
    })),
  );
  const client = () => {
    const runtime = new DocumentPersistence(session);
    runtimes.push(runtime);
    return runtime;
  };
  return { session, store, original, src, json, data, client };
}
const file = (data: ArrayBuffer) => new NodeFile([data], "image.docx") as unknown as File;
async function rewritePayload(
  archive: Awaited<ReturnType<typeof openArrayBuffer>>,
  change: (payload: { json: JSONContent; images?: unknown }) => void,
) {
  const xml = new DOMParser().parseFromString(
    await archive.read("docProps/custom.xml", "utf-8"),
    "application/xml",
  );
  const value = xml.getElementsByTagNameNS(
    "http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes",
    "lpwstr",
  )[0] as Element;
  const payload = JSON.parse(value.textContent as string);
  change(payload);
  value.textContent = JSON.stringify(payload);
  archive.write("docProps/custom.xml", new XMLSerializer().serializeToString(xml));
}

it("round24 restores an embedded DOCX image after trashing the original, saving and reopening", async () => {
  const f = await fixture();
  await deleteDocument(f.original.url, f.session);
  expect((await f.session.fetch(f.src)).status).toBe(404);
  const progress = vi.fn();
  const imported = await importDocument(file(f.data), f.session, progress);
  expect(imported.skipped).toEqual([]);
  const runtime = f.client();
  await runtime.open(imported.url);
  await runtime.flush();
  await runtime.destroy();
  const reopened = f.client();
  await reopened.open(imported.url);
  const json = yDocToProsemirrorJSON(reopened.doc) as JSONContent;
  const src = json.content?.[0]?.attrs?.src as string;
  expect(src.startsWith(docContainerUrls(imported.url).assets)).toBe(true);
  expect(src).not.toBe(f.src);
  const response = await f.session.fetch(src);
  expect(response.ok).toBe(true);
  expect(response.headers.get("content-type")).toBe("image/png");
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(pixel);
  expect((await f.store.read(imported.url))?.data.body).toContain(src);
  expect((await f.store.read(imported.url))?.data.body).not.toContain(f.src);
  expect(progress.mock.calls).toEqual([[{ completed: 0, total: 1 }], [{ completed: 1, total: 1 }]]);
  const editor = new Editor({
    element: document.createElement("div"),
    extensions: editorExtensions(reopened.doc, f.session.fetch),
  });
  try {
    await vi.waitFor(() => expect(URL.createObjectURL).toHaveBeenCalledTimes(1));
    const image = editor.view.dom.querySelector("img");
    expect(image?.src).toBe("blob:imported-image");
    expect(image?.alt).toBe("Uploaded pixel");
    expect(image?.dataset.docsImageState).not.toBe("error");
  } finally {
    editor.destroy();
  }
});

it("round24 imports the same embedded image into separate documents with their own asset copies", async () => {
  const f = await fixture();
  const urls: string[] = [];
  for (let i = 0; i < 2; i++) {
    const imported = await importDocument(file(f.data), f.session, vi.fn());
    const runtime = f.client();
    await runtime.open(imported.url);
    const src = (yDocToProsemirrorJSON(runtime.doc) as JSONContent).content?.[0]?.attrs
      ?.src as string;
    expect(src.startsWith(docContainerUrls(imported.url).assets)).toBe(true);
    expect(src).not.toBe(f.src);
    expect(new Uint8Array(await (await f.session.fetch(src)).arrayBuffer())).toEqual(pixel);
    urls.push(src);
  }
  expect(new Set(urls).size).toBe(2);
});

it("round24 never fetches a tampered embedded image src at another origin", async () => {
  const f = await fixture();
  const archive = await openArrayBuffer(f.data);
  const foreign = "https://attacker.test/track.png";
  await rewritePayload(archive, (payload) => {
    (payload.json.content?.[0] as JSONContent).attrs = {
      ...f.json.content?.[0]?.attrs,
      src: foreign,
    };
  });
  vi.mocked(f.session.fetch).mockClear();
  const target = await f.store.create({ title: "Imported", body: "<p></p>" });
  const result = await convertImport(
    file(await archive.toArrayBuffer()),
    f.session,
    (data, type) => uploadImportImage(f.session, target.url, data, type),
    vi.fn(),
  );
  const src = result.json.content?.[0]?.attrs?.src as string;
  expect(src.startsWith(docContainerUrls(target.url).assets)).toBe(true);
  expect(result.html).not.toContain(foreign);
  expect(result.skipped).toEqual([]);
  expect(globalThis.fetch).not.toHaveBeenCalled();
  expect(vi.mocked(f.session.fetch).mock.calls.some(([url]) => String(url) === foreign)).toBe(
    false,
  );
  expect(new Uint8Array(await (await f.session.fetch(src)).arrayBuffer())).toEqual(pixel);
});

it.each([
  "missing",
  "incomplete",
  "extra",
  "wrong media part",
  "external path",
  "extra image node",
])("round24 falls back with a visible warning for %s image mappings", async (kind) => {
  const f = await fixture();
  const archive = await openArrayBuffer(f.data);
  await rewritePayload(archive, (payload) => {
    const images = payload.images as string[];
    if (kind === "missing") delete payload.images;
    if (kind === "incomplete") payload.images = [];
    if (kind === "extra") payload.images = [...images, ...images];
    if (kind === "wrong media part") payload.images = ["word/media/not-the-image.png"];
    if (kind === "external path") payload.images = ["https://attacker.test/image.png"];
    if (kind === "extra image node") {
      payload.json.content?.push(f.json.content?.[0] as JSONContent);
      payload.images = [...images, ...images];
    }
  });
  const upload = vi.fn(async (_data: ArrayBuffer, _type: string) => "https://pod.test/new.png");
  const result = await convertImport(
    file(await archive.toArrayBuffer()),
    f.session,
    upload,
    vi.fn(),
  );
  expect(result.skipped).toEqual([
    { label: "Some formatting may differ from the original", count: 1 },
  ]);
  expect(result.json.content?.[0]?.attrs?.src).toBe("https://pod.test/new.png");
  expect(upload).toHaveBeenCalledTimes(1);
  expect(new Uint8Array(upload.mock.calls[0]?.[0] as ArrayBuffer)).toEqual(pixel);
  expect(result.html).not.toContain(f.src);
  expect(globalThis.fetch).not.toHaveBeenCalled();
});

it("round24 warns instead of restoring an image that could not be packaged during export", async () => {
  const json = normaliseImport({
    type: "doc",
    content: [{ type: "image", attrs: { src: "https://pod.test/gone.png", alt: "Missing" } }],
  }).json;
  const data = await Packer.toArrayBuffer(
    await legacyDocx(json, async () => {
      throw new Error("Original asset is missing");
    }),
  );
  const upload = vi.fn();
  const result = await convertImport(file(data), {} as PodSession, upload, vi.fn());
  expect(result.skipped).toEqual([
    { label: "Some formatting may differ from the original", count: 1 },
  ]);
  expect(result.html).toContain("[Image unavailable: Missing]");
  expect(result.html).not.toContain("https://pod.test/gone.png");
  expect(upload).not.toHaveBeenCalled();
});

it.each([
  "missing relationship",
  "missing target",
  "wrong relationship type",
  "external relationship",
  "path traversal",
  "unsupported image type",
  "missing media part",
])("round24 rejects canonical images with a %s without fetching URLs", async (kind) => {
  const f = await fixture();
  const archive = await openArrayBuffer(f.data);
  const part = "word/_rels/document.xml.rels";
  const xml = new DOMParser().parseFromString(await archive.read(part, "utf-8"), "application/xml");
  const relation = Array.from(xml.getElementsByTagName("Relationship")).find((item) =>
    item.getAttribute("Type")?.endsWith("/image"),
  ) as Element;
  if (kind === "missing relationship") relation.remove();
  if (kind === "missing target") relation.removeAttribute("Target");
  if (kind === "wrong relationship type") relation.setAttribute("Type", "unexpected");
  if (kind === "external relationship") relation.setAttribute("TargetMode", "External");
  if (kind === "path traversal") relation.setAttribute("Target", "media/../outside.png");
  if (kind === "unsupported image type") relation.setAttribute("Target", "media/image.tiff");
  if (kind === "missing media part") relation.setAttribute("Target", "media/missing.png");
  archive.write(part, new XMLSerializer().serializeToString(xml));
  vi.mocked(f.session.fetch).mockClear();
  expect(await embeddedDocument(archive)).toBeUndefined();
  expect(f.session.fetch).not.toHaveBeenCalled();
  expect(globalThis.fetch).not.toHaveBeenCalled();
});

it("round24 maps repeated and nested images by package order and preserves canonical attributes", async () => {
  const image = (alt: string): JSONContent => ({
    type: "image",
    attrs: { src: "https://pod.test/same-source-url", alt, title: "Title", width: 36, height: 24 },
  });
  const original = normaliseImport({
    type: "doc",
    content: [
      image("First PNG"),
      { type: "blockquote", content: [image("JPEG")] },
      {
        type: "bulletList",
        content: [
          {
            type: "listItem",
            content: [
              { type: "paragraph", content: [{ type: "text", text: "Nested" }] },
              image("GIF"),
            ],
          },
        ],
      },
      {
        type: "table",
        content: [
          {
            type: "tableRow",
            content: [{ type: "tableCell", content: [image("BMP"), image("Repeated PNG")] }],
          },
        ],
      },
    ],
  }).json;
  const types = ["png", "jpg", "gif", "bmp", "png"] as const;
  const data = [[7], [8], [9], [10], [7]].map((bytes) => new Uint8Array(bytes));
  let exported = 0;
  const archive = await openArrayBuffer(
    await Packer.toArrayBuffer(
      await legacyDocx(original, async () => {
        const index = exported++;
        return {
          data: data[index] as Uint8Array<ArrayBuffer>,
          type: types[index] as (typeof types)[number],
          width: 1,
          height: 1,
        };
      }),
    ),
  );
  await rewritePayload(archive, (payload) => {
    const paths = payload.images as string[];
    expect(paths).toHaveLength(5);
    expect(paths[0]).toBe(paths[4]);
    expect(new Set(paths).size).toBe(4);
  });
  const progress = vi.fn();
  const upload = vi.fn(
    async (_data: ArrayBuffer, _type: string) =>
      `https://pod.test/import/assets/${upload.mock.calls.length}.png?x=1&y=2`,
  );
  const result = await importDocx(await archive.toArrayBuffer(), { uploadImage: upload, progress });
  let index = 0;
  function rewritten(node: JSONContent): JSONContent {
    return {
      ...node,
      ...(node.type === "image"
        ? { attrs: { ...node.attrs, src: `https://pod.test/import/assets/${++index}.png?x=1&y=2` } }
        : {}),
      ...(node.content ? { content: node.content.map(rewritten) } : {}),
    };
  }
  expect(result.json).toEqual(rewritten(original));
  expect(result.skipped).toEqual([]);
  expect(upload.mock.calls.map(([bytes]) => new Uint8Array(bytes))).toEqual(data);
  expect(upload.mock.calls.map(([, type]) => type)).toEqual([
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/bmp",
    "image/png",
  ]);
  expect(progress.mock.calls).toEqual(
    Array.from({ length: 6 }, (_, completed) => [{ completed, total: 5 }]),
  );
  expect(result.html).toContain("?x=1&amp;y=2");
  expect(result.html).not.toContain("same-source-url");
});

it("round24 rejects invalid upload URLs and propagates canonical image upload failures", async () => {
  const f = await fixture();
  await expect(
    importDocx(f.data, { uploadImage: async () => "javascript:alert(1)", progress: vi.fn() }),
  ).rejects.toThrow("Invalid uploaded image URL");
  await expect(
    importDocx(f.data, {
      uploadImage: async () => {
        throw new Error("Upload failed");
      },
      progress: vi.fn(),
    }),
  ).rejects.toThrow("Upload failed");
});
