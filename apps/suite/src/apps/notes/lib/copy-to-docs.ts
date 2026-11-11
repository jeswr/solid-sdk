// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { refuseRedirects } from "@jeswr/guarded-fetch";
import { uploadPodImage } from "../../docs/lib/editor/image-upload";
import { buildDocument, parseDocument } from "../../docs/lib/model/document";
import { ResourceWriteError } from "../../docs/lib/model/errors";
import { docContainerUrls, isDirectChild } from "../../docs/lib/model/layout";
import { writeRdf } from "../../docs/lib/model/rdf-io";
import {
  type CreatePreparation,
  createDocsStore,
  type StoredDocument,
} from "../../docs/lib/model/store";
import { PREFIXES } from "../../docs/lib/model/vocab";
import { noteImageSource, notesMediaContainer } from "./images";
import type { StoredNote } from "./model/store";

export type NoteDocsMode = "copy" | "move";
interface Dependencies {
  fetchImpl: typeof fetch;
  podRoot: string;
  webId: string;
  assertMovable: (note: StoredNote) => Promise<void>;
  trash: (note: StoredNote) => Promise<unknown>;
}
interface Upload {
  id: string;
  file?: Blob;
  src?: string;
}
interface Conversion {
  document?: StoredDocument;
  title?: string;
  body?: string;
  preparation?: CreatePreparation;
  uploads: Map<string, Upload>;
}

/** Inert HTML traversal preserves foreign images and all non-src image attributes. */
export async function copyNoteImages(
  body: string,
  podRoot: string,
  copy: (src: string) => Promise<string>,
): Promise<string> {
  const parsed = new window.DOMParser().parseFromString(body, "text/html");
  const replacements = new Map<string, string>();
  for (const image of parsed.querySelectorAll("img")) {
    const src = noteImageSource(image.getAttribute("src") ?? "", podRoot);
    if (!src || !isDirectChild(src, notesMediaContainer(podRoot))) continue;
    let target = replacements.get(src);
    if (!target) {
      target = await copy(src);
      replacements.set(src, target);
    }
    image.setAttribute("src", target);
  }
  return replacements.size ? parsed.body.innerHTML : body;
}

/** One editor/card owns this retry cache. Successful actions start a fresh copy next time. */
export function createNoteDocsConverter() {
  const conversions = new Map<string, Conversion>();
  return async function convert(
    note: StoredNote,
    mode: NoteDocsMode,
    dependencies: Dependencies,
  ): Promise<StoredDocument> {
    const { podRoot, webId, assertMovable, trash } = dependencies;
    const fetchImpl = refuseRedirects(dependencies.fetchImpl);
    if (mode === "move") await assertMovable(note);
    const key = JSON.stringify([webId, podRoot, note.url]);
    let conversion = conversions.get(key);
    if (!conversion) {
      conversion = { uploads: new Map() };
      conversions.set(key, conversion);
    }
    const { uploads } = conversion;
    let preparedBody = note.body;
    const prepare = async (assets: string) => {
      const body = await copyNoteImages(note.body, podRoot, async (source) => {
        const uploadKey = JSON.stringify([assets, source]);
        let upload = uploads.get(uploadKey);
        if (!upload) {
          upload = { id: crypto.randomUUID() };
          uploads.set(uploadKey, upload);
        }
        if (!upload.src) {
          if (!upload.file) {
            const response = await fetchImpl(source);
            if (!response.ok) throw new Error("Image unavailable");
            upload.file = await response.blob();
          }
          upload.src = await uploadPodImage(upload.file, assets, fetchImpl, upload.id);
        }
        return upload.src;
      });
      preparedBody = body;
      return { body, format: "text/html" };
    };
    const input = {
      title: note.title || "Untitled document",
      body: note.body,
      format: "text/html",
    };
    if (conversion.document && (conversion.title !== note.title || conversion.body !== note.body)) {
      const document = conversion.document;
      const dataset = buildDocument(document.url, {
        ...document.data,
        ...input,
        ...(await prepare(docContainerUrls(document.url).assets)),
        priorRevisions: document.data.revisions,
        editor: webId,
      });
      try {
        const { etag } = await writeRdf(document.url, dataset, {
          etag: document.etag,
          fetchImpl,
          prefixes: PREFIXES,
        });
        conversion.document = {
          url: document.url,
          etag,
          data: parseDocument(document.url, dataset) as StoredDocument["data"],
        };
      } catch (error) {
        if (!(error instanceof ResourceWriteError && error.status === 412)) throw error;
        // Preserve someone else's edit and give the current note a fresh destination.
        delete conversion.document;
        delete conversion.preparation;
      }
    }
    if (!conversion.document) {
      if (!conversion.preparation) conversion.preparation = { prepare };
      conversion.preparation.prepare = prepare;
      conversion.document = await createDocsStore({ fetchImpl, podRoot, webId }).create(
        input,
        undefined,
        conversion.preparation,
      );
      // A lost publication response may recover an older snapshot after the note was edited.
      if (
        conversion.document.data.body !== preparedBody ||
        conversion.document.data.title !== input.title
      ) {
        conversion.title = conversion.document.data.title;
        conversion.body = conversion.document.data.body;
        return convert(note, mode, dependencies);
      }
    }
    conversion.title = note.title;
    conversion.body = note.body;
    if (mode === "move") await trash(note);
    const document = conversion.document;
    conversions.delete(key);
    return document;
  };
}
