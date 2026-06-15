// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// The document-browser's data hook — the SINGLE place the view touches the data
// layer. It owns the "which documents are in my store + which one (if any) am I
// reading + their loading/error state" concern and delegates the actual pod I/O
// to `DocsStore` (src/store.ts); it never re-implements LDP/RDF reading.
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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createDocsStore,
  type DocsStore,
  type DocumentEntry,
  type StoredDocument,
} from "../store.js";
import { errorMessage } from "./format.js";

/** True when a caught value is an HTTP access failure (401 / 403). */
function isAccessFailure(err: unknown): err is { status: 401 | 403 } {
  // `@jeswr/fetch-rdf`'s RdfFetchError (and the data layer's write/delete
  // errors) carry a numeric `.status`; we duck-type rather than import the class
  // so the view stays decoupled from the fetch library's identity.
  if (typeof err !== "object" || err === null || !("status" in err)) {
    return false;
  }
  const status = (err as { status?: unknown }).status;
  return status === 401 || status === 403;
}

/** What the view needs to render the listing + the open document + states. */
export interface DocsListingState {
  /** The documents in the store's container; `[]` until the first load resolves. */
  entries: DocumentEntry[];
  /** The currently-open document (read-only), or `null` when browsing the list. */
  openDocument: StoredDocument | null;
  /** True while the listing load is in flight. */
  loading: boolean;
  /** True while an individual document is being opened. */
  opening: boolean;
  /**
   * A user-facing error for the current operation, or `null`. A 401/403 is
   * reported as a distinct, login-/permission-flavoured message; any other
   * failure (404, network, parse) is reported generically.
   */
  error: string | null;
  /** True when the current error is an authentication/authorization failure. */
  isAccessError: boolean;
  /** Open a document by URL (read-only). Must be a document in this store. */
  open: (url: string) => void;
  /** Close the open document and return to the listing. */
  close: () => void;
  /** Re-fetch the listing (e.g. a manual "retry" after an error). */
  refresh: () => void;
}

/** Options for {@link useDocsListing}. */
export interface UseDocsListingOptions {
  /**
   * The authenticated fetch. Omit to use the ambient global fetch (which
   * @solid/reactive-authentication patches in a real session). This is the
   * injectable auth seam — see the file header.
   */
  fetch?: typeof fetch;
  /**
   * Construct the data-layer store. Injectable so a test can supply a
   * pre-wired/stub store; defaults to the real `createDocsStore`. The view never
   * imports the store directly — it flows through this seam.
   */
  createStore?: typeof createDocsStore;
}

/**
 * React state for browsing a pod's Pod-Docs documents. Builds a `DocsStore`
 * bound to (`podRoot`, `webId`) and lists it on mount; re-lists whenever either
 * identity prop (or the injected fetch/store factory) changes — a new pod/WebID
 * resets the open document and re-loads that store rather than stranding the
 * view on the previous pod's documents.
 *
 * The data layer exposes NO `AbortSignal`, so staleness is handled here: a
 * monotonic request counter is bumped on every load/open/close/unmount, and an
 * async result is committed only if its captured id is still current — so a slow
 * earlier load can never overwrite a newer one, and a read resolving after
 * unmount is dropped (the classic stale race + no-setState-after-unmount).
 */
