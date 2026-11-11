// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
import { validateImage, validLink } from "../../../docs/lib/editor/logic";
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
export const KEEP_SKIP_REASONS: Record<
  KeepImportErrorCode | "duplicate" | "empty" | "attachmentsOnly",
  string
> = {
  INVALID_KEEP_NOTE: "Not a Google Keep note",
  NOTE_TOO_LARGE: "Larger than 1 MB",
  BATCH_TOO_LARGE: "Too many files",
  INVALID_TIMESTAMP: "Has a date Notes can't read",
  UNSAFE_ATTACHMENT_PATH: "Has an attachment Notes can't safely read",
  duplicate: "Already in Notes",
  empty: "Has no text to import",
  attachmentsOnly: "Only has images or recordings that are unavailable or unsupported",
};

export interface KeepImportItem {
  readonly fileName: string;
  readonly images?: readonly Blob[];
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
  /** Unavailable or unsupported attachment files referenced by the ready notes. */
  readonly attachments: number;
  /** Ready notes with an unknown colour or a link that is not a web address. */
  readonly adjusted: number;
}

/** Drop any user name and password a saved link carried; they never go into a note. */
function withoutCredentials(url: string): string {
  try {
    const parsed = new URL(url);
    if (!parsed.username && !parsed.password) return url;
    parsed.username = "";
    parsed.password = "";
    return parsed.href;
  } catch {
    return url;
  }
}

function linkHtml(url: string, title: string | undefined): string {
  const safe = withoutCredentials(url);
  const label = escapeHtml(title?.trim() || safe);
  const href = validLink(safe);
  return href ? `<p><a href="${escapeHtml(href)}">${label}</a></p>` : `<p>${label}</p>`;
}

const paragraphs = (text: string) =>
  trimBlankLines(text.replace(/\r\n?/g, "\n").split("\n"))
    .map((line) => (line.trim() ? `<p>${escapeHtml(line)}</p>` : "<p></p>"))
    .join("");

function trimBlankLines(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && !(lines[start] as string).trim()) start++;
  while (end > start && !(lines[end - 1] as string).trim()) end--;
  return lines.slice(start, end);
}

/**
 * The Notes body for a Keep note: paragraphs or a task list, any text Keep kept beside
 * a checklist, then its web links.
 */
export function keepBodyHtml(draft: KeepNoteDraft, extraText = ""): string {
  const content =
    draft.body.kind === "checklist"
      ? taskListHtml(draft.body.items.filter((item) => item.text.trim())) + paragraphs(extraText)
      : paragraphs(draft.body.text);
  return content + draft.links.map((link) => linkHtml(link.url, link.title)).join("");
}

export function keepDraftToNote(
  fileName: string,
  draft: KeepNoteDraft,
  extraText = "",
): KeepImportItem & { trashed: boolean } {
  const title = draft.title.trim();
  return {
    fileName,
    input: {
      title: title.length > 200 ? captureTitle(title) : title,
      body: keepBodyHtml(draft, extraText),
      labels: [...new Set(draft.labels.map((label) => label.trim()).filter(Boolean))],
    },
    pinned: draft.pinned,
    colour: COLOURS[draft.colour],
    archived: draft.archived,
    trashed: draft.trashed,
  };
}

/** Identifies a note by its title, body and labels, to spot notes imported before. */
export const keepFingerprint = (note: { title: string; body: string; labels: readonly string[] }) =>
  JSON.stringify([
    note.title.trim(),
    note.body.replace(/<img\b[^>]*>/gi, ""),
    [...note.labels].sort(),
  ]);

/**
 * Parse a Takeout selection and decide what to import. Only `.json` files are read,
 * notes from Keep's Trash and notes with no text or available images are left out, and a note whose title,
 * body and labels already match an existing note is skipped, so choosing the same files
 * twice does not duplicate them.
 */
export function planKeepImport(
  files: readonly KeepNoteFile[],
  existing: readonly { title: string; body: string; labels: readonly string[] }[],
  media: ReadonlyMap<string, File> = new Map(),
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
    // A checklist's displaced text is kept below the list rather than dropped.
    const extraText = result.warnings
      .map((warning) => (warning.code === "TEXT_CONTENT_IGNORED" ? warning.textContent : ""))
      .join("\n");
    const { trashed: inTrash, ...item } = keepDraftToNote(fileName, result.draft, extraText);
    if (inTrash) {
      trashed++;
      continue;
    }
    const images = result.draft.attachments.flatMap((attachment) => {
      const directory = fileName.slice(0, fileName.lastIndexOf("/") + 1);
      const path = (directory + attachment.filePath.replace(/\\/g, "/"))
        .split("/")
        .filter((part) => part !== ".")
        .join("/");
      const file = media.get(path);
      if (!file || (file.type && file.type !== attachment.mimetype)) return [];
      const blob = new Blob([file], { type: attachment.mimetype });
      return validateImage(blob) ? [] : [blob];
    });
    if (images.length) Object.assign(item, { images });
    if (images.length && !item.input.title && !item.input.body)
      item.input.title = captureTitle(
        fileName.slice(fileName.lastIndexOf("/") + 1).replace(/\.json$/i, "") || "Image note",
      );
    if (!item.input.title && !item.input.body && !images.length) {
      skipped.push({
        fileName,
        reason: result.draft.attachments.length
          ? KEEP_SKIP_REASONS.attachmentsOnly
          : KEEP_SKIP_REASONS.empty,
      });
      continue;
    }
    const key = keepFingerprint(item.input);
    if (seen.has(key)) {
      skipped.push({ fileName, reason: KEEP_SKIP_REASONS.duplicate });
      continue;
    }
    seen.add(key);
    attachments += result.draft.attachments.length - images.length;
    if (result.warnings.some((warning) => warning.code !== "TEXT_CONTENT_IGNORED")) adjusted++;
    ready.push(item);
  }
  return { ready, skipped, trashed, ignored: files.length - json.length, attachments, adjusted };
}
