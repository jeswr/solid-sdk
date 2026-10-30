// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
/**
 * Dropbox → Documents. File **metadata** (name, path, size, modified — never
 * the file bytes) as `schema:DigitalDocument`.
 *
 * Incremental: `list_folder` returns a cursor; the next import calls
 * `list_folder/continue` with it and merges only the changes — Dropbox's own
 * delta mechanism. Dropbox supports secretless PKCE, so live mode needs only
 * a client id.
 */
import { DataFactory, Store } from "n3";
import { postJson } from "../core/fixture-fetch.js";
import { copyDataset } from "../core/incremental.js";
import { Pagination } from "../core/pagination.js";
import { arr, optionalDate, optionalNumber, optionalText, SkipCounter } from "../core/safe.js";
import type { ImportContext, ImportOutcome, IntegrationAdapter } from "../core/types.js";
import { CLASSES, DigitalDocument } from "../core/vocab.js";
import { DROPBOX_FIXTURES, type DropboxListFolderAnswer } from "./fixtures.js";
import { vocabMap } from "./vocab-map.js";

const ID = "dropbox";
const API = "https://api.dropboxapi.com/2";
const SCOPES = ["files.metadata.read", "account_info.read"] as const;

export const dropboxAdapter: IntegrationAdapter = {
  vocabMap,
  metadata: {
    id: ID,
    name: "Dropbox",
    tier: "A",
    authKind: "oauth-pkce",
    scopes: SCOPES,
    categories: ["documents"],
    whatYouGet:
      "An index of your files — names, folders, sizes and edit dates (never the file contents) — into Documents.",
    requirements: [
      "Create an app at dropbox.com/developers/apps (scoped access, files.metadata.read).",
      "Add <app-origin>/oauth-callback.html as a redirect URI.",
      "Set NEXT_PUBLIC_DROPBOX_CLIENT_ID — Dropbox supports secretless PKCE, no proxy needed.",
    ],
  },
  oauth: {
    clientId: undefined,
    authorizationEndpoint: "https://www.dropbox.com/oauth2/authorize",
    tokenEndpoint: "https://api.dropboxapi.com/oauth2/token",
    scopes: SCOPES,
    tokenExchange: "public",
    extraAuthParams: { token_access_type: "online" },
  },
  fixtures: () => DROPBOX_FIXTURES,

  async import(ctx: ImportContext): Promise<ImportOutcome> {
    const skipped = new SkipCounter();
    ctx.progress({ label: "Listing your files…", done: 0, total: 2 });
    const first: DropboxListFolderAnswer = ctx.cursor
      ? await postJson(ID, ctx.api, `${API}/files/list_folder/continue`, { cursor: ctx.cursor })
      : await postJson(ID, ctx.api, `${API}/files/list_folder`, {
          path: "",
          recursive: true,
          limit: 500,
        });

    const doc = ctx.resolve("documents/files.ttl");
    const dataset = ctx.cursor ? copyDataset(await ctx.read("documents/files.ttl")) : new Store();
    const files = new FileIndex(dataset);
    const pagination = new Pagination(ID);
    if (ctx.cursor) pagination.next(ctx.cursor);

    let answer = first;
    for (;;) {
      for (const entry of arr(answer?.entries)) {
        if (!entry) {
          skipped.skip();
          continue;
        }
        const path = optionalText(entry.path_lower) ?? optionalText(entry.path_display);
        if (entry[".tag"] === "deleted") {
          if (!path) {
            skipped.skip();
            continue;
          }
          files.removePath(path);
          continue;
        }
        if (entry[".tag"] === "folder") {
          if (path) files.removePath(path, false);
          continue;
        }
        if (entry[".tag"] !== "file") continue;
        const id = optionalText(entry.id);
        if (!id) {
          skipped.skip();
          continue;
        }
        // A file replaces the whole former folder subtree, as well as its old id/path.
        if (path) files.removePath(path);
        const subject = `${doc}#file-${fragmentSafe(id)}`;
        files.removeSubject(subject);
        const file = new DigitalDocument(subject, dataset, DataFactory).mark();
        file.name = optionalText(entry.name);
        file.identifier = id;
        file.description = optionalText(entry.path_display) ?? path;
        const size = optionalNumber(entry.size);
        file.contentSize = size !== undefined ? humanSize(size) : undefined;
        file.dateModified = optionalDate(entry.server_modified);
        files.addSubject(subject, path);
      }
      if (!answer.has_more) break;
      pagination.next(answer.cursor);
      answer = await postJson(ID, ctx.api, `${API}/files/list_folder/continue`, {
        cursor: answer.cursor,
      });
    }

    ctx.progress({ label: "Saving your file index…", done: 1, total: 2 });
    await ctx.write({
      slug: "documents/files.ttl",
      category: "documents",
      forClass: CLASSES.DigitalDocument,
      dataset,
      sourceUrl: `${API}/files/list_folder`,
    });

    ctx.progress({ label: "Done", done: 2, total: 2 });
    return { cursor: answer.cursor, skipped: skipped.value };
  },
};

/** Dropbox ids look like `id:a4ayc_80_…` — strip the colon for fragment use. */
function fragmentSafe(id: string): string {
  return id.replace(/[^A-Za-z0-9_-]/g, "");
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Index once, then update only affected subjects and path ancestors on one mutable store. */
class FileIndex {
  private readonly subjects = new Map<string, string | undefined>();
  private readonly paths = new Map<string, { exact: Set<string>; subtree: Set<string> }>();

  constructor(private readonly dataset: Store) {
    for (const subject of dataset.getSubjects(null, null, null)) {
      if (subject.termType !== "NamedNode") continue;
      const file = new DigitalDocument(subject.value, dataset, DataFactory);
      this.addSubject(subject.value, file.description);
    }
  }

  addSubject(subject: string, path?: string): void {
    const target = path?.toLowerCase();
    this.subjects.set(subject, target);
    if (!target) return;
    for (const ancestor of pathAncestors(target)) {
      let node = this.paths.get(ancestor);
      if (!node) {
        node = { exact: new Set(), subtree: new Set() };
        this.paths.set(ancestor, node);
      }
      node.subtree.add(subject);
      if (ancestor === target) node.exact.add(subject);
    }
  }

  removeSubject(subject: string): void {
    if (!this.subjects.has(subject)) return;
    const path = this.subjects.get(subject);
    if (path) {
      for (const ancestor of pathAncestors(path)) {
        const node = this.paths.get(ancestor);
        if (!node) continue;
        node.exact.delete(subject);
        node.subtree.delete(subject);
        if (node.subtree.size === 0) this.paths.delete(ancestor);
      }
    }
    this.subjects.delete(subject);
    this.dataset.removeQuads(
      this.dataset.getQuads(DataFactory.namedNode(subject), null, null, null),
    );
  }

  /** Folders keep their descendants; files and tombstones remove the entire subtree. */
  removePath(path: string, descendants = true): void {
    const node = this.paths.get(path.toLowerCase());
    if (!node) return;
    // Removing the current Set member is safe during iteration.
    for (const subject of descendants ? node.subtree : node.exact) this.removeSubject(subject);
  }
}

function* pathAncestors(path: string): Generator<string> {
  for (let end = path.length; end > 0; end = path.lastIndexOf("/", end - 1))
    yield path.slice(0, end);
}