export function useDocsListing(
  podRoot: string,
  webId: string,
  options: UseDocsListingOptions = {},
): DocsListingState {
  const { fetch: authedFetch, createStore = createDocsStore } = options;

  // The store is rebuilt only when an identity input changes — so the load
  // effect's dependency is a stable reference across unrelated re-renders.
  const store: DocsStore = useMemo(
    () => createStore({ podRoot, webId, ...(authedFetch ? { fetchImpl: authedFetch } : {}) }),
    [createStore, podRoot, webId, authedFetch],
  );

  const [entries, setEntries] = useState<DocumentEntry[]>([]);
  const [openDocument, setOpenDocument] = useState<StoredDocument | null>(null);
  const [loading, setLoading] = useState(false);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isAccessError, setIsAccessError] = useState(false);
  // Bumped to force a re-fetch of the listing (refresh) without a store change.
  const [reloadToken, setReloadToken] = useState(0);
  // Monotonic id for the in-flight async op; bumped on every navigation action
  // (and on effect cleanup / unmount) so a resolved-but-stale response is
  // discarded. Imperative, event-driven bookkeeping — a ref is the right home
  // (NOT render-derived state). The render-time reset below is what must NOT
  // use a render-mutated ref; this guard is only ever read/written in effects
  // and event handlers, never during render.
  const requestRef = useRef(0);
  // Tracks the store the navigation state currently belongs to, kept in STATE
  // (not a ref) so the store-change reset is concurrent-rendering safe.
  const [prevStore, setPrevStore] = useState(store);

  // Reset the navigation state DURING render when the store identity changes
  // (React's documented "adjusting state when a prop changes" pattern — applies
  // in the same commit, so the view never flashes the previous pod's open
  // document). The load effect below then lists the new store. The mount case is
  // excluded because `prevStore` is seeded with the initial store.
  //
  // `opening` MUST be reset here too: if a store dep (podRoot/webId/fetch/
  // createStore) changes while an open `store.read()` is in flight, that read's
  // captured request id is staled by the load effect's guard bump (below) and is
  // therefore dropped — its `setOpening(false)` never runs. Without this reset
  // the view would stay stuck on the open/loading flag (table hidden) forever
  // after the new listing loads. The guard is bumped — not here (mutating the
  // request ref during render would break concurrent rendering; see its note
  // above) — but in the load effect that re-runs on the store change AND in the
  // old effect's cleanup, both of which invalidate the in-flight read so it can
  // never later flip state for the old store.
  if (prevStore !== store) {
    setPrevStore(store);
    setOpenDocument(null);
    setOpening(false);
    setError(null);
    setIsAccessError(false);
  }

  // `reloadToken` is a deliberate re-fetch TRIGGER (bumped by refresh()): it is
  // not read in the body, but its change must re-run the effect to list again.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reloadToken is an intentional refetch trigger
  useEffect(() => {
    // Bumping the request id here invalidates any in-flight open `read()` (its
    // captured id is now stale), so a load starting (store change or refresh)
    // can never have its `setOpening(false)` run from the dropped read — we must
    // clear `opening` ourselves. (The store-change render reset clears it in the
    // same commit for the no-flash case; this also covers a refresh-while-opening.)
    const requestId = ++requestRef.current;
    setLoading(true);
    setOpening(false);
    setError(null);
    setIsAccessError(false);
    setOpenDocument(null);

    store
      .list()
      .then((result) => {
        if (requestId !== requestRef.current) {
          return; // a newer store/refresh/open superseded this load
        }
        setEntries(result);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (requestId !== requestRef.current) {
          return;
        }
        if (isAccessFailure(err)) {
          setIsAccessError(true);
          setError(
            err.status === 401
              ? "You need to log in to view these documents."
              : "You don't have permission to view these documents.",
          );
        } else {
          setError(errorMessage(err));
        }
        setLoading(false);
      });

    return () => {
      // Invalidate any in-flight load so its response (the store can't abort) is
      // dropped on store change / refresh / unmount.
      requestRef.current++;
    };
  }, [store, reloadToken]);

  const open = useCallback(
    (url: string) => {
      const requestId = ++requestRef.current;
      setOpening(true);
      setError(null);
      setIsAccessError(false);

      store
        .read(url)
        .then((doc) => {
          if (requestId !== requestRef.current) {
            return; // navigated away before this read resolved
          }
          if (doc === undefined) {
            setError("That document could not be found.");
          } else {
            setOpenDocument(doc);
          }
          setOpening(false);
        })
        .catch((err: unknown) => {
          if (requestId !== requestRef.current) {
            return;
          }
          if (isAccessFailure(err)) {
            setIsAccessError(true);
            setError(
              err.status === 401
                ? "You need to log in to view this document."
                : "You don't have permission to view this document.",
            );
          } else {
            setError(errorMessage(err));
          }
          setOpening(false);
        });
    },
    [store],
  );

  const close = useCallback(() => {
    // Invalidate any in-flight open and return to the listing.
    requestRef.current++;
    setOpenDocument(null);
    setOpening(false);
    setError(null);
    setIsAccessError(false);
  }, []);

  const refresh = useCallback(() => {
    setReloadToken((n) => n + 1);
  }, []);

  return {
    entries,
    openDocument,
    loading,
    opening,
    error,
    isAccessError,
    open,
    close,
    refresh,
  };
}
