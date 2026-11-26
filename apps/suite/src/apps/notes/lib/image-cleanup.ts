// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { RdfFetchError } from "@jeswr/fetch-rdf";
import { normalizePodBase, refuseRedirects } from "@jeswr/guarded-fetch";
import { parseContainerMembers } from "@jeswr/ldp-container";
import { Container, ContainerDataset } from "@solid/object";
import { DataFactory } from "n3";
import { parseDocument } from "../../docs/lib/model/document";
import { ResourceDeleteError } from "../../docs/lib/model/errors";
import {
  DOCS_SLUG,
  docContainerUrls,
  isDirectChild,
  LEGACY_DOCS_SLUG,
} from "../../docs/lib/model/layout";
import { deleteRdf, readRdf } from "../../docs/lib/model/rdf-io";
import { NS } from "../../docs/lib/model/vocab";
import { ByteLimitError, noteImageSource, notesMediaContainer, readCappedBlob } from "./images";
import type { Note } from "./model/note";

export interface UnusedNoteImage {
  readonly url: string;
  readonly bytes: number;
  readonly etag: string | null;
}
export interface NoteImageCleanupPlan {
  readonly images: readonly UnusedNoteImage[];
  readonly totalBytes: number;
  /** Unreferenced images kept only because they are too new (or their age is unknown). */
  readonly recent?: number;
}

/** Images changed within this window are never candidates: their note may not be saved yet. */
export const IMAGE_GRACE_MS = 24 * 60 * 60 * 1000;
const HISTORY_FILE_BYTES = 8 * 1024 * 1024;
const HISTORY_TOTAL_BYTES = 64 * 1024 * 1024;
const HISTORY_FILES = 2000;

/** A safe stop with a cause the user can act on. Messages never carry content or credentials. */
export class ImageCleanupBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImageCleanupBlockedError";
  }
}

/** Raw text of every durable unsaved draft (all tabs) and capture draft; fails closed. */
export function storedDraftTexts(): string[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const texts: string[] = [];
    for (const key of Object.keys(localStorage)) {
      if (!key.startsWith("suite.notes.pending-drafts.") && !key.startsWith("notes-capture-draft"))
        continue;
      const value = localStorage.getItem(key);
      if (value === null) continue;
      texts.push(value);
    }
    return texts;
  } catch {
    throw new ImageCleanupBlockedError(
      "Unsaved drafts couldn't be checked, so no images were offered for deletion.",
    );
  }
}

/** The image's file name, in raw and decoded spelling, for conservative text matching. */
function imageNames(url: string): string[] {
  const raw = new URL(url).pathname.split("/").pop() as string;
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    // Keep the raw spelling only.
  }
  return [...new Set([raw, decoded])].filter(Boolean);
}
const mentioned = (texts: readonly string[], url: string) => {
  const names = imageNames(url);
  return texts.some((text) => names.some((name) => text.includes(name)));
};
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
 * revisions. Docs are scanned because older conversions may still reference notes/media.
 * `texts` is raw text (unsaved drafts, Docs history, trash) that protects any image whose
 * file name it mentions, and an unparseable img src protects by name rather than blocking.
 */
export function planUnusedNoteImages(
  podRoot: string,
  files: readonly string[],
  notes: readonly (ImageReferencingDocument | undefined)[],
  texts: readonly string[] = [],
): string[] {
  // noteImages() returns [] without a DOM. That fallback is unsafe for deletion.
  if (typeof window === "undefined") throw new Error("Image cleanup needs a browser");
  const referenced = new Set<string>();
  const loose: string[] = [...texts];
  for (const note of notes) {
    if (!note) throw new Error("A note could not be read. Image cleanup stopped.");
    for (const body of [note.body, ...note.revisions.map((revision) => revision.body)]) {
      const html = new window.DOMParser().parseFromString(body, "text/html");
      for (const image of html.querySelectorAll("img[src]")) {
        const src = image.getAttribute("src") as string;
        try {
          // Protect relative, entity-escaped and percent-encoded references too,
          // even when the current editor would refuse to render that spelling.
          const url = new URL(src, note.url);
          url.search = "";
          url.hash = "";
          referenced.add(decodeURIComponent(url.href));
        } catch {
          // A malformed src cannot name a resource, but it may still spell a file name.
          loose.push(src);
        }
      }
    }
  }
  return [...new Set(files)].filter(
    (url) =>
      mediaFile(url, podRoot) && !referenced.has(decodeURIComponent(url)) && !mentioned(loose, url),
  );
}

