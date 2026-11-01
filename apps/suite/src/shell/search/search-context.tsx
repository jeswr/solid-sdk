// AUTHORED-BY Claude Opus 5.5
"use client";
/**
 * One search source per signed-in account, shared by the TopBar search and the
 * /search page. The demo account is indexed from its seed; other accounts start
 * empty until SDK-APP-09 (`useSearch`) supplies server or synced results.
 */
import { createContext, type ReactNode, useContext, useEffect, useState } from "react";
import type { SearchSource } from "../lib/search-results";
import { useAccounts } from "../session/accounts-provider";
import { demoSearchItems } from "./demo-items";
import { createLocalSearchSource } from "./local-source";

const SearchSourceContext = createContext<SearchSource | null>(null);

export function ShellSearchProvider({ children }: { children: ReactNode }) {
  const { active } = useAccounts();
  const [source, setSource] = useState<SearchSource>(() => createLocalSearchSource([]));
  const accountId = active?.id;
  const demo = active?.kind === "demo";
  // biome-ignore lint/correctness/useExhaustiveDependencies: a different account gets a fresh index
  useEffect(() => {
    let cancelled = false;
    // A new account never sees the previous account's index.
    setSource(createLocalSearchSource([]));
    if (demo)
      void import("../../lib/demo-pod/seed")
        .then(({ buildDemoSeed }) => buildDemoSeed(Date.now()))
        .then((seed) => {
          if (!cancelled) setSource(createLocalSearchSource(demoSearchItems(seed)));
        })
        .catch(() => {
          /* The empty index stays; search still works, with no demo results. */
        });
    return () => {
      cancelled = true;
    };
  }, [accountId, demo]);
  return <SearchSourceContext.Provider value={source}>{children}</SearchSourceContext.Provider>;
}

export function useShellSearchSource(): SearchSource {
  const source = useContext(SearchSourceContext);
  if (!source) throw new Error("useShellSearchSource requires ShellSearchProvider");
  return source;
}
