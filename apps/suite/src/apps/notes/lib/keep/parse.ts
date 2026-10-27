// AUTHORED-BY Codex GPT-6.1-Sol
import { decodeKeepJson } from "./json";
import {
  KEEP_COLOURS,
  type KeepAttachment,
  type KeepBatchResult,
  type KeepColour,
  KeepImportError,
  type KeepImportWarning,
  type KeepNoteDraft,
  type KeepNoteFile,
  type KeepParseResult,
  type KeepWebLink,
  MAX_KEEP_BATCH_FILES,
  MAX_KEEP_FILE_NAME_LENGTH,
} from "./types";

function requireValue(condition: unknown): asserts condition {
  if (!condition) throw new KeepImportError("INVALID_KEEP_NOTE");
}

function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  requireValue(typeof value === "object" && value !== null && !Array.isArray(value));
  requireValue(Object.keys(value).every((key) => keys.includes(key)));
  return value as Record<string, unknown>;
}

function text(value: unknown): string {
  requireValue(typeof value === "string" && value.isWellFormed());
  return value;
}

function flag(value: unknown): boolean {
  requireValue(typeof value === "boolean");
  return value;
}

function array(value: unknown): unknown[] {
  requireValue(Array.isArray(value));
  return value;
}

function timestamp(value: unknown): string {
  // Numeric JSON tokens have been preserved as strings by decodeKeepJson.
  requireValue(typeof value === "string");
  if (!/^-?\d+$/.test(value) || value.trim() !== value) {
    throw new KeepImportError("INVALID_TIMESTAMP");
  }
  const microseconds = BigInt(value);
  const maximum = BigInt("8640000000000000000");
  if (microseconds > maximum || microseconds < -maximum) {
    throw new KeepImportError("INVALID_TIMESTAMP");
  }
  return new Date(Number(microseconds / BigInt(1000))).toISOString();
}

function labels(value: unknown): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of array(value)) {
    const label = text(record(entry, ["name"]).name).trim();
    const key = label.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(label);
    }
  }
  return result;
}

function links(value: unknown, warnings: KeepImportWarning[]): KeepWebLink[] {
  const result: KeepWebLink[] = [];
  for (const entry of array(value)) {
    const annotation = record(entry, ["url", "title", "description", "source"]);
    const url = text(annotation.url);
    const metadata: Omit<KeepWebLink, "url"> = {
      ...("title" in annotation ? { title: text(annotation.title) } : {}),
      ...("description" in annotation ? { description: text(annotation.description) } : {}),
      ...("source" in annotation ? { source: text(annotation.source) } : {}),
    };
    let safe = false;
    // Do not let URL's whitespace/backslash repairs silently reinterpret input.
    if (/^https?:\/\//i.test(url) && !/[\s\\\p{Cc}]/u.test(url)) {
      try {
        const parsed = new URL(url);
        safe = parsed.protocol === "http:" || parsed.protocol === "https:";
      } catch {
        // Invalid http(s) destinations follow the same explicit warning path.
      }
    }
    if (safe) result.push({ url, ...metadata });
    else warnings.push({ code: "UNSAFE_ANNOTATION_URL", url });
  }
  return result;
}

function attachments(value: unknown): KeepAttachment[] {
  return array(value).map((entry) => {
    const attachment = record(entry, ["filePath", "mimetype"]);
    const filePath = text(attachment.filePath);
    const mimetype = text(attachment.mimetype);
    if (
      filePath.length === 0 ||
      /^[/\\]/.test(filePath) ||
      /^[^/\\]*:/.test(filePath) ||
      /\p{Cc}/u.test(filePath) ||
      filePath.split(/[/\\]/).includes("..")
    ) {
      throw new KeepImportError("UNSAFE_ATTACHMENT_PATH");
    }
    return { filePath, mimetype };
  });
}

/** Parse one bounded, serialized Takeout note; HTML is never used as a fallback. */
export function parseKeepNote(json: string): KeepParseResult {
  requireValue(typeof json === "string");
  const note = record(decodeKeepJson(json), [
    "title",
    "textContent",
    "textContentHtml",
    "listContent",
    "labels",
    "isPinned",
    "isArchived",
    "isTrashed",
    "color",
    "createdTimestampUsec",
    "userEditedTimestampUsec",
    "annotations",
    "attachments",
  ]);
  // decodeKeepJson has already bounded listContent and labels before JSON.parse.
  const warnings: KeepImportWarning[] = [];
  if ("textContentHtml" in note) text(note.textContentHtml);
  const bodyText = "textContent" in note ? text(note.textContent) : "";
  let body: KeepNoteDraft["body"] = { kind: "text", text: bodyText };
  if ("listContent" in note) {
    body = {
      kind: "checklist",
      items: array(note.listContent).map((entry) => {
        const item = record(entry, ["text", "isChecked"]);
        return { text: text(item.text), checked: flag(item.isChecked) };
      }),
    };
    if ("textContent" in note)
      warnings.push({ code: "TEXT_CONTENT_IGNORED", textContent: bodyText });
  }
  let colour: KeepColour = "DEFAULT";
  if ("color" in note) {
    const color = text(note.color);
    if ((KEEP_COLOURS as readonly string[]).includes(color)) colour = color as KeepColour;
    else warnings.push({ code: "UNKNOWN_COLOR", color });
  }
  const draft: KeepNoteDraft = {
    title: "title" in note ? text(note.title) : "",
    body,
    labels: "labels" in note ? labels(note.labels) : [],
    pinned: "isPinned" in note ? flag(note.isPinned) : false,
    archived: "isArchived" in note ? flag(note.isArchived) : false,
    trashed: "isTrashed" in note ? flag(note.isTrashed) : false,
    colour,
    ...("createdTimestampUsec" in note ? { created: timestamp(note.createdTimestampUsec) } : {}),
    ...("userEditedTimestampUsec" in note
      ? { updated: timestamp(note.userEditedTimestampUsec) }
      : {}),
    links: "annotations" in note ? links(note.annotations, warnings) : [],
    attachments: "attachments" in note ? attachments(note.attachments) : [],
  };
  return { draft, warnings };
}

/** File failures stay in input order, including malformed file descriptors. */
export function parseKeepBatch(files: readonly KeepNoteFile[]): KeepBatchResult[] {
  requireValue(Array.isArray(files));
  if (files.length > MAX_KEEP_BATCH_FILES) throw new KeepImportError("BATCH_TOO_LARGE");
  return Array.from({ length: files.length }, (_, index): KeepBatchResult => {
    let fileName: string | undefined;
    try {
      const file = record(files[index], ["fileName", "json"]);
      requireValue(
        typeof file.fileName === "string" && file.fileName.length <= MAX_KEEP_FILE_NAME_LENGTH,
      );
      fileName = text(file.fileName);
      requireValue(typeof file.json === "string");
      return { index, fileName, ok: true, ...parseKeepNote(file.json) };
    } catch (error) {
      return {
        index,
        ...(fileName === undefined ? {} : { fileName }),
        ok: false,
        error: error instanceof KeepImportError ? error : new KeepImportError("INVALID_KEEP_NOTE"),
      };
    }
  });
}
