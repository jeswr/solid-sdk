// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY Codex GPT-6
/**
 * The Sheets app's two seams (SHT-01), shared by the data layer and the editor UI:
 *
 * - `WorkbookService`: all pod I/O for spreadsheets under `<storage>/sheets/`.
 *   One workbook is a container `<storage>/sheets/<slug>/` holding `index.ttl`
 *   (metadata, `schema:SpreadsheetDigitalDocument` + `schema:Dataset`), the
 *   engine snapshot `workbook.json` (authoritative: formulas, formats, sheet
 *   order) and, per sheet, a derived canonical `sheets/<n>.csv` plus a
 *   `sheets/<n>.jsonld` column descriptor (`n` is the 1-based sheet position,
 *   see `model/rdf.ts` `workbookLayout`). CSVs and descriptors are rewritten
 *   from the snapshot on every save; they are never read back into the engine.
 * - `SheetEngine`: the spreadsheet engine mounted in the browser. Univer is the
 *   only implementation (decided 2026-10-25); it is loaded through a dynamic
 *   import so the engine is a lazy chunk that only the editor route pulls in.
 *
 * Both are interfaces so the UI can be exercised against fakes in unit tests.
 */

import type { WorkbookMetadata } from "./model/rdf";
import type { Snapshot } from "./model/snapshot";

export type { Snapshot, WorkbookMetadata };

/** One row in the Sheets list. */
export interface WorkbookSummary {
  /** The workbook container URL (ends in `/`). Route refs encode this URL. */
  readonly container: string;
  readonly title: string;
  readonly modified: Date;
  readonly created: Date;
  readonly creator: string;
  readonly sheetCount: number;
}

/**
 * Opaque concurrency state returned by `open`/`save`/`rename`. The UI must pass
 * back the latest value it received and never inspect it.
 */
export interface WorkbookVersion {
  readonly snapshotEtag: string;
  readonly indexEtag: string;
  /** ETags of the derived per-sheet CSV/descriptor resources, keyed by URL. */
  readonly derived: Readonly<Record<string, string>>;
}

export interface OpenedWorkbook {
  readonly container: string;
  readonly metadata: WorkbookMetadata;
  readonly snapshot: Snapshot;
  readonly version: WorkbookVersion;
}

export interface SaveResult {
  readonly version: WorkbookVersion;
  readonly metadata: WorkbookMetadata;
}

/**
 * Someone else changed `workbook.json` (or `index.ttl`) since `base` was read.
 * The UI shows the conflict dialog: reload theirs, overwrite with mine
 * (`save(..., { force: true })`), or save mine as a copy.
 */
export class WorkbookConflictError extends Error {
  constructor(readonly container: string) {
    super("This spreadsheet was changed somewhere else");
    this.name = "WorkbookConflictError";
  }
}

/** The snapshot was saved; retry projections using this version, including partial ETags. */
export class WorkbookPartialSaveError extends Error {
  constructor(
    readonly version: WorkbookVersion,
    readonly cause: unknown,
  ) {
    super(`Couldn't finish saving this spreadsheet: ${String(cause)}`, { cause });
    this.name = "WorkbookPartialSaveError";
  }
}

/** The workbook container or its `index.ttl`/`workbook.json` is missing or unreadable. */
export class WorkbookNotFoundError extends Error {
  constructor(readonly container: string) {
    super("This spreadsheet doesn't exist or can't be opened");
    this.name = "WorkbookNotFoundError";
  }
}

export interface CreateWorkbookInput {
  readonly title: string;
  /** Engine snapshot; omitted means one empty sheet named "Sheet1". */
  readonly snapshot?: Snapshot;
}

export interface CreateFromCsvInput {
  readonly title: string;
  readonly csv: string;
  readonly sheetName?: string;
}

export interface WorkbookService {
  /** `<storage>/sheets/` */
  readonly root: string;
  /** Workbooks in `root` (direct child containers with a readable index), newest first. */
  list(): Promise<WorkbookSummary[]>;
  /** Create-only: allocates `<slug>/`, `<slug>-2/`, … and registers the class in the Type Index once. */
  create(input: CreateWorkbookInput): Promise<OpenedWorkbook>;
  /** Imports every CSV field as text into a one-sheet workbook (formulas are not executed). */
  createFromCsv(input: CreateFromCsvInput): Promise<OpenedWorkbook>;
  open(container: string): Promise<OpenedWorkbook>;
  /**
   * Writes `workbook.json` with If-Match `base.snapshotEtag` (a freshly read ETag
   * when `force`), then the derived CSVs/descriptors, then `index.ttl` (modified date,
   * `title` when given else the stored title, sheet list). Checks the index version
   * before writing; stale projections are removed only after publishing the index.
   * A WorkbookPartialSaveError carries the retry version after a partial write. Throws
   * `WorkbookConflictError` on a 412 from a conditional write.
   */
  save(
    container: string,
    snapshot: Snapshot,
    base: WorkbookVersion,
    options?: { force?: boolean; title?: string },
  ): Promise<SaveResult>;
  /** Updates only the title in `index.ttl` (If-Match). */
  rename(container: string, title: string, base: WorkbookVersion): Promise<SaveResult>;
  /** New workbook with the same snapshot, titled `title`. */
  copy(container: string, title: string): Promise<OpenedWorkbook>;
  /** Deletes the workbook container and everything in it. */
  remove(container: string): Promise<void>;
}

export interface WorkbookServiceOptions {
  readonly fetch: typeof globalThis.fetch;
  /** Storage root (ends in `/`). */
  readonly podRoot: string;
  readonly webId: string;
  /** Injectable clock for workbook creation and modification dates. */
  readonly now?: () => Date;
}

/** The sheet the user is looking at. */
export interface ActiveSheet {
  readonly id: string;
  readonly name: string;
}

export interface SheetEngine {
  /** Replace the whole workbook (e.g. "reload theirs" after a conflict). Does not fire `onChange`. */
  load(snapshot: Snapshot): void;
  /** The current workbook as a JSON-safe snapshot (passes `serializeSnapshot`). */
  snapshot(): Snapshot;
  /** Fires after every user mutation (cell edit, format, sheet add/rename/move/delete…). */
  onChange(listener: () => void): () => void;
  /** CSV of one sheet (default: the active sheet), cached formula results as values. */
  exportCsv(sheetId?: string): string;
  activeSheet(): ActiveSheet;
  /** Adds a sheet with the CSV as text cells, or replaces the active sheet's cells. */
  importCsv(csv: string, options: { mode: "new-sheet" | "replace-active"; name?: string }): void;
  setDark(dark: boolean): void;
  dispose(): void;
}

export interface MountEngineOptions {
  readonly snapshot: Snapshot;
  readonly dark: boolean;
  /** Narrow viewport (< 640 px): no ribbon toolbar; formula bar, grid and sheet tabs only. */
  readonly compact: boolean;
}

export type MountEngine = (
  container: HTMLElement,
  options: MountEngineOptions,
) => Promise<SheetEngine>;
