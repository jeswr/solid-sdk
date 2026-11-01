// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { AppGlyph, FileTypeIcon } from "@jeswr/suite-ui";
import type { SearchResult } from "../lib/search-results";

export function SearchResultRow({ result }: { result: SearchResult }) {
  return (
    <span className="flex min-w-0 items-center gap-3 py-2">
      {result.type === "file" ? (
        <FileTypeIcon name={result.title} />
      ) : (
        <AppGlyph app={result.app} />
      )}
      <span className="grid min-w-0 flex-1 gap-1">
        <span className="truncate font-medium">{result.title}</span>
        {result.parent && (
          <span className="truncate text-xs text-muted-foreground">{result.parent}</span>
        )}
      </span>
      {result.modified && (
        <time
          className="shrink-0 text-xs text-muted-foreground"
          dateTime={result.modified.toISOString()}
        >
          {new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(
            result.modified,
          )}
        </time>
      )}
    </span>
  );
}
