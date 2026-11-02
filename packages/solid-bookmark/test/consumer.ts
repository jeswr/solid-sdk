// AUTHORED-BY Codex GPT-6.1-Sol
// Compile the installed declarations with exactOptionalPropertyTypes enabled.
import type { Bookmark, BookmarkData } from "@jeswr/solid-bookmark";
import type { TermWrapper } from "@rdfjs/wrapper";

declare const bookmark: Bookmark;
bookmark.url = undefined;
bookmark.title = undefined;
bookmark.description = undefined;
bookmark.notes = undefined;
bookmark.created = undefined;
bookmark.modified = undefined;
bookmark.archived = undefined;
const archived: boolean = bookmark.archived;
const data: BookmarkData = { url: "https://example.org/", archived };
const wrapper: TermWrapper = bookmark;
const marked: Bookmark = bookmark.mark();
const isBookmark: boolean = bookmark.mark().isBookmark;
void data;
void wrapper;
void marked;
void isBookmark;