const relative = (url: string, podRoot: string) =>
  url.startsWith(podRoot) ? url.slice(podRoot.length) : "a file";

/** Notes-specific collection policy; transport and listing safety stay in the SDK. */
export class NoteImageCleanup {
  private readonly podRoot: string;
  private readonly http: typeof fetch;
  private readonly draftTexts: () => readonly string[];
  private readonly now: () => number;

  constructor(
    private readonly options: {
      podRoot: string;
      fetch: typeof fetch;
      readNote: (url: string) => Promise<Note | undefined>;
      /** Raw text of durable unsaved drafts. Defaults to every tab's localStorage drafts. */
      draftTexts?: () => readonly string[];
      now?: () => number;
    },
  ) {
    this.podRoot = normalizePodBase(options.podRoot);
    const fetchImpl = refuseRedirects(options.fetch);
    this.http = (input, init) => fetchImpl(input, { ...init, cache: "no-store" });
    this.draftTexts = options.draftTexts ?? storedDraftTexts;
    this.now = options.now ?? (() => Date.now());
  }

  private async list(container: string, required = false) {
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
        .filter((member) =>
          isDirectChild(member.container ? member.url.replace(/\/$/, "") : member.url, container),
        )
        .filter((member) => !/\.(acl|acr)$/i.test(decodeURIComponent(member.url)));
    } catch (error) {
      if (error instanceof RdfFetchError && (error.status === 404 || error.status === 410)) {
        // A missing notes/ folder next to existing media is a fault, not "no notes".
        if (required)
          throw new ImageCleanupBlockedError(
            "The Notes folder couldn't be found even though images exist, so nothing was checked.",
          );
        return [];
      }
      throw error;
    }
  }

  private async files(container: string, required = false): Promise<string[]> {
    return (await this.list(container, required)).filter((m) => !m.container).map((m) => m.url);
  }

  private async notes(
    mediaCount: number,
    isOnline: () => boolean = () => true,
  ): Promise<{ docs: ImageReferencingDocument[]; documentUrls: string[] }> {
    const notes: ImageReferencingDocument[] = [];
    const documentUrls: string[] = [];
    // Older Docs converted from notes may still point at notes/media, so they are read too.
    const folders = [
      ...["notes/", "notes/archive/", "notes/.trash/"].map((path) => ({ path, doc: false })),
      ...[DOCS_SLUG, LEGACY_DOCS_SLUG].map((path) => ({ path, doc: true })),
    ];
    for (const { path, doc } of folders) {
      if (!isOnline()) throw new Error("You're offline. Image cleanup stopped.");
      const container = new URL(path, this.podRoot).href;
      for (const url of await this.files(container, path === "notes/" && mediaCount > 0)) {
        if (!isOnline()) throw new Error("You're offline. Image cleanup stopped.");
        // Unlike the normal UI lists, never swallow a failed/malformed read.
        if (doc) {
          const document = parseDocument(url, (await readRdf(url, this.http)).dataset);
          // RDF that is not a document has no HTML body to reference an image from.
          if (document) {
            notes.push({ url, body: document.body, revisions: document.revisions });
            documentUrls.push(url);
          }
          continue;
        }
        const note = await this.options.readNote(url);
        if (!note)
          throw new ImageCleanupBlockedError(
            `A note could not be read. Image cleanup stopped. Check or remove ${relative(url, this.podRoot)}, then scan again.`,
          );
        notes.push(note);
      }
    }
    return { docs: notes, documentUrls };
  }

  /**
   * Docs version snapshots, update logs and Drive's trash are not decoded; any image whose file
   * name appears in their bytes is kept. Anything unreadable or too large aborts the scan.
   */
  private async historyTexts(documentUrls: readonly string[]): Promise<string[]> {
    const queue = [
      ...documentUrls.flatMap((url) => {
        const layout = docContainerUrls(url);
        return [layout.versions, layout.updateLog];
      }),
      `${this.podRoot}.trash/`,
    ];
    const seen = new Set<string>();
    const texts: string[] = [];
    let total = 0;
    let count = 0;
    const tooMuch = () =>
      new ImageCleanupBlockedError(
        "There is too much Docs history or Drive trash to check safely, so no images were offered for deletion.",
      );
    while (queue.length) {
      const container = queue.shift() as string;
      if (seen.has(container)) continue;
      seen.add(container);
      let members: Awaited<ReturnType<NoteImageCleanup["list"]>>;
      try {
        members = await this.list(container);
      } catch {
        throw new ImageCleanupBlockedError(
          `${relative(container, this.podRoot)} couldn't be checked for images, so no images were offered for deletion.`,
        );
      }
      for (const member of members) {
        if (member.container) {
          queue.push(member.url);
          continue;
        }
        if (++count > HISTORY_FILES) throw tooMuch();
        try {
          const response = await this.http(member.url);
          if (!response.ok) throw new Error("unreadable");
          const blob = await readCappedBlob(response, HISTORY_FILE_BYTES);
          total += blob.size;
          if (total > HISTORY_TOTAL_BYTES) throw tooMuch();
          texts.push(await blob.text());
        } catch (error) {
          if (error instanceof ImageCleanupBlockedError) throw error;
          if (error instanceof ByteLimitError) throw tooMuch();
          throw new ImageCleanupBlockedError(
            `${relative(member.url, this.podRoot)} couldn't be read, so no images were offered for deletion.`,
          );
        }
      }
    }
    return texts;
  }

  private async unused(
    files: readonly string[],
    inUse: () => readonly string[],
    isOnline?: () => boolean,
  ): Promise<string[]> {
    const { docs, documentUrls } = await this.notes(files.length, isOnline);
    const history = files.length ? await this.historyTexts(documentUrls) : [];
    return planUnusedNoteImages(this.podRoot, files, docs, [
      ...this.draftTexts(),
      ...inUse(),
      ...history,
    ]);
  }

  /** Age in ms from Last-Modified; undefined when absent or unusable (treated as too young). */
  private age(head: Response): number | undefined {
    const modified = Date.parse(head.headers.get("last-modified") ?? "");
    return Number.isFinite(modified) ? this.now() - modified : undefined;
  }

  async scan(inUse: () => readonly string[] = () => []): Promise<NoteImageCleanupPlan> {
    const files = await this.files(notesMediaContainer(this.podRoot));
    const unused = await this.unused(files, inUse);
    const images: UnusedNoteImage[] = [];
    let recent = 0;
    for (const url of unused) {
      const head = await this.http(url, { method: "HEAD" });
      if (!head.ok) throw new Error("An image could not be checked. Try scanning again.");
      const age = this.age(head);
      // Fail closed: just-uploaded images may belong to a note that is not saved yet.
      if (age === undefined || age < IMAGE_GRACE_MS) {
        recent++;
        continue;
      }
      const length = head.headers.get("content-length");
      const bytes = Number(length);
      if (length === null || !/^\d+$/.test(length) || !Number.isSafeInteger(bytes))
        throw new Error("An image's size could not be checked");
      images.push({ url, bytes, etag: head.headers.get("etag") });
    }
    return {
      images,
      totalBytes: images.reduce((total, image) => total + image.bytes, 0),
      recent,
    };
  }

  async delete(
    plan: NoteImageCleanupPlan,
    isOnline: () => boolean = () => navigator.onLine,
    inUse: () => readonly string[] = () => [],
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
        await this.unused(
          plan.images.map((image) => image.url),
          inUse,
          isOnline,
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
        // Immediately before each delete: unsaved drafts (any tab) and the image's age.
        if (mentioned([...this.draftTexts(), ...inUse()], image.url)) {
          result.kept++;
          continue;
        }
        const head = await this.http(image.url, { method: "HEAD" });
        const age = head.ok ? this.age(head) : undefined;
        if (age === undefined || age < IMAGE_GRACE_MS) {
          result.kept++;
          continue;
        }
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
