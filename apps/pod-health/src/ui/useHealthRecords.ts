// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// The health-records data hook — the SINGLE place the view touches the data
// layer. It owns the "which health resource am I showing + its loading/error
// state" concern and delegates the actual GET+parse to `readHealth`
// (src/store.ts) and the flattening to `listHealthEntries` (src/entries.ts); it
// never re-implements LDP/RDF reading and never touches the @rdfjs wrapper.
//
// ── AUTH SEAM ────────────────────────────────────────────────────────────────
// The authenticated `fetch` is INJECTED, not imported. Pass the session's fetch
// via the `fetch` option; omit it and the data layer falls back to the global
// `fetch`. In production that global is the one
// @solid/reactive-authentication's ReactiveFetchManager.registerGlobally()
// patches (so a plain fetch transparently upgrades on a 401 with a DPoP token),
// wired ONCE in the create-solid-app shell's <SolidAuthProvider>. That wiring is
// #18-gated (create-solid-app S2 — interactive auth-code login). This hook is
// DELIBERATELY unaware of any of that: it works today against a stubbed fetch in
// unit tests and later against the real session with NO code change. Do NOT
// hard-wire a login flow here.
//
// PRIVACY: a health resource is WAC-gated by the server. A 401/403 surfaces as
// a distinct access error so the view can prompt login / show "no access"
// rather than a raw failure — discovery (a type-index hint) is NOT a grant. We
// never log the document, an entry, or the resource body.

import { useCallback, useEffect, useRef, useState } from "react";
import { type HealthEntry, listHealthEntries } from "../entries.js";
import { RdfFetchError, readHealth } from "../store.js";
import { errorMessage } from "./format.js";

/**
 * Trim surrounding whitespace off the resource URL before it seeds state. A
 * health document is a single LDP RESOURCE (e.g. `.../health/record.ttl`), NOT
 * a container, so — unlike a drive's container URLs — we deliberately do NOT
 * append a trailing slash: that would request a different (container) resource.
 */
function normalizeResourceUrl(url: string): string {
  return url.trim();
}

/** What the view needs to render the health-records list + its states. */
export interface HealthRecordsState {
  /** The flattened, render-ready entries (newest first); empty until loaded. */
  entries: HealthEntry[];
  /** True while a GET is in flight. */
  loading: boolean;
  /**
   * A user-facing error message for the current resource, or `null`. A 401/403
   * is reported as a distinct, login-/permission-flavoured message; any other
   * failure (404, network, parse) is reported generically.
   */
  error: string | null;
  /** True when the current error is an authentication/authorization failure (401/403). */
  isAccessError: boolean;
  /** True once the first load has resolved (success OR error) — gates the empty state. */
  loaded: boolean;
  /** The resource URL currently being shown (normalised). */
  resourceUrl: string;
  /** Re-fetch the current resource (e.g. a manual "retry" after an error). */
  refresh: () => void;
}

/** Options for {@link useHealthRecords}. */
export interface UseHealthRecordsOptions {
  /**
   * The authenticated fetch. Omit to use the ambient global fetch (which
   * @solid/reactive-authentication patches in a real session). This is the
   * injectable auth seam — see the file header.
   */
  fetch?: typeof fetch;
}

/**
 * React state for showing a single health resource as a flat records list.
 * `resourceUrl` is normalised (trimmed, no trailing slash — it is a resource,
 * not a container); the hook loads it on mount, again whenever the (normalised)
 * `resourceUrl` prop changes — a new resource prop resets the view to it rather
 * than stranding the previous list — and on a manual refresh. It cancels an
 * in-flight load on a resource change / unmount so a slow earlier request can
 * never overwrite a newer one (the classic stale race). All reads go through
 * `readHealth`, so WAC handling and the typed model come for free, and through
 * `listHealthEntries`, so the view stays RDF-free.
 */
