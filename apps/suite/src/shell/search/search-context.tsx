// AUTHORED-BY Claude Opus 5.5
"use client";
/**
 * One search source per signed-in account, shared by the TopBar search and the
 * /search page. Demo search uses its seed; pod search owns an ephemeral SDK index.
 */
import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from "react";
import type { SearchSource } from "../lib/search-results";
import { useAccounts } from "../session/accounts-provider";
import type { SuiteAccount } from "../session/types";
import { demoSearchItems } from "./demo-items";
import { createLocalSearchSource } from "./local-source";
import { createPodSearchSource } from "./pod-source";

const SearchSourceContext = createContext<SearchSource | null>(null);

export function ShellSearchProvider({ children }: { children: ReactNode }) {
  const accounts = useAccounts();
  const latest = useRef(accounts);
  latest.current = accounts;
  const { active, status } = accounts;
  const key = JSON.stringify([active?.id, active?.webId, active?.storageUrl, active?.kind, status]);
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const usable = () => latest.current.active === active && latest.current.status === "ready";
    if (!usable()) throw new Error("Sign in to search");
    const response = await latest.current.fetch(input, init);
    if (!usable()) throw new Error("Sign in to search");
    return response;
  };
  const [source, setSource] = useState<SearchSource>(() => createLocalSearchSource([]));
  // Only the source is rebuilt per account and session state, never the app beneath it:
  // consumers drop displayed results whenever the source changes. AUTHORED-BY Claude Opus 5.5
  return (
    <>
      <AccountSearchSource
        key={key}
        account={active}
        ready={status === "ready"}
        fetch={fetch}
        onSource={setSource}
      />
      <SearchSourceContext.Provider value={source}>{children}</SearchSourceContext.Provider>
    </>
  );
}

function AccountSearchSource({
  account,
  ready,
  fetch,
  onSource: setSource,
}: {
  account: SuiteAccount | null;
  ready: boolean;
  fetch: typeof globalThis.fetch;
  onSource: (source: SearchSource) => void;
}) {
  const currentFetch = useRef(fetch);
  currentFetch.current = fetch;
  const storageUrl = account?.storageUrl;
  const demo = account?.kind === "demo";
  useEffect(() => {
    let cancelled = false;
    // A new account or session never sees the previous one's index.
    setSource(createLocalSearchSource([]));
    const pod =
      ready && !demo && storageUrl
        ? createPodSearchSource(storageUrl, (input, init) => currentFetch.current(input, init))
        : undefined;
    if (pod) {
      setSource(pod);
      void pod.warmed.then(() => {
        if (!cancelled) setSource({ search: pod.search });
      });
    }
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
      pod?.dispose();
    };
  }, [demo, ready, storageUrl, setSource]);
  return null;
}

export function useShellSearchSource(): SearchSource {
  const source = useContext(SearchSourceContext);
  if (!source) throw new Error("useShellSearchSource requires ShellSearchProvider");
  return source;
}

/** Standalone app previews can still offer contacts without creating a second search index. */
export function useOptionalShellSearchSource(): SearchSource | null {
  return useContext(SearchSourceContext);
}
