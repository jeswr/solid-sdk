// AUTHORED-BY Claude Opus 5.5
"use client";
/**
 * Global search results (02-suite-shell §5). The query and scope come from the
 * URL; results come from the same source the TopBar search uses.
 */
import { type AppSlug, EmptyState, suiteApps } from "@jeswr/suite-ui";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import type { SearchResult } from "@/shell/lib/search-results";
import { createLocalSearchSource } from "@/shell/search/local-source";
import { SearchResultsView } from "@/shell/search/results-view";
import { useAccounts } from "@/shell/session/accounts-provider";
import { SuiteShell } from "@/shell/suite-shell";

function scopeOf(value: string | null): AppSlug | undefined {
  return suiteApps.find((app) => app.slug === value)?.slug;
}

function SearchPage() {
  const params = useSearchParams();
  const router = useRouter();
  const query = params.get("q")?.trim() ?? "";
  const scope = scopeOf(params.get("scope"));
  const { active } = useAccounts();
  // One local index per account (02-§5 "Searching your saved copies").
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new account gets a fresh index
  const source = useMemo(() => createLocalSearchSource([]), [active?.id]);
  const [state, setState] = useState<{
    results: readonly SearchResult[];
    loading: boolean;
    error?: "unknown";
  }>({ results: [], loading: false });
  const [attempt, setAttempt] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt re-runs the search on Retry
  useEffect(() => {
    if (!query) {
      setState({ results: [], loading: false });
      return;
    }
    const controller = new AbortController();
    setState((current) => ({ results: current.results, loading: true }));
    source
      .search(query, { ...(scope ? { scope } : {}), signal: controller.signal })
      .then(({ results }) => setState({ results, loading: false }))
      .catch(() => {
        if (!controller.signal.aborted) setState({ results: [], loading: false, error: "unknown" });
      });
    return () => controller.abort();
  }, [query, scope, source, attempt]);
  return (
    <SuiteShell app={scope ?? "home"} pageTitle="Search" searchSource={source}>
      {!query ? (
        <EmptyState
          title="Search your suite"
          body="Type in the search box at the top to find files, documents, tasks and people."
        />
      ) : (
        <SearchResultsView
          query={query}
          results={state.results}
          loading={state.loading}
          {...(state.error ? { error: state.error } : {})}
          onRetry={() => setAttempt((value) => value + 1)}
          {...(active ? { accountId: active.webId } : {})}
          onOpen={(result) => router.push(result.href)}
        />
      )}
    </SuiteShell>
  );
}

export default function Page() {
  return (
    <Suspense>
      <SearchPage />
    </Suspense>
  );
}
