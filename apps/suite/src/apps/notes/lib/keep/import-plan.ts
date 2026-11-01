// AUTHORED-BY Claude Opus 5.5
import { validLink } from "../../../docs/lib/editor/logic";
import type { NoteColour } from "../model/prefs";
import type { NoteChanges } from "../model/store";
import { captureTitle, escapeHtml, taskListHtml } from "../ui/capture";
import { parseKeepBatch } from "./parse";
import {
  type KeepColour,
  type KeepImportErrorCode,
  type KeepNoteDraft,
  type KeepNoteFile,
  MAX_KEEP_BATCH_FILES,
} from "./types";

const COLOURS: Record<KeepColour, NoteColour> = {
  DEFAULT: "default",
  RED: "red",
  ORANGE: "orange",
  YELLOW: "yellow",
  GREEN: "green",
  TEAL: "teal",
  BLUE: "blue",
  CERULEAN: "blue",
  PURPLE: "purple",
  PINK: "pink",
  BROWN: "brown",
  GRAY: "grey",
};

/** Plain-language reasons; they never echo note content. */
export const KEEP_SKIP_REASONS: Record<KeepImportErrorCode | "duplicate", string> = {
  INVALID_KEEP_NOTE: "Not a Google Keep note",
  NOTE_TOO_LARGE: "Larger than 1 MB",
  BATCH_TOO_LARGE: "Too many files",
  INVALID_TIMESTAMP: "Has a date Notes can't read",
  UNSAFE_ATTACHMENT_PATH: "Has an attachment Notes can't safely read",
  duplicate: "Already in Notes",
};

export interface KeepImportItem {
  readonly fileName: string;
  readonly input: Required<NoteChanges>;
  readonly pinned: boolean;
  readonly colour: NoteColour;
  readonly archived: boolean;
}
export interface KeepImportPlan {
  readonly ready: readonly KeepImportItem[];
  readonly skipped: readonly { readonly fileName: string; readonly reason: string }[];
  /** Notes Keep had in its Trash; they are left out. */
  readonly trashed: number;
  /** Non-JSON files in the selection, such as the HTML copies and images Takeout adds. */
  readonly ignored: number;
  /** Attachment files referenced by the ready notes; Notes can't store them yet. */
  readonly attachments: number;
  /** Ready notes whose import changed something, such as an unknown colour or an unsafe link. */
  readonly adjusted: number;
}

function linkHtml(url: string, title: string | undefined): string {
  const label = escapeHtml(title?.trim() || url);
  const href = validLink(url);
  return href ? `<p><a href="${escapeHtml(href)}">${label}</a></p>` : `<p>${label}</p>`;
}

function trimBlankLines(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && !(lines[start] as string).trim()) start++;
  while (end > start && !(lines[end - 1] as string).trim()) end--;
  return lines.slice(start, end);
}

/** The Notes body for a Keep note: paragraphs or a task list, then its web links. */
export function keepBodyHtml(draft: KeepNoteDraft): string {
  const content =
    draft.body.kind === "checklist"
      ? taskListHtml(draft.body.items.filter((item) => item.text.trim()))
      : trimBlankLines(draft.body.text.replace(/\r\n?/g, "\n").split("\n"))
          .map((line) => (line.trim() ? `<p>${escapeHtml(line)}</p>` : "<p></p>"))
          .join("");
  return content + draft.links.map((link) => linkHtml(link.url, link.title)).join("");
}

export function keepDraftToNote(
  fileName: string,
  draft: KeepNoteDraft,
): KeepImportItem & { trashed: boolean } {
  const title = draft.title.trim();
  return {
    fileName,
    input: {
      title: title.length > 200 ? captureTitle(title) : title,
      body: keepBodyHtml(draft),
      labels: [...new Set(draft.labels.map((label) => label.trim()).filter(Boolean))],
    },
    pinned: draft.pinned,
    colour: COLOURS[draft.colour],
    archived: draft.archived,
    trashed: draft.trashed,
  };
}

/** Identifies a note by its title and body, to spot notes imported before. */
export const keepFingerprint = (note: { title: string; body: string }) =>
  JSON.stringify([note.title.trim(), note.body]);

/**
 * Parse a Takeout selection and decide what to import. Only `.json` files are read,
 * notes from Keep's Trash are left out, and a note whose title and body already match
 * an existing note is skipped, so choosing the same files twice does not duplicate them.
 */
export function planKeepImport(
  files: readonly KeepNoteFile[],
  existing: readonly { title: string; body: string }[],
): KeepImportPlan {
  const json = files.filter((file) => /\.json$/i.test(file.fileName));
  if (json.length > MAX_KEEP_BATCH_FILES)
    return {
      ready: [],
      skipped: [{ fileName: `${json.length} files`, reason: KEEP_SKIP_REASONS.BATCH_TOO_LARGE }],
      trashed: 0,
      ignored: files.length - json.length,
      attachments: 0,
      adjusted: 0,
    };
  const seen = new Set(existing.map(keepFingerprint));
  const ready: KeepImportItem[] = [];
  const skipped: { fileName: string; reason: string }[] = [];
  let trashed = 0;
  let attachments = 0;
  let adjusted = 0;
  for (const result of parseKeepBatch(json)) {
    const fileName = result.fileName ?? `File ${result.index + 1}`;
    if (!result.ok) {
      skipped.push({ fileName, reason: KEEP_SKIP_REASONS[result.error.code] });
      continue;
    }
    const { trashed: inTrash, ...item } = keepDraftToNote(fileName, result.draft);
    if (inTrash) {
      trashed++;
      continue;
    }
    const key = keepFingerprint(item.input);
    if (seen.has(key)) {
      skipped.push({ fileName, reason: KEEP_SKIP_REASONS.duplicate });
      continue;
    }
    seen.add(key);
    attachments += result.draft.attachments.length;
    if (result.warnings.length) adjusted++;
    ready.push(item);
  }
  return { ready, skipped, trashed, ignored: files.length - json.length, attachments, adjusted };
}
