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
  nameFromUrl,
  type StoredDocument,
} from "../store.js";
import { errorMessage } from "./format.js";

/**
 * The lifecycle of a write (create / save-edit) as the view renders it: `idle`
 * before any write, `saving` while the pod PUT is in flight (the optimistic
 * state is already visible), `saved` on success, `failed` when the persist
 * rejected (the optimistic change has been reverted). Drives the
 * "Saving…/Saved/failed" indicator.
 */
export type SaveStatus = "idle" | "saving" | "saved" | "failed";

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
  /**
   * The current write lifecycle for the create / save-edit flows — drives the
   * "Saving…/Saved/failed" indicator. `idle` until the first write.
   */
  saveStatus: SaveStatus;
  /**
   * A user-facing error for the last write that failed, or `null`. A 401/403 is
   * reported with a login-/permission-flavoured message; any other failure is
   * generic. (`saveStatus === "failed"` whenever this is set.)
   */
  saveError: string | null;
  /** True when the last write error was an authentication/authorization failure. */
  isSaveAccessError: boolean;
  /**
   * Create a new document (optimistic): a placeholder row is inserted into the
   * listing immediately, the pod write runs async, and on success the row is
   * replaced with the persisted entry and the document is opened. On failure the
   * placeholder is removed and `saveStatus` becomes `failed` with `saveError`.
   * Rejects (and surfaces an error) when `title` and `body` are both blank.
   */
  createDocument: (input: { title: string; body: string }) => Promise<void>;
  /**
   * Save an edit to the currently-open document's body (optimistic): the open
   * document's body updates immediately, the pod write (a new PROV revision)
   * runs async under the document's `If-Match` etag. On success the open
   * document is refreshed with the new etag/revision; on failure the body is
   * reverted and `saveStatus` becomes `failed`. A no-op when no document is open.
   */
  saveOpenDocument: (body: string) => Promise<void>;
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
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaveAccessError, setIsSaveAccessError] = useState(false);
  // Bumped to force a re-fetch of the listing (refresh) without a store change.
  const [reloadToken, setReloadToken] = useState(0);
  // Monotonic id for the in-flight async op; bumped on every navigation action
  // (and on effect cleanup / unmount) so a resolved-but-stale response is
  // discarded. Imperative, event-driven bookkeeping — a ref is the right home
  // (NOT render-derived state). The render-time reset below is what must NOT
  // use a render-mutated ref; this guard is only ever read/written in effects
  // and event handlers, never during render.
  const requestRef = useRef(0);
  // Monotonic seed for the temporary URL of an optimistic create placeholder —
  // kept separate from the request guard so the two concerns don't conflate.
  const tempIdRef = useRef(0);
  // Monotonic id for the in-flight SAVE op. Bumped on every saveOpenDocument()
  // call; a save's result (commit etag / revert body / set error) is applied
  // only if its captured id is still the latest — so when the user edits+saves
  // twice in quick succession, an older save resolving LATE cannot clobber the
  // newer save's body or etag (lost update / etag desync). This is the write-
  // path analogue of `requestRef` for reads/opens: the navigation guard
  // (`live.url === current.url`) covers navigate-away; this covers overlapping
  // saves to the SAME open resource. Imperative bookkeeping — a ref is the
  // right home (read/written only in event handlers, never during render).
  const saveRef = useRef(0);
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
    // A new pod/WebID also resets the write indicator — a "Saved"/"failed" from
    // the previous store must not bleed into the new one's view.
    setSaveStatus("idle");
    setSaveError(null);
    setIsSaveAccessError(false);
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

  // Classify a write failure into the user-facing save indicator. Mirrors the
  // read path's 401/403 handling so a create/save surfaces the same login-vs-
  // permission message; any other failure (412 clobber, network, …) is generic.
  const reportSaveFailure = useCallback((err: unknown) => {
    if (isAccessFailure(err)) {
      setIsSaveAccessError(true);
      setSaveError(
        err.status === 401
          ? "You need to log in to save changes."
          : "You don't have permission to save changes here.",
      );
    } else {
      setIsSaveAccessError(false);
      setSaveError(errorMessage(err));
    }
    setSaveStatus("failed");
  }, []);

  const createDocument = useCallback(
    async (input: { title: string; body: string }) => {
      const title = input.title.trim();
      const body = input.body.trim();
      // Validation: a document with neither a title nor a body is rejected
      // before any optimistic insert or pod I/O — there is nothing to create.
      if (title === "" && body === "") {
        setIsSaveAccessError(false);
        setSaveError("Enter a title or some content before creating a document.");
        setSaveStatus("failed");
        return;
      }

      // Optimistic insert: a placeholder row keyed by a temporary, local-only URL
      // appears in the listing IMMEDIATELY, before the pod write resolves. The
      // temp URL is never sent to the pod and is replaced by the real persisted
      // URL on success. Bump the read guard so a concurrent list()/open() read
      // resolving mid-create can't wipe the placeholder out from under us.
      requestRef.current++;
      const tempUrl = `pod-docs:pending:${++tempIdRef.current}`;
      const placeholder: DocumentEntry = {
        url: tempUrl,
        name: title || "Untitled",
        title,
        isContainer: false,
        modified: new Date().toISOString(),
      };
      setEntries((prev) => [...prev, placeholder]);
      setSaveStatus("saving");
      setSaveError(null);
      setIsSaveAccessError(false);

      try {
        const { url, etag } = await store.create({ title, body });
        // Swap the placeholder for the persisted entry (real URL keeps the row
        // stable for React + makes it openable). Then open the new document so
        // the author lands in it.
        setEntries((prev) =>
          prev.map((e) => (e.url === tempUrl ? { ...e, url, name: nameFromUrl(url) } : e)),
        );
        setSaveStatus("saved");
        const created: StoredDocument = {
          url,
          etag,
          data: {
            title,
            body,
            format: "text/html",
            created: placeholder.modified,
            modified: placeholder.modified,
            revisions: [],
          },
        };
        // Show the freshly-created document. Bump the request id so any in-flight
        // open()/list() read can't later clobber this navigation.
        requestRef.current++;
        setOpenDocument(created);
        setOpening(false);
      } catch (err) {
        // Revert: drop the optimistic placeholder so the listing reflects the
        // pod's true (unchanged) state, and surface the failure.
        setEntries((prev) => prev.filter((e) => e.url !== tempUrl));
        reportSaveFailure(err);
      }
    },
    [store, reportSaveFailure],
  );

  const saveOpenDocument = useCallback(
    async (body: string) => {
      const current = openDocument;
      if (current === null) return; // nothing open to save

      // Stamp this save with the latest id. Any save already in flight on this
      // (or any) resource is now SUPERSEDED — when it resolves later, its
      // captured `saveId` will no longer equal `saveRef.current`, so its result
      // is discarded (no lost update / stale-etag write). Mirrors the read/open
      // staleness guard (`requestRef`).
      const saveId = ++saveRef.current;
      const isLatestSave = () => saveId === saveRef.current;

      // Optimistic body update: reflect the edit in the open view immediately.
      const previous = current;
      const optimistic: StoredDocument = {
        ...current,
        data: { ...current.data, body, modified: new Date().toISOString() },
      };
      setOpenDocument(optimistic);
      setSaveStatus("saving");
      setSaveError(null);
      setIsSaveAccessError(false);

      try {
        const { etag } = await store.save(
          current.url,
          {
            title: current.data.title,
            body,
            format: current.data.format,
            creator: current.data.creator,
            created: current.data.created,
            priorRevisions: current.data.revisions,
          },
          current.etag,
        );
        // Discard a superseded save's result entirely: a newer save has already
        // stamped a higher id, so committing THIS (older) save's etag/body would
        // overwrite the newer body and desync the etag for the next If-Match.
        if (!isLatestSave()) return;
        // Commit the new etag so a subsequent save sends the right If-Match. We
        // only mutate the open document if the user hasn't navigated away from
        // THIS resource in the meantime (a store change / close / open-of-another
        // would have replaced it).
        setOpenDocument((live) =>
          live && live.url === current.url ? { ...live, etag, data: { ...live.data, body } } : live,
        );
        setSaveStatus("saved");
      } catch (err) {
        // A superseded save's failure must not revert the newer optimistic body
        // nor flip the indicator to "failed" — the newer save owns the state.
        if (!isLatestSave()) return;
        // Revert the body to the pre-edit state (only if still on this resource).
        setOpenDocument((live) => (live && live.url === current.url ? previous : live));
        reportSaveFailure(err);
      }
    },
    [store, openDocument, reportSaveFailure],
  );

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
    saveStatus,
    saveError,
    isSaveAccessError,
    createDocument,
    saveOpenDocument,
  };
}
