// AUTHORED-BY Claude Opus 4.8
//
// The inbox view's data hook — the SINGLE place the view touches the data
// layer. It owns the "which mailbox document am I looking at + its loading/
// error state + which message is open" concern and delegates the actual
// GET+parse to the data layer's `MailStore.load`; it never re-implements
// LDP/RDF reading.
//
// A mailbox is a DOCUMENT (e.g. `…/mail/folders/inbox.ttl`), not a container,
// so — unlike a file browser — there is no trailing-slash normalisation here:
// the URL is used verbatim for the GET, and each message is a sibling subject
// IRI inside that document (its `id`).
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
import { MailAccessError, MailStore } from "../model/store.js";
import { errorMessage } from "./format.js";

/**
 * A render-shaped, plain view of one message — a snapshot of the immutable
 * fields the inbox list + reading pane display, decoupled from the live
 * `Message` wrapper (which is bound to the loaded dataset). All string fields
 * are rendered as text by the view; no value is ever treated as markup.
 */
export interface MessageView {
  /** The message's subject IRI in the document — the stable selection key. */
  id: string;
  /** Subject line, or `undefined` (the view shows a "(no subject)" fallback). */
  subject: string | undefined;
  /** Plain-text body, or `undefined`. */
  body: string | undefined;
  /** Sender IRI/string, or `undefined`. */
  sender: string | undefined;
  /** To recipients (contact/WebID IRIs). */
  to: string[];
  /** Cc recipients. */
  cc: string[];
  /** The display date: dateSent if present, else dateReceived, else undefined. */
  date: Date | undefined;
  /** Whether the owner has read the message. */
  isRead: boolean;
}

/** What the view needs to render the inbox + a single open message + states. */
export interface InboxState {
  /** The messages in the mailbox, newest first; empty until the load resolves. */
  messages: MessageView[];
  /** True while a GET is in flight. */
  loading: boolean;
  /**
   * A user-facing error for the mailbox, or `null`. A 401/403 is reported as a
   * distinct, login-/permission-flavoured message; any other failure (404,
   * network, parse) is reported generically.
   */
  error: string | null;
  /** True when the current error is an authentication/authorization failure. */
  isAccessError: boolean;
  /** The id of the message currently open for reading, or `null` for the list. */
  selectedId: string | null;
  /** The currently open message, or `null` when none is selected. */
  selected: MessageView | null;
  /** Open a message by id for reading. */
  select: (id: string) => void;
  /** Return from the reading pane to the list. */
  back: () => void;
  /** Re-fetch the mailbox (e.g. a manual "retry" after an error). */
  refresh: () => void;
}

/** Options for {@link useInbox}. */
export interface UseInboxOptions {
  /**
   * The authenticated fetch. Omit to use the ambient global fetch (which
   * @solid/reactive-authentication patches in a real session). This is the
   * injectable auth seam — see the file header.
   */
  fetch?: typeof fetch;
}

/**
 * Sort newest-first by display date; messages without a date sort last,
 * preserving their relative document order (a stable sort). Returns a NEW array
 * — the input is never mutated. Exported so its comparator branches (dated vs
 * undated, in both orderings, and the undated-vs-undated `0` case) are unit-
 * testable directly, independent of the store's arbitrary message iteration
 * order.
 */
export function newestFirst(messages: MessageView[]): MessageView[] {
  return [...messages].sort((a, b) => {
    const at = a.date?.getTime();
    const bt = b.date?.getTime();
    if (at === undefined && bt === undefined) return 0;
    if (at === undefined) return 1;
    if (bt === undefined) return -1;
    return bt - at;
  });
}

/**
 * React state for reading a Solid mailbox document. `mailboxUrl` is loaded on
 * mount, again on refresh, and again whenever the `mailboxUrl` prop changes — a
 * new mailbox resets the selection + listing rather than stranding the view on
 * the previous one. It cancels an in-flight load on prop-change/unmount so a
 * slow earlier request can never overwrite a newer one (the classic stale
 * race). All reads go through `MailStore.load`, so WAC handling and the typed
 * model come for free.
 */
