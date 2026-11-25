// AUTHORED-BY Codex (GPT-6.1 Sol)
// AUTHORED-BY Codex GPT-6
import { type BookmarkData, httpIriOrUndefined } from "@jeswr/solid-bookmark";
import { parseNetscapeBookmarks } from "@jeswr/solid-bookmark/netscape";
import type { BookmarkPatch } from "@jeswr/solid-bookmark/pod";

export const importSizeMessage =
  "This import exceeds the size limit. Use an HTML export under 10 MB with up to 5,000 bookmarks and shorter titles, notes, descriptions, URLs, or tags.";
export function bookmarkImport(html: string) {
  const result = parseNetscapeBookmarks(html);
  if (result.error === "file-too-large" || result.bookmarks.length > 5000)
    throw new Error(importSizeMessage);
  return result;
}

export type BookmarkView = "all" | "unread" | "archived";
export type BookmarkSort = "newest" | "oldest" | "title";
export interface BookmarkItem {
  id: string;
  data: BookmarkData;
}
export function bookmarkTitle(data: BookmarkData): string {
  return data.title?.trim() || new URL(data.url).host;
}
interface BookmarkDraft {
  url: string;
  title: string;
  description: string;
  notes: string;
  tags: string;
}
export function bookmarkDraft(draft: BookmarkDraft): BookmarkData {
  const url = httpIriOrUndefined(draft.url.trim());
  if (!url) throw new TypeError("Enter a full http:// or https:// URL.");
  return {
    url,
    title: draft.title.trim() || new URL(url).host,
    description: draft.description.trim(),
    notes: draft.notes.trim(),
    tags: [
      ...new Set(
        draft.tags
          .split(/[,\n]/)
          .map((tag) => tag.trim())
          .filter(Boolean),
      ),
    ].sort(),
  };
}
export function bookmarkEditorFields(data?: BookmarkData): BookmarkDraft {
  return {
    url: data?.url ?? "",
    title: data?.title ?? "",
    description: data?.description ?? "",
    notes: data?.notes ?? "",
    tags: data?.tags?.join(", ") ?? "",
  };
}
export function bookmarkEditPatch(draft: BookmarkDraft, opening: BookmarkData): BookmarkPatch {
  const original = bookmarkEditorFields(opening);
  const value = bookmarkDraft(draft);
  const patch: BookmarkPatch = {};
  for (const key of ["url", "title", "description", "notes", "tags"] as const)
    if (draft[key] !== original[key]) Object.assign(patch, { [key]: value[key] });
  return patch;
}
export function visibleBookmarks(
  items: readonly BookmarkItem[],
  filters: {
    view: BookmarkView;
    tag: string | null;
    search: string;
    sort: BookmarkSort;
  },
): BookmarkItem[] {
  const terms = filters.search.toLocaleLowerCase("en-GB").split(/\s+/).filter(Boolean);
  return items
    .filter(({ data }) => {
      if (filters.view === "unread" && data.archived) return false;
      if (filters.view === "archived" && !data.archived) return false;
      if (filters.tag && !data.tags?.includes(filters.tag)) return false;
      const haystack = [data.title, data.url, data.description, data.notes, ...(data.tags ?? [])]
        .join(" ")
        .toLocaleLowerCase("en-GB");
      return terms.every((term) => haystack.includes(term));
    })
    .sort((a, b) => {
      const order =
        filters.sort === "title"
          ? bookmarkTitle(a.data).localeCompare(bookmarkTitle(b.data), "en-GB")
          : ((a.data.created?.getTime() ?? 0) - (b.data.created?.getTime() ?? 0)) *
            (filters.sort === "newest" ? -1 : 1);
      return order || a.id.localeCompare(b.id);
    });
}
export function bookmarkTags(items: readonly BookmarkItem[]): [string, number][] {
  const counts = new Map<string, number>();
  for (const { data } of items)
    for (const tag of new Set(data.tags ?? [])) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  return [...counts].sort(([a], [b]) => a.localeCompare(b, "en-GB"));
}
