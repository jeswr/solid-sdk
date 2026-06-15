// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// The file-browser's data hook — the SINGLE place the view touches the data
// layer. It owns the "which container am I looking at + its loading/error
// state" concern and delegates the actual GET+parse to `listContainer`
// (src/drive.ts); it never re-implements LDP/RDF reading.
//
// ── AUTH SEAM ────────────────────────────────────────────────────────────────
// The authenticated `fetch` is INJECTED, not imported. Pass the session's fetch
// via the `fetch` option; omit it and the data layer falls back to the global
// `fetch`. In production that global is the one
// @solid/reactive-authentication's ReactiveFetchManager.registerGlobally()
// patches (so a plain fetch transparently upgrades on a 401 with a DPoP token),
// wired ONCE in the create-solid-app shell's <SolidAuthProvider>. That wiring is
// #18-gated (create-solid-app S2 — interactive auth-code login;
// https://github.com/solid-contrib/reactive-authentication/issues/18). This
// hook is DELIBERATELY unaware of any of that: it works today against a stubbed
// fetch in unit tests and later against the real session with NO code change.
// Do NOT hard-wire a login flow here.

import { useCallback, useEffect, useRef, useState } from "react";
import { type ContainerListing, DriveAccessError, listContainer } from "../drive.js";
import { errorMessage } from "./format.js";

/**
 * Ensure a single trailing slash. LDP containers are slash-terminated, so the
 * root and every navigated container URL are normalised here before they reach
 * state — keeping `currentUrl` (and therefore the breadcrumb derivation in
 * {@link breadcrumbFor}) consistent with the URL the data layer actually GETs.
 */
function ensureTrailingSlash(url: string): string {
  return url.endsWith("/") ? url : `${url}/`;
}

/** What the view needs to render a folder + its breadcrumb + states. */
export interface DriveListingState {
  /** The container currently being viewed; `null` until the first load resolves. */
  listing: ContainerListing | null;
  /** True while a GET is in flight. */
  loading: boolean;
  /**
   * A user-facing error message for the current container, or `null`. A 401/403
   * is reported as a distinct, login-/permission-flavoured message; any other
   * failure (404, network, parse) is reported generically.
   */
  error: string | null;
  /** True when the current error is an authentication/authorization failure (401/403). */
  isAccessError: boolean;
  /** The URL currently being viewed (normalised, trailing slash). */
  currentUrl: string;
  /** Navigate into a sub-container (or any container URL). */
  navigate: (url: string) => void;
  /** Re-fetch the current container (e.g. a manual "retry" after an error). */
  refresh: () => void;
}

/** Options for {@link useDriveListing}. */
export interface UseDriveListingOptions {
  /**
   * The authenticated fetch. Omit to use the ambient global fetch (which
   * @solid/reactive-authentication patches in a real session). This is the
   * injectable auth seam — see the file header.
   */
  fetch?: typeof fetch;
}

/**
 * React state for browsing a Solid container tree. `rootUrl` is normalised to a
 * single trailing slash; the hook loads it on mount, whenever the caller
 * navigates, and again whenever the (normalised) `rootUrl` prop changes — a new
 * root prop resets navigation to that container rather than stranding the view
 * on the previous one. It cancels an in-flight load on navigation/unmount so a
 * slow earlier request can never overwrite a newer one (the classic stale race).
 * All reads go through `listContainer`, so WAC handling, slash normalisation,
 * and the typed model come for free.
 */
export function useDriveListing(
  rootUrl: string,
  options: UseDriveListingOptions = {},
): DriveListingState {
  const { fetch: authedFetch } = options;
  // Normalise the root to a single trailing slash BEFORE it seeds any state, so
  // a slashless `rootUrl` (e.g. ".../drive") still drives a slash-terminated
  // container GET and a correct ("Drive" → …) breadcrumb. The raw prop is never
  // used directly.
  const normalizedRoot = ensureTrailingSlash(rootUrl);
  const [currentUrl, setCurrentUrl] = useState(normalizedRoot);
  const [listing, setListing] = useState<ContainerListing | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isAccessError, setIsAccessError] = useState(false);
  // Bumped to force a re-fetch of the same URL (refresh) without a URL change.
  const [reloadToken, setReloadToken] = useState(0);
  // Guards against a resolved-but-stale response overwriting newer state.
  const requestIdRef = useRef(0);
  // Tracks the normalised root the navigation state currently belongs to, kept
  // in STATE (not a ref) so the prop-change reset is concurrent-rendering safe:
  // a ref written during render can leak from an ABANDONED render, which would
  // make a later committed render with the same root skip the reset and strand
  // `currentUrl` on the previous container. State set during render is instead
  // applied by React only when the render commits (an abandoned render is
  // discarded), so the comparison below is always against the committed value.
  const [prevRoot, setPrevRoot] = useState(normalizedRoot);

  // Reset navigation + listing state DURING render when the normalised root
  // prop changes (React's documented "adjusting state when a prop changes"
  // pattern — applies in the same commit, so the view never flashes the previous
  // container or its stale breadcrumb). The load effect below then GETs the new
  // root. The mount case is excluded because `prevRoot` is seeded with the
  // initial root. This is driven by the `prevRoot` STATE, not a render-time ref
  // write, so it is correct under React's concurrent rendering.
  if (prevRoot !== normalizedRoot) {
    setPrevRoot(normalizedRoot);
    setCurrentUrl(normalizedRoot);
    setListing(null);
    setError(null);
    setIsAccessError(false);
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

    listContainer(currentUrl, {
      ...(authedFetch ? { fetch: authedFetch } : {}),
      signal: controller.signal,
    })
      .then((result) => {
        if (requestId !== requestIdRef.current) {
          return; // a newer navigation superseded this load
        }
        setListing(result);
        setLoading(false);
      })
      .catch((err: unknown) => {
        // The cleanup below bumps `requestIdRef` before aborting, so a superseded
        // load (incl. an aborted one) is caught by this single staleness check —
        // we never surface an error or state from a request that is no longer current.
        if (requestId !== requestIdRef.current) {
          return;
        }
        if (err instanceof DriveAccessError) {
          setIsAccessError(true);
          setError(
            err.status === 401
              ? "You need to log in to view this folder."
              : "You don't have permission to view this folder.",
          );
        } else {
          setError(errorMessage(err));
        }
        setLoading(false);
      });

    return () => {
      // Mark any in-flight response as stale and abort the underlying GET.
      requestIdRef.current++;
      controller.abort();
    };
  }, [currentUrl, authedFetch, reloadToken]);

  const navigate = useCallback((url: string) => {
    setCurrentUrl(ensureTrailingSlash(url));
  }, []);

  const refresh = useCallback(() => {
    setReloadToken((n) => n + 1);
  }, []);

  return {
    listing,
    loading,
    error,
    isAccessError,
    currentUrl,
    navigate,
    refresh,
  };
}