export function useInbox(mailboxUrl: string, options: UseInboxOptions = {}): InboxState {
  const { fetch: authedFetch } = options;
  const [messages, setMessages] = useState<MessageView[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isAccessError, setIsAccessError] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Bumped to force a re-fetch of the same URL (refresh) without a URL change.
  const [reloadToken, setReloadToken] = useState(0);
  // Guards against a resolved-but-stale response overwriting newer state.
  const requestIdRef = useRef(0);
  // Tracks the mailbox URL the current state belongs to, kept in STATE (not a
  // ref) so the prop-change reset is concurrent-rendering safe: a ref written
  // during render can leak from an ABANDONED render, which would make a later
  // committed render with the same URL skip the reset and strand the view on
  // the previous mailbox. State set during render is instead applied by React
  // only when the render commits, so the comparison below is always against the
  // committed value.
  const [prevUrl, setPrevUrl] = useState(mailboxUrl);

  // Reset selection + listing DURING render when the mailbox prop changes
  // (React's documented "adjusting state when a prop changes" pattern — applies
  // in the same commit, so the view never flashes the previous mailbox). The
  // load effect below then GETs the new mailbox. The mount case is excluded
  // because `prevUrl` is seeded with the initial URL. Driven by the `prevUrl`
  // STATE, not a render-time ref write, so it is correct under concurrent
  // rendering.
  if (prevUrl !== mailboxUrl) {
    setPrevUrl(mailboxUrl);
    setMessages([]);
    setError(null);
    setIsAccessError(false);
    setSelectedId(null);
  }

  // `reloadToken` is a deliberate re-fetch TRIGGER (bumped by refresh()): it is
  // not read in the body, but its change must re-run the effect to GET the same
  // URL again. The static analyzer can't infer that intent — hence the explicit
  // dependency plus this suppression.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reloadToken is an intentional refetch trigger
  useEffect(() => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    setIsAccessError(false);

    const store = new MailStore(authedFetch ? { fetch: authedFetch } : {});
    store
      .load(mailboxUrl)
      .then((loaded) => {
        if (requestId !== requestIdRef.current) {
          return; // a newer load superseded this one
        }
        // Snapshot each live Message wrapper into a plain MessageView while the
        // dataset is in hand, then drop the wrappers (they are bound to this
        // load's dataset). Sorting newest-first happens once, here.
        const views: MessageView[] = [];
        for (const m of loaded.mailbox.messages) {
          views.push({
            id: m.value,
            subject: m.subjectLine,
            body: m.body,
            sender: m.sender,
            to: [...m.to],
            cc: [...m.cc],
            date: m.dateSent ?? m.dateReceived,
            isRead: m.isRead,
          });
        }
        setMessages(newestFirst(views));
        setLoading(false);
      })
      .catch((err: unknown) => {
        // The cleanup below bumps `requestIdRef` before the next load, so a
        // superseded load is caught by this single staleness check — we never
        // surface an error or state from a request that is no longer current.
        if (requestId !== requestIdRef.current) {
          return;
        }
        if (err instanceof MailAccessError) {
          setIsAccessError(true);
          setError(
            err.status === 401
              ? "You need to log in to view this mailbox."
              : "You don't have permission to view this mailbox.",
          );
        } else {
          setError(errorMessage(err));
        }
        setLoading(false);
      });

    return () => {
      // Mark any in-flight response as stale; the data layer's fetch is not
      // abortable through MailStore, so staleness is enforced by the requestId
      // check above rather than an AbortController.
      requestIdRef.current++;
    };
  }, [mailboxUrl, authedFetch, reloadToken]);

  const select = useCallback((id: string) => {
    setSelectedId(id);
  }, []);

  const back = useCallback(() => {
    setSelectedId(null);
  }, []);

  const refresh = useCallback(() => {
    setReloadToken((n) => n + 1);
  }, []);

  // The open message, resolved from the current id against the current list. A
  // selected id that is no longer present (e.g. after a refresh removed it)
  // resolves to null, so the view falls back to the list rather than a blank
  // pane. Derived, not stored, so it can never drift from `messages`.
  const selected = useMemo(
    () => (selectedId === null ? null : (messages.find((m) => m.id === selectedId) ?? null)),
    [messages, selectedId],
  );

  return {
    messages,
    loading,
    error,
    isAccessError,
    selectedId,
    selected,
    select,
    back,
    refresh,
  };
}
