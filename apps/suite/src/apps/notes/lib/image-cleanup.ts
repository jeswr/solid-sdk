// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { RdfFetchError } from "@jeswr/fetch-rdf";
import { normalizePodBase, refuseRedirects } from "@jeswr/guarded-fetch";
import { parseContainerMembers } from "@jeswr/ldp-container";
import { Container, ContainerDataset } from "@solid/object";
import { DataFactory } from "n3";
import { parseDocument } from "../../docs/lib/model/document";
import { ResourceDeleteError } from "../../docs/lib/model/errors";
import { DOCS_SLUG, isDirectChild, LEGACY_DOCS_SLUG } from "../../docs/lib/model/layout";
import { deleteRdf, readRdf } from "../../docs/lib/model/rdf-io";
import { NS } from "../../docs/lib/model/vocab";
import { noteImageSource, notesMediaContainer } from "./images";
import type { Note } from "./model/note";

export interface UnusedNoteImage {
  readonly url: string;
  readonly bytes: number;
  readonly etag: string | null;
}
export interface NoteImageCleanupPlan {
  readonly images: readonly UnusedNoteImage[];
  readonly totalBytes: number;
}
export interface NoteImageCleanupResult {
  /** Counts cover processed images; a stopped batch leaves the rest untouched. */
  readonly deleted: number;
  readonly kept: number;
  readonly failed: number;
  readonly stopped?: "offline" | "failed";
}

function mediaFile(url: string, podRoot: string): boolean {
  return (
    noteImageSource(url, podRoot) === url &&
    isDirectChild(url, notesMediaContainer(podRoot)) &&
    !/\.(acl|acr)$/i.test(decodeURIComponent(url))
  );
}

/** Any document whose current or restorable HTML may reference Notes media. */
export interface ImageReferencingDocument {
  readonly url: string;
  readonly body: string;
  readonly revisions: readonly { readonly body: string }[];
}

/**
 * Deterministic planning over complete Notes and Docs documents, including restorable
 * revisions. Docs are scanned because "Open in Docs" has created Docs whose HTML still
 * references notes/media images.
 */
export function planUnusedNoteImages(
  podRoot: string,
  files: readonly string[],
  notes: readonly (ImageReferencingDocument | undefined)[],
): string[] {
  // noteImages() returns [] without a DOM. That fallback is unsafe for deletion.
  if (typeof window === "undefined") throw new Error("Image cleanup needs a browser");
  const referenced = new Set<string>();
  for (const note of notes) {
    if (!note) throw new Error("A note could not be read. Image cleanup stopped.");
    for (const body of [note.body, ...note.revisions.map((revision) => revision.body)]) {
      const html = new window.DOMParser().parseFromString(body, "text/html");
      for (const image of html.querySelectorAll("img[src]")) {
        // Protect relative, entity-escaped and percent-encoded references too,
        // even when the current editor would refuse to render that spelling.
        const url = new URL(image.getAttribute("src") as string, note.url);
        url.search = "";
        url.hash = "";
        referenced.add(decodeURIComponent(url.href));
      }
    }
  }
  return [...new Set(files)].filter(
    (url) => mediaFile(url, podRoot) && !referenced.has(decodeURIComponent(url)),
  );
}

/** Notes-specific collection policy; transport and listing safety stay in the SDK. */
export class NoteImageCleanup {
  private readonly podRoot: string;
  private readonly http: typeof fetch;

  constructor(
    private readonly options: {
      podRoot: string;
      fetch: typeof fetch;
      readNote: (url: string) => Promise<Note | undefined>;
    },
  ) {
    this.podRoot = normalizePodBase(options.podRoot);
    const fetchImpl = refuseRedirects(options.fetch);
    this.http = (input, init) => fetchImpl(input, { ...init, cache: "no-store" });
  }

  private async files(container: string): Promise<string[]> {
    try {
      const { dataset } = await readRdf(container, this.http);
      // An invalid or different container is not evidence that no notes exist.
      const listing = new ContainerDataset(dataset, DataFactory).container;
      if (listing && listing.id !== container)
        throw new Error("The Notes folder could not be checked");
      // ContainerDataset selects ldp:contains subjects, so empty containers need
      // their explicit type checked through the same typed accessor package.
      const types = new Container(container, dataset, DataFactory).type;
      if (!listing && !types.has(`${NS.LDP}Container`) && !types.has(`${NS.LDP}BasicContainer`))
        throw new Error("The Notes folder could not be checked");
      return parseContainerMembers(dataset, container, { scope: this.podRoot })
        .filter((member) => !member.container && isDirectChild(member.url, container))
        .map((member) => member.url)
        .filter((url) => !/\.(acl|acr)$/i.test(decodeURIComponent(url)));
    } catch (error) {
      if (error instanceof RdfFetchError && (error.status === 404 || error.status === 410))
        return [];
      throw error;
    }
  }

