// AUTHORED-BY Codex GPT-6.1-Sol
"use client";

import { useEffect, useState } from "react";
import type { Search, SearchPage, SearchQuery } from "./types.js";

/** Debounced query state. A null query suspends searching and returns idle. */
export interface UseSearchResult {
  status: "idle" | "loading" | "ready" | "error";
  page: SearchPage | undefined;
  error: unknown;
}

/** Debounce 250 ms; abort replaced/unmounted requests and ignore late settlements. */
export function useSearch(q: SearchQuery | null, search: Search): UseSearchResult {
  const [state, setState] = useState<UseSearchResult>({
    status: "idle",
    page: undefined,
    error: undefined,
  });
  // Value equality allows inline query objects without restarting the debounce on every render.
  const key = JSON.stringify(q);
  useEffect(() => {
    if (key === "null") {
      setState({ status: "idle", page: undefined, error: undefined });
      return;
    }
    const abort = new AbortController();
    setState({ status: "loading", page: undefined, error: undefined });
    const timer = setTimeout(async () => {
      try {
        const page = await search(JSON.parse(key) as SearchQuery, { signal: abort.signal });
        if (!abort.signal.aborted) setState({ status: "ready", page, error: undefined });
      } catch (error) {
        if (!abort.signal.aborted) setState({ status: "error", page: undefined, error });
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [key, search]);
  return state;
}
