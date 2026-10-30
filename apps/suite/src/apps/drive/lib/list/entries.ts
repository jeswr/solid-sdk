// AUTHORED-BY Codex GPT-6.1-Sol
import { isRecord, isText, requireValid } from "./validation";

/** Resolved display names and dates come from the caller's SDK façade adapter. */
export interface ListEntry {
  readonly url: string;
  readonly kind: "container" | "resource";
  readonly displayName: string;
  readonly size?: number | null;
  readonly modified?: Date | null;
  readonly contentType?: string | null;
}

// MIME essence and token/quoted-string parameters; unsupported syntax is rejected.
const token = String.raw`[!#$%&'*+.^_\x60|~0-9A-Za-z-]+`;
const quoted = String.raw`"(?:[\t\x20\x21\x23-\x5b\x5d-\x7e]|\\[\t\x20-\x7e])*"`;
const mime = new RegExp(
  `^(${token}/${token})(?:[ \\t]*;[ \\t]*${token}=(?:${token}|${quoted}))*[ \\t]*$`,
);

export function mimeEssence(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  requireValid(typeof value === "string", "invalid-mime");
  const match = mime.exec(value);
  requireValid(match !== null, "invalid-mime");
  // The first capture always exists after this expression matches.
  const essence = (match[1] as string).toLowerCase();
  requireValid(!essence.includes("*"), "invalid-mime");
  return essence;
}

export function validateEntry(entry: ListEntry): void {
  requireValid(isRecord(entry), "invalid-entry");
  requireValid(isText(entry.url) && isText(entry.displayName), "invalid-entry");
  requireValid(entry.kind === "container" || entry.kind === "resource", "invalid-entry");
  if (entry.size !== undefined && entry.size !== null) {
    requireValid(Number.isSafeInteger(entry.size) && entry.size >= 0, "invalid-entry");
  }
  if (entry.modified !== undefined && entry.modified !== null) {
    requireValid(
      entry.modified instanceof Date && Number.isFinite(entry.modified.getTime()),
      "invalid-entry",
    );
  }
  mimeEssence(entry.contentType);
}

export function validateEntries(entries: readonly ListEntry[]): void {
  requireValid(Array.isArray(entries), "invalid-entry");
  const seen = new Set<string>();
  for (const entry of entries) {
    validateEntry(entry);
    requireValid(!seen.has(entry.url), "invalid-entry");
    seen.add(entry.url);
  }
}
