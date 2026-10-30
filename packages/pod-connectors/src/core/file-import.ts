// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
/**
 * The Tier-C **file-import** runner — the second place integration data enters
 * the pod, beside the OAuth `import-runner`. It deliberately reuses the same
 * write stack (no parallel fork):
 *
 *   adapter.importFile(file, ctx) → ctx.write(doc) → pod-data.writeResource
 *   …then ensureTypeRegistrations so the data appears under "My data".
 *
 * Where the OAuth path pulls JSON from a platform API, a Tier-C adapter parses
 * a file the user uploaded from the platform's official data export (Netflix
 * viewing CSV, ChatGPT conversations.json, …). Everything after parsing —
 * deterministic slugs under `<podRoot>integrations/<id>/`, idempotent
 * overwrite, type-index registration, the WrittenDoc/category report — is
 * identical to the OAuth runner.
 *
 * Security: the uploaded file is fully untrusted. We only decode UTF-8 input
 * (the parser never `eval`s, never builds a URL to fetch with the user's auth);
 * parsed values become inert RDF literals. We cap the file size and the number
 * of rows so a hostile or accidental multi-GB export can't exhaust memory or
 * write an unbounded pod document. Writes are confined to the adapter's own
 * container under the user's pod root (the slug-escape guard below).
 */
import { IntegrationSyncError } from "./errors.js";
import type { ImportReport } from "./import-runner.js";
import { createImportSession } from "./import-session.js";
import type {
  BinaryDoc,
  ConnectorStateOptions,
  ImportContext,
  ImportOutcome,
  ImportProgress,
  IntegrationMetadata,
  NormalisedDoc,
  PodWriter,
  VocabMap,
  WriteConditions,
  WrittenBinary,
  WrittenDoc,
} from "./types.js";

/**
 * Hard caps for untrusted uploads, including large Apple Health exports.
 * Streaming bounds input buffering; the row cap bounds RDF snapshot size.
 */
export const MAX_FILE_BYTES = 64 * 1024 * 1024; // 64 MiB
export const MAX_ROWS = 100_000;

/** A subset of the browser `File` API the parsers actually need (test-friendly). */
export interface ImportFile {
  readonly name: string;
  readonly size: number;
  /** The file type hint from the browser (may be empty / unreliable). */
  readonly type: string;
  /** Decode the file as UTF-8 text. */
  text(): Promise<string>;
  /** Streaming file bytes (native browser File/Blob API). Preferred when supplied. */
  stream?(): ReadableStream<Uint8Array>;
  /** Reopenable byte range [start, end), required for ZIP archives (native File/Blob). */
  slice?(start: number, end: number): { stream(): ReadableStream<Uint8Array> };
}

/** What a file-import adapter hands the runner to write (mirrors the OAuth ctx). */
export interface FileImportContext {
  /** Importing user's WebID, supplied by the host's PodWriter. */
  readonly webId?: string;
  /** Resolve a slug to the absolute pod URL it will be written at (for fragment IRIs). */
  resolve(slug: string): string;
  /** Read existing RDF, retaining write preconditions (as on ImportContext). */
  read: ImportContext["read"];
  /** Serialise + PUT a normalised document into the pod. */
  write(doc: NormalisedDoc, conditions?: WriteConditions): Promise<WrittenDoc>;
  /** Store a non-RDF resource (see `ImportContext.writeBinary`). */
  writeBinary(doc: BinaryDoc): Promise<WrittenBinary>;
  /** Delete a resource (see `ImportContext.remove`). */
  remove(slug: string): Promise<void>;
  /** Report progress to the UI. */
  progress(p: ImportProgress): void;
  /** Count a malformed or oversized source record omitted by the adapter. */
  skip(): void;
  /** Shared row cap so adapters bound their own loops consistently. */
  readonly maxRows: number;
}

/**
 * A Tier-C adapter: catalog metadata, the file types it accepts, and a parser
 * that turns one uploaded export file into pod documents via `ctx.write`.
 */
