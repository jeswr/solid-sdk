// AUTHORED-BY Codex
import type { MirrorMetadata } from "./mirror-metadata";

export interface PendingEdit {
  owner?: string;
  title: string;
  baseTitle: string | undefined;
  baseModified: string | undefined;
  // Explicit intent also preserves a revert to base across reloads. Absent in older mirrors.
  localTitle?: string | null;
}
function parse<T>(raw: unknown): T | undefined {
  if (typeof raw !== "string") return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

/** The primary intent keeps its place; competing owners retain their own baselines. */
export function pendingEdits(current: MirrorMetadata): PendingEdit[] {
  if (!current.pending) return [];
  const primary =
    parse<PendingEdit>(current.edit) ??
    (typeof current.title === "string"
      ? {
          title: current.title,
          baseTitle: undefined,
          baseModified: undefined,
        }
      : undefined);
  return [...(primary ? [primary] : []), ...(parse<PendingEdit[]>(current.alternateEdits) ?? [])];
}
export function pendingEditMetadata(edits: PendingEdit[]): Record<string, string | number> {
  const primary = edits[0];
  return primary
    ? {
        pending: 1,
        title: primary.title,
        edit: JSON.stringify(primary),
        alternateEdits: JSON.stringify(edits.slice(1)),
      }
    : { pending: 0, alternateEdits: "[]" };
}
export function hasTitleIntent(edit: PendingEdit) {
  return edit.localTitle !== undefined ? edit.localTitle !== null : edit.title !== edit.baseTitle;
}
