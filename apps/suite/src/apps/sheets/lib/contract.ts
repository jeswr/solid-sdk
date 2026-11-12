// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY Codex GPT-6.1-Sol
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

import type { WorkbookMetadata } from "@jeswr/solid-sheets";
import type { DraftAnchor } from "./comments/anchors";
import type { CellAnchor } from "./comments/selector";
import type { Snapshot } from "./model/snapshot";
import type { StructuralEdit } from "./refs/model";

export type { Snapshot, WorkbookMetadata };

/** The exact snapshot accepted by the authoritative workbook write and its ETag. */
export type SnapshotSaved = (snapshot: Snapshot, revision: string) => void;

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
  /** Best-effort ETags of derived CSVs/descriptors, keyed by URL; never used to guard writes. */
  readonly derived: Readonly<Record<string, string>>;
  /** Successful authoritative writes whose validators still need content verification. */
  readonly pendingVerification?: {
    readonly snapshot?: Snapshot;
    readonly index?: WorkbookMetadata;
  };
}

export interface OpenedWorkbook {
  /** Confirmed lack of write access; missing permission hints remain unknown. */
  readonly readOnly?: boolean;
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

/** An authoritative write succeeded; retry using this version, including unverified validators. */
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
  constructor(
    readonly container: string,
    readonly reason: "missing" | "forbidden" = "missing",
  ) {
    super("This spreadsheet doesn't exist or can't be opened");
    this.name = "WorkbookNotFoundError";
  }
}

/** Unsafe shared link or a shared resource that cannot be opened anonymously. */
export class WorkbookLinkError extends Error {
  constructor(
    message = "Shared spreadsheets must use a container URL on the same origin as your pod.",
  ) {
    super(message);
    this.name = "WorkbookLinkError";
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
  /** Imports a browser-read Excel workbook, preserving supported formats and formulas. */
  createFromXlsx(input: { title: string; data: Uint8Array }): Promise<OpenedWorkbook>;
  open(container: string): Promise<OpenedWorkbook>;
  /** Public same-origin shared links only; anonymous and view-only, with no redirects. */
  openShared(container: string): Promise<OpenedWorkbook>;
  /**
   * Writes `workbook.json` with If-Match `base.snapshotEtag` (a freshly read ETag
   * when `force`); that guarded snapshot write owns the revision. Derived CSVs and
   * descriptors are then PUT unconditionally, repairing missing projections. Finally
   * publishes `index.ttl` (modified date, `title` only for a local rename, sheet list),
   * retrying index-only changes with the latest stored title up to three times
   * while the snapshot revision is still ours. Unknown validators from earlier
   * successful PUTs are verified against their written content before any write.
   * Checks the index version before writing. Stale cleanup requires this publication
   * to still be current and deletes with each resource's freshly read ETag.
   * A WorkbookPartialSaveError carries the retry version after a partial write.
   * Throws WorkbookConflictError for a stale baseline or a rejected snapshot write.
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
  /** Pristine, credential-free transport for public shared workbooks. Defaults to global fetch. */
  readonly publicFetch?: typeof globalThis.fetch;
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

export type CsvImportResult =
  | { status: "imported" }
  | { status: "blocked"; reason: "comments-loading" | "read-only" };

export type SortResult = { status: "sorted" } | { status: "blocked"; reason: string };

export interface SheetEngine {
  sortRange?(options: {
    scope: "range" | "sheet";
    column: number;
    ascending: boolean;
    header: boolean;
  }): SortResult;
  hasFilter?(): boolean;
  toggleFilter?(): Promise<boolean>;
  clearFilter?(): Promise<boolean>;
  findReplace?(): Promise<void>;
  /** Hold editing independently of access permissions while missing anchors load. */
  setCommentsLoading?(loading: boolean): void;
  /** Listed selectors replay only history after their recorded workbook ETag. */
  registerCommentAnchors?(
    anchors: Record<string, CellAnchor>,
    position?: "snapshot" | "current",
    revisions?: Record<string, string | undefined>,
  ): void;
  /** Last saved workbook ETag, recorded on new comment annotations. */
  commentRevision?(): string | undefined;
  /** Acknowledge the exact saved snapshot, even if editing continued during its write. */
  setWorkbookRevision?(revision: string, snapshot: Snapshot): void;
  trackCommentDraft?(anchor: CellAnchor): DraftAnchor;
  selectedCell?(): CellAnchor | undefined;
  selectCell?(anchor: CellAnchor): void;
  onSelection?(listener: (anchor: CellAnchor | undefined) => void): () => void;
  onStructure?(listener: (edit: StructuralEdit) => void): () => void;

  /** App-owned chart metadata is retained beside the engine snapshot. */
  setCharts?(charts: import("./model/snapshot").JsonValue): void;
  /** Current rectangular selection, local to the active sheet. */
  selection?(): { sheetId: string; range: string };
  /** Includes background formula results, without scheduling another save. */
  onValuesChange?(listener: () => void): () => void;
  /** Replace the whole workbook (e.g. "reload theirs" after a conflict). Does not fire `onChange`. */
  load(snapshot: Snapshot, workbookRevision?: string): void;
  /** The current workbook as a JSON-safe snapshot (passes `serializeSnapshot`). */
  snapshot(): Snapshot;
  /** Fires after every user mutation (cell edit, format, sheet add/rename/move/delete…). */
  onChange(listener: () => void): () => void;
  /** CSV of one sheet (default: the active sheet), cached formula results as values. */
  exportCsv(sheetId?: string): string;
  activeSheet(): ActiveSheet;
  /** Adds text cells or explicitly reports a loading/access lock so the caller can retry. */
  importCsv(
    csv: string,
    options: { mode: "new-sheet" | "replace-active"; name?: string },
  ): CsvImportResult;
  setDark(dark: boolean): void;
  setReadOnly(readOnly: boolean): void;
  dispose(): void;
}

export interface MountEngineOptions {
  readonly workbookRevision?: string;
  readonly commentsLoading?: boolean;
  readonly readOnly?: boolean;
  readonly snapshot: Snapshot;
  readonly dark: boolean;
  /** Narrow viewport (< 640 px): no ribbon toolbar; formula bar, grid and sheet tabs only. */
  readonly compact: boolean;
}

export type MountEngine = (
  container: HTMLElement,
  options: MountEngineOptions,
) => Promise<SheetEngine>;
