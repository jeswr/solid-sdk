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
import { asStore } from "../core/dataset.js";
import { postJson } from "../core/fixture-fetch.js";
import { mergeItems } from "../core/incremental.js";
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
    let dataset = ctx.cursor ? asStore(await ctx.read("documents/files.ttl")) : new Store();
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
          removePath(dataset, path);
          continue;
        }
        if (entry[".tag"] !== "file") continue;
        const id = optionalText(entry.id);
        if (!id) {
          skipped.skip();
          continue;
        }
        const incoming = new Store();
        const file = new DigitalDocument(
          `${doc}#file-${fragmentSafe(id)}`,
          incoming,
          DataFactory,
        ).mark();
        file.name = optionalText(entry.name);
        file.identifier = id;
        file.description = optionalText(entry.path_display) ?? path;
        const size = optionalNumber(entry.size);
        file.contentSize = size !== undefined ? humanSize(size) : undefined;
        file.dateModified = optionalDate(entry.server_modified);
        // Reconcile path reuse (another id at the same path) and replace all old fields.
        if (path) removePath(dataset, path, false);
        dataset = mergeItems(dataset, incoming);
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

/** Dropbox deletion tombstones identify paths, including whole deleted folders. */
function removePath(dataset: Store, path: string, descendants = true): void {
  const target = path.toLowerCase();
  const subjects = new Set([...dataset].map((q) => q.subject.value));
  for (const subject of subjects) {
    const file = new DigitalDocument(subject, dataset, DataFactory);
    const current = file.description?.toLowerCase();
    if (current === target || (descendants && current?.startsWith(`${target}/`))) {
      for (const quad of [...dataset.match(DataFactory.namedNode(subject), null, null)])
        dataset.delete(quad);
    }
  }
}