export function useHealthRecords(
  resourceUrl: string,
  options: UseHealthRecordsOptions = {},
): HealthRecordsState {
  const { fetch: authedFetch } = options;
  // Normalise BEFORE it seeds any state. The raw prop is never used directly.
  const normalizedUrl = normalizeResourceUrl(resourceUrl);
  const [currentUrl, setCurrentUrl] = useState(normalizedUrl);
  const [entries, setEntries] = useState<HealthEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isAccessError, setIsAccessError] = useState(false);
  const [loaded, setLoaded] = useState(false);
  // Bumped to force a re-fetch of the same URL (refresh) without a URL change.
  const [reloadToken, setReloadToken] = useState(0);
  // Guards against a resolved-but-stale response overwriting newer state.
  const requestIdRef = useRef(0);
  // Tracks the normalised resource the view state currently belongs to, kept in
  // STATE (not a ref) so the prop-change reset is concurrent-rendering safe: a
  // ref written during render can leak from an ABANDONED render, which would
  // make a later committed render with the same url skip the reset and strand
  // the list on the previous resource. State set during render is applied by
  // React only when the render commits, so the comparison below is always
  // against the committed value.
  const [prevUrl, setPrevUrl] = useState(normalizedUrl);

  // Reset list + error state DURING render when the normalised resource prop
  // changes (React's documented "adjusting state when a prop changes" pattern —
  // applies in the same commit, so the view never flashes the previous
  // resource's entries). The load effect below then GETs the new resource. The
  // mount case is excluded because `prevUrl` is seeded with the initial url.
  // `loading` is set true HERE (not only in the post-commit effect) so a
  // resource change AFTER a completed load (loading=false) transitions
  // atomically to loading in the SAME render — clearing data + error and
  // showing the spinner together. Without it the committed render would briefly
  // show the stale `loading=false` over empty data (a blank flash) until the
  // effect runs; this matches the initial-mount loading semantics.
  if (prevUrl !== normalizedUrl) {
    setPrevUrl(normalizedUrl);
    setCurrentUrl(normalizedUrl);
    setEntries([]);
    setError(null);
    setIsAccessError(false);
    setLoaded(false);
    setLoading(true);
  }

  // `reloadToken` is a deliberate re-fetch TRIGGER (bumped by refresh()): it is
  // not read in the body, but its change must re-run the effect to GET the same
  // URL again. The static analyzer can't infer that intent — hence the explicit
  // dependency plus this suppression.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reloadToken is an intentional refetch trigger
  useEffect(() => {
    const requestId = ++requestIdRef.current;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setIsAccessError(false);

    readHealth(currentUrl, {
      ...(authedFetch ? { fetch: authedFetch } : {}),
      signal: controller.signal,
    })
      .then((result) => {
        if (requestId !== requestIdRef.current) {
          return; // a newer load superseded this one
        }
        setEntries(listHealthEntries(result.document));
        setLoading(false);
        setLoaded(true);
      })
      .catch((err: unknown) => {
        // The cleanup below bumps `requestIdRef` before aborting, so a
        // superseded load (incl. an aborted one) is caught by this single
        // staleness check — we never surface an error from a no-longer-current
        // request. Note: we do NOT log `err` — it can reference health content.
        if (requestId !== requestIdRef.current) {
          return;
        }
        if (err instanceof RdfFetchError && (err.status === 401 || err.status === 403)) {
          setIsAccessError(true);
          setError(
            err.status === 401
              ? "You need to log in to view these health records."
              : "You don't have permission to view these health records.",
          );
        } else {
          setError(errorMessage(err));
        }
        setLoading(false);
        setLoaded(true);
      });

    return () => {
      // Mark any in-flight response as stale and abort the underlying GET.
      requestIdRef.current++;
      controller.abort();
    };
  }, [currentUrl, authedFetch, reloadToken]);

  const refresh = useCallback(() => {
    setReloadToken((n) => n + 1);
  }, []);

  return {
    entries,
    loading,
    error,
    isAccessError,
    loaded,
    resourceUrl: currentUrl,
    refresh,
  };
}