  private async notes(isOnline: () => boolean = () => true): Promise<ImageReferencingDocument[]> {
    const notes: ImageReferencingDocument[] = [];
    // Docs converted from notes may still point at notes/media, so they are read too.
    const folders = [
      ...["notes/", "notes/archive/", "notes/.trash/"].map((path) => ({ path, doc: false })),
      ...[DOCS_SLUG, LEGACY_DOCS_SLUG].map((path) => ({ path, doc: true })),
    ];
    for (const { path, doc } of folders) {
      if (!isOnline()) throw new Error("You're offline. Image cleanup stopped.");
      for (const url of await this.files(new URL(path, this.podRoot).href)) {
        if (!isOnline()) throw new Error("You're offline. Image cleanup stopped.");
        // Unlike the normal UI lists, never swallow a failed/malformed read.
        if (doc) {
          const document = parseDocument(url, (await readRdf(url, this.http)).dataset);
          // RDF that is not a document has no HTML body to reference an image from.
          if (document) notes.push({ url, body: document.body, revisions: document.revisions });
          continue;
        }
        const note = await this.options.readNote(url);
        if (!note) throw new Error("A note could not be read. Image cleanup stopped.");
        notes.push(note);
      }
    }
    return notes;
  }

  async scan(): Promise<NoteImageCleanupPlan> {
    const files = await this.files(notesMediaContainer(this.podRoot));
    const unused = planUnusedNoteImages(this.podRoot, files, await this.notes());
    const images: UnusedNoteImage[] = [];
    for (const url of unused) {
      const head = await this.http(url, { method: "HEAD" });
      if (!head.ok) throw new Error("An image could not be checked. Try scanning again.");
      const length = head.headers.get("content-length");
      const bytes = Number(length);
      if (length === null || !/^\d+$/.test(length) || !Number.isSafeInteger(bytes))
        throw new Error("An image's size could not be checked");
      images.push({ url, bytes, etag: head.headers.get("etag") });
    }
    return { images, totalBytes: images.reduce((total, image) => total + image.bytes, 0) };
  }

  async delete(
    plan: NoteImageCleanupPlan,
    isOnline: () => boolean = () => navigator.onLine,
  ): Promise<NoteImageCleanupResult> {
    // Check the whole supplied plan before any I/O, including forged/stale UI state.
    if (plan.images.some((image) => !mediaFile(image.url, this.podRoot)))
      throw new Error("Image cleanup can only delete files inside Notes media");
    const result = { deleted: 0, kept: 0, failed: 0 };
    if (!plan.images.length) return result;
    if (!isOnline()) return { ...result, stopped: "offline" };
    let unused: Set<string>;
    try {
      // One complete, fail-closed rescan immediately before the deletion batch.
      unused = new Set(
        planUnusedNoteImages(
          this.podRoot,
          plan.images.map((image) => image.url),
          await this.notes(isOnline),
        ),
      );
    } catch (error) {
      if (!isOnline()) return { ...result, stopped: "offline" };
      throw error; // No delete has started, so a failed rescan cannot lose partial counts.
    }
    for (const image of plan.images) {
      if (!isOnline()) return { ...result, stopped: "offline" };
      if (!unused.has(image.url)) {
        result.kept++;
        continue;
      }
      // Residual race: Solid cannot atomically test all note documents and DELETE
      // different resources. A writer can add/move a reference during the rescan
      // or at any point in the batch after it; avoiding that requires server-side
      // transactions. Later deletes have a longer window since the single rescan.
      // If-Match additionally protects replacements/changes to the scanned image.
      // ACLs are never deleted independently: servers may remove the auxiliary ACL;
      // otherwise it governs only this now-missing UUID URL. Uploads use fresh UUIDs
      // and create-only writes, so leftover grants do not apply to future uploads.
      try {
        await deleteRdf(image.url, this.http, image.etag);
        result.deleted++;
      } catch (error) {
        if (error instanceof ResourceDeleteError && error.status === 412) {
          result.kept++;
          continue;
        }
        result.failed++;
        return { ...result, stopped: isOnline() ? "failed" : "offline" };
      }
    }
    return result;
  }
}
