// AUTHORED-BY Codex (GPT-6.1 Sol)
import { type BookmarkData, isHttpIri } from "@jeswr/solid-bookmark";

export type BookmarkView = "all" | "unread" | "archived";
export type BookmarkSort = "newest" | "oldest" | "title";
export interface BookmarkItem {
  id: string;
  data: BookmarkData;
}
export function bookmarkTitle(data: BookmarkData): string {
  return data.title?.trim() || new URL(data.url).host;
}
export function bookmarkDraft(draft: {
  url: string;
  title: string;
  description: string;
  notes: string;
  tags: string;
}): BookmarkData {
  const url = draft.url.trim();
  if (!isHttpIri(url)) throw new TypeError("Enter a full http:// or https:// URL.");
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
