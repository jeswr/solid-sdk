// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { Button, EmptyState, ErrorState, Label, LoadingSkeleton, suiteApps } from "@jeswr/suite-ui";
import { useId, useRef, useState } from "react";
import {
  defaultSearchFilters,
  filterSearchResults,
  type SearchFilters,
} from "../lib/search-filters";
import { type SearchResult, searchGroups } from "../lib/search-results";
import { SearchResultRow } from "./result-row";
import styles from "./search.module.css";

export interface SearchResultsViewProps {
  query: string;
  results: readonly SearchResult[];
  loading?: boolean;
  error?: "unreachable" | "forbidden" | "unknown";
  onRetry?: () => void;
  accountId?: string;
  onOpen?: (result: SearchResult) => void;
}
/** Page body only: the route owns its h1, query/source lifecycle and account boundary. */
export function SearchResultsView({
  query,
  results,
  loading,
  error,
  onRetry,
  accountId,
  onOpen,
}: SearchResultsViewProps) {
  const [filters, setFilters] = useState<SearchFilters>(defaultSearchFilters);
  const [scrollTop, setScrollTop] = useState(0);
  const viewport = useRef<HTMLElement>(null);
  const id = useId();
  const filtered = filterSearchResults(results, filters, accountId ? { accountId } : {});
  const start = Math.max(0, Math.min(Math.floor(scrollTop / 80) - 3, filtered.length - 1));
  const visible = filtered.slice(start, start + 18);
  const update = <K extends keyof SearchFilters>(key: K, value: SearchFilters[K]) => {
    setFilters((current) => ({ ...current, [key]: value }));
    setScrollTop(0);
    viewport.current?.scrollTo(0, 0);
  };
  const clear = () => {
    setFilters(defaultSearchFilters);
    setScrollTop(0);
    viewport.current?.scrollTo(0, 0);
  };
  return (
    <div className={styles.results}>
      <aside aria-label="Search filters" className="grid content-start gap-3">
        <h2 className="font-semibold">Filter results</h2>
        <Label htmlFor={`${id}-type`}>Type</Label>
        <select
          className="min-h-10 rounded border bg-background p-2"
          id={`${id}-type`}
          value={filters.type}
          onChange={(event) => update("type", event.target.value as SearchFilters["type"])}
        >
          <option value="any">Any type</option>
          {searchGroups.map(([type, label]) => (
            <option key={type} value={type}>
              {label}
            </option>
          ))}
        </select>
        <Label htmlFor={`${id}-app`}>App</Label>
        <select
          className="min-h-10 rounded border bg-background p-2"
          id={`${id}-app`}
          value={filters.app}
          onChange={(event) => update("app", event.target.value as SearchFilters["app"])}
        >
          <option value="any">Any app</option>
          {suiteApps.map((app) => (
            <option key={app.slug} value={app.slug}>
              {app.name}
            </option>
          ))}
        </select>
        <Label htmlFor={`${id}-modified`}>Modified</Label>
        <select
          className="min-h-10 rounded border bg-background p-2"
          id={`${id}-modified`}
          value={filters.modified}
          onChange={(event) => update("modified", event.target.value as SearchFilters["modified"])}
        >
          <option value="any">Any time</option>
          <option value="7">7 days</option>
          <option value="30">30 days</option>
          <option value="year">Year</option>
        </select>
        <Label htmlFor={`${id}-owner`}>Owner</Label>
        <select
          className="min-h-10 rounded border bg-background p-2"
          id={`${id}-owner`}
          value={filters.owner}
          onChange={(event) => update("owner", event.target.value as SearchFilters["owner"])}
        >
          <option value="anyone">Anyone</option>
          <option value="me">Me</option>
        </select>
        <Button variant="outline" onClick={clear}>
          Clear filters
        </Button>
      </aside>
      <section aria-label="Search results">
        <h2 className="font-semibold">Results for “{query}”</h2>
        {error ? (
          <ErrorState error={error} actions={onRetry ? { retry: onRetry } : {}} />
        ) : loading ? (
          <LoadingSkeleton preset="list" />
        ) : !filtered.length ? (
          <EmptyState variant="filtered-empty" query={query} onClearFilters={clear} />
        ) : (
          <>
            <p role="status" className="py-2 text-sm">
              {filtered.length} results
            </p>
            <section
              ref={viewport}
              aria-label="Scrollable search results"
              // biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users need to scroll the virtualized region.
              tabIndex={0}
              className="max-h-[65dvh] overflow-auto"
              onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
            >
              <ul
                aria-label="Matching items"
                style={{
                  paddingTop: start * 80,
                  paddingBottom: Math.max(0, filtered.length - start - visible.length) * 80,
                }}
              >
                {visible.map((result, index) => (
                  <li
                    key={result.id}
                    aria-setsize={filtered.length}
                    aria-posinset={start + index + 1}
                    className="h-20 border-b"
                  >
                    <a
                      className="block px-2"
                      href={result.href}
                      onClick={(event) => {
                        if (
                          onOpen &&
                          !event.metaKey &&
                          !event.ctrlKey &&
                          !event.shiftKey &&
                          !event.altKey
                        ) {
                          event.preventDefault();
                          onOpen(result);
                        }
                      }}
                    >
                      <SearchResultRow result={result} />
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}
      </section>
    </div>
  );
}
