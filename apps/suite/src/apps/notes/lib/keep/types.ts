// AUTHORED-BY Codex GPT-6.1-Sol
import type { ChecklistItem } from "../capture";

export const MAX_KEEP_NOTE_BYTES = 1024 * 1024;
export const MAX_KEEP_LIST_ITEMS = 2_000;
export const MAX_KEEP_LABELS = 200;
export const MAX_KEEP_BATCH_FILES = 10_000;

export const KEEP_COLOURS = [
  "DEFAULT",
  "RED",
  "ORANGE",
  "YELLOW",
  "GREEN",
  "TEAL",
  "BLUE",
  "CERULEAN",
  "PURPLE",
  "PINK",
  "BROWN",
  "GRAY",
] as const;
export type KeepColour = (typeof KEEP_COLOURS)[number];

export type KeepImportErrorCode =
  | "INVALID_KEEP_NOTE"
  | "NOTE_TOO_LARGE"
  | "BATCH_TOO_LARGE"
  | "INVALID_TIMESTAMP"
  | "UNSAFE_ATTACHMENT_PATH";

/** Messages contain codes only, never private note content or parser diagnostics. */
export class KeepImportError extends Error {
  override readonly name = "KeepImportError";
  constructor(readonly code: KeepImportErrorCode) {
    super(`Keep import: ${code}`);
  }
}

export type KeepImportWarning =
  | { readonly code: "UNKNOWN_COLOR"; readonly color: string }
  | { readonly code: "TEXT_CONTENT_IGNORED"; readonly textContent: string }
  | { readonly code: "UNSAFE_ANNOTATION_URL"; readonly url: string };

export interface KeepWebLink {
  readonly url: string;
  readonly title?: string;
  readonly description?: string;
  readonly source?: string;
}
export interface KeepAttachment {
  readonly filePath: string;
  readonly mimetype: string;
}
export interface KeepNoteDraft {
  readonly title: string;
  readonly body:
    | { readonly kind: "text"; readonly text: string }
    | { readonly kind: "checklist"; readonly items: readonly ChecklistItem[] };
  readonly labels: readonly string[];
  readonly pinned: boolean;
  readonly archived: boolean;
  readonly trashed: boolean;
  readonly colour: KeepColour;
  readonly created?: string;
  readonly updated?: string;
  readonly links: readonly KeepWebLink[];
  readonly attachments: readonly KeepAttachment[];
}
export interface KeepParseResult {
  readonly draft: KeepNoteDraft;
  readonly warnings: readonly KeepImportWarning[];
}
export interface KeepNoteFile {
  readonly fileName: string;
  readonly json: string;
}
export type KeepBatchResult =
  | ({ readonly index: number; readonly fileName: string; readonly ok: true } & KeepParseResult)
  | {
      readonly index: number;
      readonly fileName?: string;
      readonly ok: false;
      readonly error: KeepImportError;
    };
