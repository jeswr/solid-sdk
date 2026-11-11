// AUTHORED-BY Codex
import { SolidPersistence } from "@jeswr/y-solid";
import { generateHTML, getSchema } from "@tiptap/react";
import { prosemirrorJSONToYDoc } from "@tiptap/y-tiptap";
import { clearDocument, IndexeddbPersistence, storeState } from "y-indexeddb";
import type { PodSession } from "@/lib/session/pod-session";
import { type ImportProgress, importDocx } from "../lib/convert/docx-import";
import { validateImportFile } from "../lib/convert/import-file";
import { importTransaction } from "../lib/convert/import-transaction";
import { importMarkdown } from "../lib/convert/markdown";
import { importHtml, importPlainText } from "../lib/convert/schema";
import { wordCount } from "../lib/editor/logic";
import { createDocsStore, docContainerUrls, type StoredDocument } from "../lib/model";
import {
  DocumentReplacedError,
  incarnationMirror,
  sameIncarnation,
} from "../lib/model/incarnation";
import { baseExtensions } from "./extensions";
import { DocumentUpdateStore } from "./update-store";

export { validateImportFile };
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
    const mapped = result.json
      ? { json: result.json, skipped: result.skipped }
      : importHtml(result.html, result.skipped);
    return {
      ...mapped,
      html: generateHTML(mapped.json, extensions),
      title: file.name.replace(/\.docx$/i, "").slice(0, 200),
    };
  }
  const source = await file.text();
  const result = /\.html?$/i.test(file.name)
    ? { ...importHtml(source), title: file.name.replace(/\.[^.]+$/, "").slice(0, 200) }
    : /\.txt$/i.test(file.name)
      ? { ...importPlainText(source), title: file.name.replace(/\.[^.]+$/, "").slice(0, 200) }
      : importMarkdown(source, file.name);
  return { ...result, html: generateHTML(result.json, extensions) };
}

/** Shared entry for Upload and Drive's Open with Docs. Returns the created pod resource. */
export async function importDocument(
  file: File,
  session: PodSession,
  progress: (value: ImportProgress) => void,
) {
  validateImportFile(file);
  const transaction = importTransaction(session);
  session = { ...session, fetch: transaction.fetch };
  let mirror: string | undefined;
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
    mirror = incarnationMirror(stored, stored.data.updateLog as string);
    const local = new IndexeddbPersistence(mirror, doc);
    const expected = stored;
    const provider = new SolidPersistence({
      doc,
      store: new DocumentUpdateStore(
        stored.data.updateLog as string,
        session.fetch,
        async () => {
          const remote = await store.read(expected.url);
          if (
            !remote ||
            !sameIncarnation(expected, remote) ||
            remote.data.updateLog !== expected.data.updateLog
          )
            throw new DocumentReplacedError();
        },
        true,
        stored.data.instanceId,
      ),
    });
    try {
      await local.whenSynced;
      await local.set("title", result.title);
      await local.set("stored", JSON.stringify({ webId: session.webId, document: stored }));
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
    try {
      await Promise.all([mirror ? clearDocument(mirror) : undefined, transaction.rollback()]);
    } catch (cleanupError) {
      throw new Error(
        "Import failed and the incomplete document couldn't be fully removed. Check your connection and remove it from Docs before trying again. Your original file wasn't changed.",
        { cause: cleanupError },
      );
    }
    throw error;
  }
}
