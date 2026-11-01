// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import {
  type AppSlug,
  Button,
  IconButton,
  Input,
  Label,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from "@jeswr/suite-ui";
import { Search } from "lucide-react";
import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import {
  groupSearchResults,
  readRecentSearches,
  recentSearchesKey,
  type SearchResponse,
  type SearchResult,
  type SearchSource,
  searchHintKey,
  updateRecentSearches,
} from "../lib/search-results";
import { useShortcut } from "../shortcuts/provider";
import { SearchResultRow } from "./result-row";
import styles from "./search.module.css";

export type { SearchResult, SearchSource } from "../lib/search-results";
export interface GlobalSearchProps {
  source: SearchSource;
  scope?: { app: AppSlug; label: string };
  onOpen: (result: SearchResult) => void;
  onSeeAll: (query: string, scope?: AppSlug) => void;
}

function SearchBox({
  source,
  scope,
  onOpen,
  onSeeAll,
  scopeEnabled,
  setScopeEnabled,
  onClose,
}: GlobalSearchProps & {
  scopeEnabled: boolean;
  setScopeEnabled: (enabled: boolean) => void;
  onClose?: () => void;
}) {
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [recent, setRecent] = useState<string[]>([]);
  const [hintDismissed, setHintDismissed] = useState(true);
  const [response, setResponse] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [active, setActive] = useState(-1);
  const root = useRef<HTMLElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  const term = query.trim();
  const app = scopeEnabled ? scope?.app : undefined;
  const groups = groupSearchResults(response?.results ?? []);
  const results = groups.flatMap((group) => group.results);
  const count = term ? results.length + 1 : recent.length;
  const open = expanded && (!!term || recent.length > 0);
  useEffect(() => {
    try {
      setRecent(readRecentSearches(localStorage.getItem(recentSearchesKey)));
      setHintDismissed(localStorage.getItem(searchHintKey) === "dismissed");
    } catch {
      setHintDismissed(false);
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setResponse(null);
    setFailed(false);
    setActive(-1);
    setLoading(!!term);
    if (!term) return () => controller.abort();
    const timer = setTimeout(() => {
      void Promise.resolve()
        .then(() =>
          source.search(term, { ...(app ? { scope: app } : {}), signal: controller.signal }),
        )
        .then((value) => {
          if (!controller.signal.aborted) {
            setResponse(value);
            setLoading(false);
          }
        })
        .catch(() => {
          if (!controller.signal.aborted) {
            setFailed(true);
            setLoading(false);
          }
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [source, term, app]);
  useEffect(() => {
    if (active >= 0)
      document.getElementById(`${id}-option-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [active, id]);
  const remember = () => {
    const updated = updateRecentSearches(recent, term);
    setRecent(updated);
    try {
      localStorage.setItem(recentSearchesKey, JSON.stringify(updated));
    } catch {
      /* Search still works without browser storage. */
    }
  };
  const close = () => {
    setExpanded(false);
    setActive(-1);
    onClose?.();
  };
  const seeAll = () => {
    remember();
    close();
    onSeeAll(term, app);
  };
  const selectResult = (result: SearchResult) => {
    remember();
    close();
    onOpen(result);
  };
  const selectRecent = (value: string) => {
    setQuery(value);
    setActive(-1);
    input.current?.focus();
  };
  const keydown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.isDefaultPrevented() || event.nativeEvent.isComposing) return;
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      input.current?.blur();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setExpanded(true);
      if (count)
        setActive((current) =>
          event.key === "ArrowDown"
            ? (current + 1) % count
            : current <= 0
              ? count - 1
              : current - 1,
        );
    } else if (event.key === "Enter" && term) {
      event.preventDefault();
      const result = results[active];
      if (result) selectResult(result);
      else seeAll();
    } else if (event.key === "Enter" && recent[active]) {
      event.preventDefault();
      selectRecent(recent[active]);
    }
  };
  let index = 0;
  return (
    <search
      ref={root}
      className={styles.root}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setExpanded(false);
      }}
    >
      <Label htmlFor={`${id}-input`}>Search</Label>
      <div className={styles.field}>
        {scope ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label={
              scopeEnabled ? `Remove scope: in ${scope.label}` : `Search in ${scope.label}`
            }
            onClick={() => {
              setScopeEnabled(!scopeEnabled);
              setExpanded(true);
              input.current?.focus();
            }}
          >
            {scopeEnabled ? `in ${scope.label} ×` : "Everywhere"}
          </Button>
        ) : (
          <span className="text-xs text-muted-foreground">Everywhere</span>
        )}
        <Input
          ref={input}
          id={`${id}-input`}
          data-global-search
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={`${id}-list`}
          aria-activedescendant={
            open && active >= 0 && active < count ? `${id}-option-${active}` : undefined
          }
          value={query}
          autoComplete="off"
          placeholder="Search your storage"
          onChange={(event) => {
            setQuery(event.target.value);
            setExpanded(true);
            setActive(-1);
          }}
          onFocus={() => setExpanded(true)}
          onKeyDown={keydown}
        />
      </div>
      {open && (
        <div className={styles.panel}>
          {response && (
            <p role="status" className="sr-only">
              {results.length} search suggestions
            </p>
          )}
          {loading && (
            <p role="status" className="p-3">
              Searching…
            </p>
          )}
          {failed && (
            <p role="status" className="p-3">
              Search couldn't finish. Try another search.
            </p>
          )}
          {!loading && !failed && term && results.length === 0 && (
            <p role="status" className="p-3">
              No results for “{term}”
            </p>
          )}
          <div
            id={`${id}-list`}
            role="listbox"
            aria-label={term ? "Search results" : "Recent searches"}
            className={styles.list}
          >
            {term ? (
              <>
                {groups.map((group) => (
                  <fieldset aria-label={group.label} key={group.type}>
                    <div
                      aria-hidden="true"
                      className="px-2 py-1 text-xs font-semibold text-muted-foreground"
                    >
                      {group.label}
                    </div>
                    {group.results.map((result) => {
                      const option = index++;
                      return (
                        <a
                          href={result.href}
                          role="option"
                          aria-selected={active === option}
                          tabIndex={-1}
                          id={`${id}-option-${option}`}
                          key={result.id}
                          className={styles.option}
                          onPointerMove={() => setActive(option)}
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={(event) => {
                            if (
                              !event.metaKey &&
                              !event.ctrlKey &&
                              !event.shiftKey &&
                              !event.altKey
                            ) {
                              event.preventDefault();
                              selectResult(result);
                            }
                          }}
                        >
                          <SearchResultRow result={result} />
                        </a>
                      );
                    })}
                  </fieldset>
                ))}
                <a
                  role="option"
                  aria-selected={active === results.length}
                  tabIndex={-1}
                  id={`${id}-option-${results.length}`}
                  className={styles.option}
                  href={`/search?${new URLSearchParams({ q: term, ...(app ? { scope: app } : {}) })}`}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={(event) => {
                    event.preventDefault();
                    seeAll();
                  }}
                  onPointerMove={() => setActive(results.length)}
                >
                  See all results
                </a>
              </>
            ) : (
              recent.map((value, option) => (
                <button
                  key={value}
                  type="button"
                  role="option"
                  aria-selected={active === option}
                  tabIndex={-1}
                  id={`${id}-option-${option}`}
                  className={`${styles.option} w-full text-left`}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => selectRecent(value)}
                  onPointerMove={() => setActive(option)}
                >
                  {value}
                </button>
              ))
            )}
          </div>
          {!term && (
            <Button
              variant="ghost"
              onClick={() => {
                setRecent([]);
                try {
                  localStorage.removeItem(recentSearchesKey);
                } catch {
                  /* Storage may be disabled. */
                }
              }}
            >
              Clear recent searches
            </Button>
          )}
          {response?.source === "local" && (
            <div className={styles.footer}>
              <p>Searching your saved copies</p>
              {!response.serverSearch && !hintDismissed && (
                <>
                  <p>
                    Your storage doesn't offer search, so results come from items you've opened or
                    synced.
                  </p>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setHintDismissed(true);
                      try {
                        localStorage.setItem(searchHintKey, "dismissed");
                      } catch {
                        /* Dismiss for this visit. */
                      }
                    }}
                  >
                    Dismiss search hint
                  </Button>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </search>
  );
}

export function GlobalSearch(props: GlobalSearchProps) {
  const [mobile, setMobile] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [scopeEnabled, setScopeEnabled] = useState(true);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const media = matchMedia("(max-width: 767px)");
    const update = () => {
      setMobile(media.matches);
      if (!media.matches) setSheetOpen(false);
    };
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useShortcut({
    id: "global.search.scope",
    keys: "Cmd/Ctrl+Shift+F",
    label: "Toggle search scope",
    group: "Global",
    when: () => !!props.scope,
    run: () => setScopeEnabled((value) => !value),
  });
  const box = (
    <SearchBox
      {...props}
      scopeEnabled={scopeEnabled}
      setScopeEnabled={setScopeEnabled}
      {...(mobile ? { onClose: () => setSheetOpen(false) } : {})}
    />
  );
  return mobile ? (
    <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
      <SheetTrigger asChild>
        <IconButton ref={trigger} data-global-search label="Search" variant="ghost">
          <Search aria-hidden="true" />
        </IconButton>
      </SheetTrigger>
      <SheetContent
        side="top"
        className="h-dvh overflow-auto p-4"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          requestAnimationFrame(() =>
            document
              .querySelector<HTMLInputElement>('[role="dialog"] input[data-global-search]')
              ?.focus(),
          );
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          trigger.current?.focus();
        }}
      >
        <SheetTitle>Search your storage</SheetTitle>
        <SheetDescription>Find files, documents, tasks, people, and data.</SheetDescription>
        <div className={styles.mobile}>{box}</div>
      </SheetContent>
    </Sheet>
  ) : (
    box
  );
}
