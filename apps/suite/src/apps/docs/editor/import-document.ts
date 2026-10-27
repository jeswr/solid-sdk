// AUTHORED-BY Codex
import { SolidPersistence } from "@jeswr/y-solid";
import { generateHTML, generateJSON, getSchema, type JSONContent } from "@tiptap/react";
import { prosemirrorJSONToYDoc } from "@tiptap/y-tiptap";
import { IndexeddbPersistence, storeState } from "y-indexeddb";
import type { PodSession } from "@/lib/session/pod-session";
import { type ImportProgress, importDocx, MAX_IMPORT_BYTES } from "../lib/convert/docx-import";
import { importMarkdown } from "../lib/convert/markdown";
import { wordCount } from "../lib/editor/logic";
import { createDocsStore, docContainerUrls, type StoredDocument } from "../lib/model";
import { baseExtensions } from "./extensions";
import { deleteDocument } from "./operations";

export function validateImportFile(file: Pick<File, "name" | "size">) {
  if (file.size > MAX_IMPORT_BYTES) throw new Error("Choose a file of 50 MB or less");
  if (!/\.(docx|md|markdown)$/i.test(file.name)) throw new Error("Choose a DOCX or Markdown file");
}
export async function uploadImportImage(
  session: PodSession,
  resource: string,
  data: ArrayBuffer,
  contentType: string,
) {
  const extension = (
    {
      "image/png": "png",
      "image/jpeg": "jpg",
      "image/gif": "gif",
      "image/webp": "webp",
      "image/svg+xml": "svg",
      "image/bmp": "bmp",
    } as Record<string, string>
  )[contentType];
  if (!extension) throw new Error("This image format isn't supported");
  const url = `${docContainerUrls(resource).assets}${crypto.randomUUID()}.${extension}`;
  const response = await session.fetch(url, {
    method: "PUT",
    redirect: "error",
    headers: { "content-type": contentType, "if-none-match": "*" },
    body: data,
  });
  if (!response.ok) throw new Error("We couldn't upload an image. Try importing again.");
  return url;
}
export async function convertImport(
  file: File,
  session: PodSession,
  uploadImage: (data: ArrayBuffer, type: string) => Promise<string>,
  progress: (value: ImportProgress) => void,
) {
  validateImportFile(file);
  const extensions = baseExtensions(session.fetch);
  if (/\.docx$/i.test(file.name)) {
    const result = await importDocx(await file.arrayBuffer(), { uploadImage, progress });
    const json: JSONContent = generateJSON(result.html, extensions);
    return { ...result, json, title: file.name.replace(/\.docx$/i, "").slice(0, 200) };
  }
  const result = importMarkdown(await file.text(), file.name);
  return { ...result, html: generateHTML(result.json, extensions), skipped: [] };
}

/** Shared entry for Upload and Drive's Open with Docs. Returns the created pod resource. */
export async function importDocument(
  file: File,
  session: PodSession,
  progress: (value: ImportProgress) => void,
) {
  validateImportFile(file);
  const store = createDocsStore({
    podRoot: session.storageUrl,
    webId: session.webId,
    fetchImpl: session.fetch,
  });
  let stored: StoredDocument | undefined;
  const ensureTarget = async () => {
    stored ??= await store.create({
      title: file.name.replace(/\.[^.]+$/, ""),
      body: "<p></p>",
      format: "text/html",
    });
    return stored;
  };
  try {
    const result = await convertImport(
      file,
      session,
      async (data, type) => uploadImportImage(session, (await ensureTarget()).url, data, type),
      progress,
    );
    const snapshot = {
      body: result.html,
      format: "text/html",
      wordCount: wordCount(result.json).words,
    };
    const target = await ensureTarget();
    stored = await store.save(
      target,
      { ...snapshot, title: result.title },
      { regenerate: () => snapshot },
    );
    const doc = prosemirrorJSONToYDoc(
      getSchema(baseExtensions(session.fetch)),
      result.json,
      "prosemirror",
    );
    doc.getMap("document").set("instanceId", stored.data.instanceId);
    const local = new IndexeddbPersistence(stored.url, doc);
    const provider = new SolidPersistence({
      doc,
      container: docContainerUrls(stored.url).updateLog,
      fetch: session.fetch,
    });
    try {
      await local.whenSynced;
      await local.set("title", result.title);
      await provider.whenSynced;
      await provider.persistFullState();
      await storeState(local, true);
    } finally {
      provider.destroy();
      await local.destroy();
      doc.destroy();
    }
    return { url: stored.url, skipped: result.skipped };
  } catch (error) {
    if (stored) await deleteDocument(stored.url, session).catch(() => {});
    throw error;
  }
}