export interface FileImportAdapter {
  readonly vocabMap?: VocabMap;
  readonly metadata: IntegrationMetadata;
  /**
   * The `accept` attribute for the file input (e.g. `".csv,text/csv"`). Honest
   * about the files the adapter actually reads, including supported archives.
   */
  readonly accept: string;
  /** Adapter enforces streaming byte caps itself; bypass the whole-upload cap. */
  readonly streaming?: boolean;
  /**
   * Human guidance shown above the picker — exactly which file to select,
   * including any "unzip first and choose X" step for archive exports.
   */
  readonly fileHint: string;
  /**
   * The platform's own "download your data" page, rendered as a prominent
   * external link on the connect screen. **Absent** when there is no single
   * web URL to send the user to (in-app exports like WhatsApp/Apple Health,
   * or bank-specific statement downloads) — the UI must handle absence.
   * The `fileHint` still carries the which-file guidance either way.
   */
  readonly exportUrl?: string;
  /** Parse the uploaded file and write normalised documents. */
  importFile(file: ImportFile, ctx: FileImportContext): Promise<void | FileImportOutcome>;
}

export interface FileImportOutcome extends Pick<ImportOutcome, "skipped"> {
  readonly unsupported?: readonly string[];
}

export interface RunFileImportOptions extends ConnectorStateOptions {
  adapter: FileImportAdapter;
  file: ImportFile;
  podWriter: PodWriter;
  onProgress?: (p: ImportProgress) => void;
}

/**
 * Run one file import end-to-end: validate the upload, let the adapter parse +
 * write, then ensure type-index registrations. Returns the same
 * {@link ImportReport} shape the OAuth runner does, so the UI is shared.
 */
export async function runFileImport(opts: RunFileImportOptions): Promise<ImportReport> {
  const { adapter, file } = opts;
  const id = adapter.metadata.id;

  if (!adapter.streaming && file.size > MAX_FILE_BYTES) {
    throw new IntegrationSyncError(
      id,
      `That file is ${formatBytes(file.size)} — larger than the ${formatBytes(MAX_FILE_BYTES)} import limit. Please split the export.`,
    );
  }

  const session = createImportSession(
    opts.podWriter,
    id,
    `urn:solid:connector:${encodeURIComponent(id)}:export`,
    opts,
    adapter.vocabMap,
  );
  let skipped = 0;
  try {
    let removed = false;
    const outcome = await adapter.importFile(file, {
      webId: opts.podWriter.webId,
      maxRows: MAX_ROWS,
      resolve: (slug) => opts.podWriter.resolve(slug),
      progress: (p) => opts.onProgress?.(p),
      read: session.read,
      skip: () => skipped++,
      write: session.write,
      writeBinary: session.writeBinary,
      remove: async (slug) => {
        await session.remove(slug);
        removed = true;
      },
    });
    skipped += outcome?.skipped ?? 0;
    if (
      session.written.length === 0 &&
      !removed &&
      !outcome?.skipped &&
      !outcome?.unsupported?.length
    ) {
      throw new IntegrationSyncError(
        id,
        "No importable records were found in that file. Double-check you selected the right export file.",
      );
    }
    const { indexUrl } = await opts.podWriter.registerType(session.registrations());
    await session.finish();
    const state = session.state({ skipped });
    opts.onState?.(state);
    return {
      adapterId: id,
      mode: "live",
      written: session.written,
      categories: [...new Set(session.written.map((w) => w.category))],
      indexUrl,
      skipped: skipped || undefined,
      state,
      unsupported: outcome?.unsupported,
    };
  } catch (error) {
    // Partial writes already link to this run. Record it when storage is available,
    // preserving the original failure if the provenance write also fails.
    try {
      await session.finish();
    } catch {
      /* Original failure takes priority. */
    }
    opts.onState?.(session.state());
    throw error;
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}
