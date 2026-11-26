// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { refuseRedirects } from "@jeswr/guarded-fetch";
import { checkOwnerOnly, createOwnerOnlyDestinationVerifier } from "@jeswr/pod-access";
import type { StorageClient } from "@jeswr/storage-client";
import { uploadPodImage } from "../../docs/lib/editor/image-upload";
import { buildDocument, parseDocument } from "../../docs/lib/model/document";
import { ResourceWriteError } from "../../docs/lib/model/errors";
import { DOCS_SLUG, docContainerUrls, isDirectChild } from "../../docs/lib/model/layout";
import { writeRdf } from "../../docs/lib/model/rdf-io";
import {
  type CreatePreparation,
  createDocsStore,
  type StoredDocument,
} from "../../docs/lib/model/store";
import { PREFIXES } from "../../docs/lib/model/vocab";
import { ByteLimitError, noteImageSource, notesMediaContainer, readCappedBlob } from "./images";
import type { StoredNote } from "./model/store";

export type NoteDocsMode = "copy" | "move";
/** Raised before anything is written when the Docs destination could expose private text. */
export class CopyToDocsPrivacyError extends Error {
  constructor() {
    super(
      "Docs can't be confirmed as private, so this note wasn't copied. Make your Docs folder private (only you) and try again.",
    );
    this.name = "CopyToDocsPrivacyError";
  }
}

/** The two privacy dependencies, built on the shared owner-only verifier and checker. */
export function createNoteDocsPrivacy(options: {
  podRoot: string;
  webId: string;
  openStorage: () => StorageClient | Promise<StorageClient>;
}): Pick<Dependencies, "destinationIsOwnerOnly" | "noteTreatedAsPrivate"> {
  const { podRoot, webId, openStorage } = options;
  return {
    destinationIsOwnerOnly: createOwnerOnlyDestinationVerifier({
      podRoot,
      ownerWebId: webId,
      openStorage,
    }),
    // Only a note proven public-readable (every reason a non-owner grant, one a public read)
    // may go to a Docs destination that is not owner-only. pod-access cannot compare two
    // audiences, so a note shared with specific people still needs an owner-only destination.
    noteTreatedAsPrivate: async (url) => {
      const result = await checkOwnerOnly({
        storage: await openStorage(),
        url,
        ownerWebId: webId,
      });
      return (
        result.private ||
        result.reasons.some((reason) => reason.reason !== "non-owner") ||
        !result.reasons.some(
          (reason) => reason.subject === "public" && reason.modes.includes("read"),
        )
      );
    },
  };
}

/** Matches validateImage's limit; enforced while reading, before the bytes are buffered. */
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

/** Read an image body through the 20 MB byte cap. */
export async function readCappedImage(response: Response, max = MAX_IMAGE_BYTES): Promise<Blob> {
  try {
    return await readCappedBlob(response, max);
  } catch (error) {
    if (error instanceof ByteLimitError) throw new Error("Images must be under 20 MB");
    throw error;
  }
}

interface Dependencies {
  fetchImpl: typeof fetch;
  podRoot: string;
  webId: string;
  assertMovable: (note: StoredNote) => Promise<void>;
  trash: (note: StoredNote) => Promise<unknown>;
  /** True only when the shared owner-only verifier proves the destination owner-only. */
  destinationIsOwnerOnly: (url: string) => Promise<boolean>;
  /**
   * False only when the shared verifier proves the note is public-readable; unverifiable, owner-only
   * and shared-with-specific-people all mean true (audiences cannot be compared).
   */
  noteTreatedAsPrivate: (url: string) => Promise<boolean>;
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
    const { podRoot, webId, assertMovable, trash, destinationIsOwnerOnly, noteTreatedAsPrivate } =
      dependencies;
    const fetchImpl = refuseRedirects(dependencies.fetchImpl);
    if (mode === "move") await assertMovable(note);
    // A private note's text and images may only go to a verified owner-only destination. Never
    // loosen an ACL to pass this: refuse. An unverifiable note or destination counts as exposed;
    // only a note that is verifiably public-readable may go to a Docs that is not owner-only.
    let noteIsPrivate: boolean | undefined;
    const requireOwnerOnly = async (url: string) => {
      let destination = false;
      try {
        destination = await destinationIsOwnerOnly(url);
      } catch {
        // An unverifiable destination is a refusal.
      }
      if (destination) return;
      noteIsPrivate ??= await noteTreatedAsPrivate(note.url).catch(() => true);
      if (noteIsPrivate) throw new CopyToDocsPrivacyError();
    };
    const key = JSON.stringify([webId, podRoot, note.url]);
    let conversion = conversions.get(key);
    if (!conversion) {
      conversion = { uploads: new Map() };
      conversions.set(key, conversion);
    }
    const { uploads } = conversion;
    let preparedBody = note.body;
    const prepare = async (assets: string) => {
      // The verifier takes a prospective document URL, not a container: probe a child.
      await requireOwnerOnly(`${assets}${crypto.randomUUID()}`);
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
            upload.file = await readCappedImage(response);
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
      // The stored document may have its own policy: verify it before any content write.
      await requireOwnerOnly(document.url);
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
      // Check the Docs folder itself before reserving anything under it.
      await requireOwnerOnly(`${new URL(DOCS_SLUG, podRoot).href}${crypto.randomUUID()}.ttl`);
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
