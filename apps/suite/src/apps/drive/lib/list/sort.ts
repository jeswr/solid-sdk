// AUTHORED-BY Codex GPT-6.1-Sol
import { type ListEntry, mimeEssence, validateEntries, validateEntry } from "./entries";
import { isRecord, isText, ListError, requireValid } from "./validation";

export interface SortOptions {
  readonly key?: "name" | "size" | "modified" | "type";
  readonly dir?: "asc" | "desc";
  readonly foldersFirst?: boolean;
  readonly locale?: string;
}

/** Unknown values are last regardless of direction. Equal keys retain input order. */
export function createListComparator(
  options: SortOptions = {},
): (a: ListEntry, b: ListEntry) => number {
  requireValid(isRecord(options), "invalid-options");
  const { key = "name", dir = "asc", foldersFirst = true, locale = "en" } = options;
  requireValid(
    typeof key === "string" && ["name", "size", "modified", "type"].includes(key),
    "invalid-options",
  );
  requireValid(dir === "asc" || dir === "desc", "invalid-options");
  requireValid(typeof foldersFirst === "boolean" && isText(locale), "invalid-options");
  let collator: Intl.Collator;
  try {
    requireValid(Intl.Collator.supportedLocalesOf([locale]).length === 1, "invalid-options");
    collator = new Intl.Collator(locale, { numeric: true, sensitivity: "base" });
  } catch {
    throw new ListError("invalid-options");
  }
  const direction = dir === "asc" ? 1 : -1;
  const sortValue = (entry: ListEntry): string | number | null | undefined => {
    switch (key) {
      case "name":
        return entry.displayName;
      case "size":
        return entry.kind === "container" ? null : entry.size;
      case "modified":
        return entry.modified?.getTime();
      case "type":
        return mimeEssence(entry.contentType);
    }
  };
  return (a, b) => {
    validateEntry(a);
    validateEntry(b);
    if (foldersFirst && a.kind !== b.kind) return a.kind === "container" ? -1 : 1;
    const left = sortValue(a);
    const right = sortValue(b);
    if (left == null) return right == null ? 0 : 1;
    if (right == null) return -1;
    if (typeof left === "string") return direction * collator.compare(left, right as string);
    return direction * (left - (right as number));
  };
}

/** Sort a fresh array, validating even empty/singleton inputs. */
export function sortEntries<T extends ListEntry>(
  entries: readonly T[],
  options?: SortOptions,
): T[] {
  const compare = createListComparator(options);
  validateEntries(entries);
  return [...entries].sort(compare);
}
