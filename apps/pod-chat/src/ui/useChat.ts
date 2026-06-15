// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// The chat view's data hook — the SINGLE place the view touches the data layer.
// It owns two concerns: (1) the list of rooms in the pod, and (2) the messages
// of the currently-open room. It delegates the actual GET+parse to the data
// layer's `ChatStore` (`readRoom` / `readMessage`) and, for the room listing, to
// the `listRoomsOrAccessError` facade (which surfaces a 401/403 on the rooms
// container as a typed access error instead of an empty list); it never
// re-implements LDP/RDF reading.
//
// A room's messages are read from the room descriptor's FORWARD INDEX
// (`as:items`, surfaced as `ChatRoom.messages`) — the message resource IRIs —
// so opening a room is a set of point reads, not a container scan. Messages are
// shown chronologically (oldest-first), the natural reading order for a thread.
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

import { RdfFetchError } from "@jeswr/fetch-rdf";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ResourceWriteError } from "../errors.js";
import { type ChatStore, createChatStore, nameFromUrl } from "../store.js";
import { errorMessage } from "./format.js";
import { listRoomsOrAccessError, RoomsAccessError } from "./rooms.js";

/**
 * A render-shaped, plain view of one room in the list — a snapshot decoupled
 * from the live RDF wrappers. `name` is the descriptor's `as:name` (may be
 * empty); `fallbackName` is derived from the URL so the view always has a label.
 */
export interface RoomView {
  /** The room resource URL — the stable selection key. */
  url: string;
  /** Display name from `as:name`, or `undefined` (the view falls back). */
  name: string | undefined;
  /** A friendly name derived from the URL, used when `name` is absent. */
  fallbackName: string;
  /** Owner WebID — `dct:creator`, or `undefined`. */
  creator: string | undefined;
  /** Created stamp, or `undefined` (or invalid — the view guards). */
  created: Date | undefined;
  /** Number of participants recorded on the room. */
  participantCount: number;
  /** Number of message refs indexed by the room (`as:items`). */
  messageCount: number;
}

/**
 * A render-shaped, plain view of one message in the open room — a snapshot of
 * the immutable fields the thread displays, decoupled from the live wrappers.
 * All string fields are rendered as text by the view; no value is ever treated
 * as markup.
 */
export interface MessageView {
  /** The message resource URL — the stable key. */
  url: string;
  /** Body text — `as:content`, or `undefined` (the view shows a fallback). */
  content: string | undefined;
  /** Author WebID — `as:attributedTo`, or `undefined`. */
  author: string | undefined;
  /** Posted stamp, or `undefined` (or invalid — the view guards). */
  published: Date | undefined;
  /** When the message is an actionable task: its state + title + assignee. */
  task:
    | {
        state: "open" | "closed";
        title: string | undefined;
        assignee: string | undefined;
      }
    | undefined;
  /**
   * True for an OPTIMISTIC message shown before its pod write has confirmed — the
   * view dims it / shows a "Saving…" cue. Absent/false for a persisted message.
   * A failed optimistic message is REMOVED (reverted), never left pending.
   */
  pending?: boolean;
}

/**
 * The composer's persistence state for the most recent send:
 *   - `idle` — nothing in flight (the initial + post-success-settled state);
 *   - `saving` — the optimistic message is shown and the pod write is in flight;
 *   - `saved` — the write confirmed (a brief success cue);
 *   - `failed` — the write failed; the optimistic message was reverted and
 *     `sendError` carries the reason.
 */
export type SendStatus = "idle" | "saving" | "saved" | "failed";

/** What the view needs to render the room list + the open room's thread + states. */
export interface ChatState {
  /** The rooms in the pod, alphabetical; empty until the load resolves. */
  rooms: RoomView[];
  /** True while the room-list GET is in flight. */
  loadingRooms: boolean;
  /** A user-facing error for the room list, or `null`. */
  roomsError: string | null;
  /** True when the room-list error is an authentication/authorization failure. */
  roomsAccessError: boolean;

  /** The URL of the open room, or `null` for the room list. */
  openRoomUrl: string | null;
  /** The open room's `RoomView`, or `null` when none is open / it vanished. */
  openRoom: RoomView | null;
  /** The open room's messages, oldest-first; empty until that load resolves. */
  messages: MessageView[];
  /** True while the open room's message thread is loading. */
  loadingMessages: boolean;
  /** A user-facing error for the open room's thread, or `null`. */
  messagesError: string | null;
  /** True when the thread error is an authentication/authorization failure. */
  messagesAccessError: boolean;

  /** The persistence state of the most recent composer send. */
  sendStatus: SendStatus;
  /** A user-facing error for a failed send, or `null`. */
  sendError: string | null;
  /** True when the failed send was an authentication/authorization failure. */
  sendAccessError: boolean;

  /** Open a room by URL — loads its message thread. */
  open: (url: string) => void;
  /** Return from the open room to the room list. */
  back: () => void;
  /** Re-fetch the room list (e.g. a manual "retry" after an error). */
  refreshRooms: () => void;
  /** Re-fetch the open room's thread (e.g. a manual "retry"). */
  refreshMessages: () => void;
  /**
   * Post a message body to the OPEN room (author = `webId`, `dateSent` = now).
   * Optimistic: the message shows immediately, then the pod write runs; on
   * failure the optimistic message is reverted and `sendError` is set. An empty
   * or whitespace-only body is a no-op. Resolves `true` on a confirmed write,
   * `false` on a no-op or a failure.
   */
  send: (content: string) => Promise<boolean>;
}

/** Options for {@link useChat}. */
export interface UseChatOptions {
  /**
   * The authenticated fetch. Omit to use the ambient global fetch (which
   * @solid/reactive-authentication patches in a real session). This is the
   * injectable auth seam — see the file header.
   */
  fetch?: typeof fetch;
}

/**
 * Map a thrown value to `{ message, isAccess }`. A `RdfFetchError` with a
 * 401/403 status (the message-thread path) OR a {@link RoomsAccessError} (the
 * room-list facade's typed 401/403, raised so a forbidden rooms container is NOT
 * mistaken for an empty pod) is reported as a distinct, login-/permission-
 * flavoured access error; anything else (404, network, parse) is reported
 * generically. Exported so its branches are directly unit-testable.
 */
export function describeError(err: unknown): { message: string; isAccess: boolean } {
  // An access wall can surface on the READ path (RdfFetchError / RoomsAccessError)
  // OR on the WRITE path (a ResourceWriteError from a PUT the pod refused with a
  // 401/403 — e.g. posting a message into a room you may read but not append to).
  const accessStatus =
    err instanceof RoomsAccessError
      ? err.status
      : (err instanceof RdfFetchError || err instanceof ResourceWriteError) &&
          (err.status === 401 || err.status === 403)
        ? err.status
        : undefined;
  if (accessStatus !== undefined) {
    return {
      isAccess: true,
      message:
        accessStatus === 401
          ? "You need to log in to view this."
          : "You don't have permission to view this.",
    };
  }
  return { isAccess: false, message: errorMessage(err) };
}

/**
 * Sort messages oldest-first by `published` (chronological reading order);
 * messages without a date sort last, preserving their relative order (a stable
 * sort). Returns a NEW array — the input is never mutated. Exported so its
 * comparator branches (dated vs undated, both orderings, and the
 * undated-vs-undated `0` case) are unit-testable directly.
 */
export function chronological(messages: MessageView[]): MessageView[] {
  return [...messages].sort((a, b) => {
    const at = a.published?.getTime();
    const bt = b.published?.getTime();
    if (at === undefined && bt === undefined) return 0;
    if (at === undefined) return 1;
    if (bt === undefined) return -1;
    return at - bt;
  });
}

/**
 * Read a room descriptor into a {@link RoomView}, or `undefined` when the
 * resource holds no `pc:ChatRoom`. The store's `readRoom` propagates a
 * `RdfFetchError` (e.g. 401/403/404), which the caller's staleness-guarded
 * `.catch` surfaces.
 */
async function readRoomView(store: ChatStore, url: string): Promise<RoomView | undefined> {
  const stored = await store.readRoom(url);
  if (stored === undefined) return undefined;
  const { data } = stored;
  return {
    url,
    name: data.name.length > 0 ? data.name : undefined,
    fallbackName: nameFromUrl(url),
    creator: data.creator,
    created: data.created !== undefined ? new Date(data.created) : undefined,
    participantCount: data.participants.length,
    messageCount: data.messages.length,
  };
}

/**
 * As {@link readRoomView}, but tolerant of a per-room read failure: a non-access
 * error (404/500/network/parse) is swallowed to `undefined` so one bad room
 * never sinks the whole listing, while an ACCESS error (a `RdfFetchError` with
 * a 401/403 status) is RE-THROWN so a genuine auth wall surfaces as a list-level
 * error rather than silently emptying the list.
 */
async function readRoomViewResilient(store: ChatStore, url: string): Promise<RoomView | undefined> {
  try {
    return await readRoomView(store, url);
  } catch (err) {
    if (err instanceof RdfFetchError && (err.status === 401 || err.status === 403)) {
      throw err;
    }
    return undefined;
  }
}

/**
 * Read one message resource into a {@link MessageView}, or `undefined` when it
 * holds no `as:Note` (e.g. a dangling `as:items` ref). Propagates a
 * `RdfFetchError` on a real failure.
 */
async function readMessageView(store: ChatStore, url: string): Promise<MessageView | undefined> {
  const stored = await store.readMessage(url);
  if (stored === undefined) return undefined;
  const { data } = stored;
  return {
    url,
    content: data.content.length > 0 ? data.content : undefined,
    author: data.author,
    published: data.published !== undefined ? new Date(data.published) : undefined,
    task: data.task
      ? { state: data.task.state, title: data.task.title, assignee: data.task.assignee }
      : undefined,
  };
}

/**
 * React state for browsing a pod's chat rooms and reading one room's thread.
 *
 * The room list loads on mount, on refresh, and whenever the `podRoot`/`webId`/
 * `fetch` inputs change — a new pod resets the open room + listing + every
 * loading flag rather than stranding the view. The open room's thread loads
 * when a room is opened, on refresh, and resets when the room list reloads.
 *
 * Both loads carry a request-id guard so a slow earlier request can never
 * overwrite a newer one (the classic stale race) — late resolves AND late
 * rejects from a superseded request are discarded.
 *
 * All reads go through `ChatStore`, so the scope guard, WAC handling and the
 * typed model come for free.
 */
export function useChat(podRoot: string, webId: string, options: UseChatOptions = {}): ChatState {
  const { fetch: authedFetch } = options;

  const [rooms, setRooms] = useState<RoomView[]>([]);
  const [loadingRooms, setLoadingRooms] = useState(false);
  const [roomsError, setRoomsError] = useState<string | null>(null);
  const [roomsAccessError, setRoomsAccessError] = useState(false);
  const [roomsReloadToken, setRoomsReloadToken] = useState(0);

  const [openRoomUrl, setOpenRoomUrl] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageView[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [messagesError, setMessagesError] = useState<string | null>(null);
  const [messagesAccessError, setMessagesAccessError] = useState(false);
  const [messagesReloadToken, setMessagesReloadToken] = useState(0);

  const [sendStatus, setSendStatus] = useState<SendStatus>("idle");
  const [sendError, setSendError] = useState<string | null>(null);
  const [sendAccessError, setSendAccessError] = useState(false);

  // Staleness guards: a bumped id marks any older in-flight response as stale.
  const roomsRequestIdRef = useRef(0);
  const messagesRequestIdRef = useRef(0);
  // The currently-open room, mirrored into a ref so an async send can tell
  // whether the user has since switched/closed the room (and skip mutating a
  // thread that no longer belongs to that room).
  const openRoomUrlRef = useRef<string | null>(openRoomUrl);
  openRoomUrlRef.current = openRoomUrl;
  // A bumped id marks any in-flight send as stale (e.g. the room changed), so a
  // late resolve/reject can't write a status/thread for a room left behind.
  const sendRequestIdRef = useRef(0);
  // SINGLE-FLIGHT guard. Set SYNCHRONOUSLY at the top of a send and cleared in a
  // `finally`, so a second send() called while one is still saving is a no-op
  // (returns false) — it never adds a second optimistic row. This closes a race
  // the requestId guard alone could not: starting send #2 bumps the id, so when
  // send #1 resolved it took the superseded early-return and NEVER reconciled its
  // optimistic row, stranding a permanent "Saving…" message in the thread. The
  // Send button is disabled while saving, but a programmatic/fast double-call can
  // still race the async state update; this synchronous ref forecloses it.
  const sendInFlightRef = useRef(false);

  // Tracks the (podRoot, webId, fetch) the current state belongs to, kept in
  // STATE (not a ref) so the input-change reset is concurrent-rendering safe: a
  // ref written during render can leak from an ABANDONED render, stranding the
  // view on the previous pod. State set during render is applied by React only
  // when the render commits, so the comparison below is always against the
  // committed value.
  const [prevKey, setPrevKey] = useState({ podRoot, webId, authedFetch });

  // Reset EVERYTHING (incl. every loading flag) DURING render when the pod input
  // changes (React's documented "adjusting state when a prop changes" pattern —
  // applies in the same commit, so the view never flashes the previous pod). The
  // load effect below then GETs the new pod's room list. The mount case is
  // excluded because `prevKey` is seeded with the initial inputs.
  if (
    prevKey.podRoot !== podRoot ||
    prevKey.webId !== webId ||
    prevKey.authedFetch !== authedFetch
  ) {
    setPrevKey({ podRoot, webId, authedFetch });
    setRooms([]);
    setLoadingRooms(false);
    setRoomsError(null);
    setRoomsAccessError(false);
    setOpenRoomUrl(null);
    setMessages([]);
    setLoadingMessages(false);
    setMessagesError(null);
    setMessagesAccessError(false);
    setSendStatus("idle");
    setSendError(null);
    setSendAccessError(false);
  }

  // --- Room list load --------------------------------------------------------
  // `roomsReloadToken` is a deliberate re-fetch TRIGGER (bumped by
  // refreshRooms()): not read in the body, but its change must re-run the effect
  // to GET the room list again.
  // biome-ignore lint/correctness/useExhaustiveDependencies: roomsReloadToken is an intentional refetch trigger
  useEffect(() => {
    const requestId = ++roomsRequestIdRef.current;
    setLoadingRooms(true);
    setRoomsError(null);
    setRoomsAccessError(false);

    const store = createChatStore(
      authedFetch ? { podRoot, webId, fetchImpl: authedFetch } : { podRoot, webId },
    );

    // List via the room-list facade (NOT store.listRooms) so a 401/403 on the
    // rooms container surfaces as a typed RoomsAccessError → the access-denied
    // state, instead of the store's swallow-to-empty (which would show a
    // misleading "No rooms."). A 404 / empty container still maps to an empty
    // list. The per-room descriptor reads below still go through the store.
    listRoomsOrAccessError(store.roomsContainer, authedFetch ? { fetch: authedFetch } : {})
      .then(async (entries) => {
        // Read each room descriptor for its name/metadata. A descriptor that no
        // longer parses to a room (deleted between list + read, or not a room)
        // OR that fails a non-access read (404/500/network) is DROPPED, so a
        // single bad row never blanks the whole list. An ACCESS failure
        // (401/403) re-throws so a genuine auth wall still surfaces as an error.
        const views = await Promise.all(entries.map((e) => readRoomViewResilient(store, e.url)));
        if (requestId !== roomsRequestIdRef.current) return; // superseded
        const present = views.filter((v): v is RoomView => v !== undefined);
        present.sort((a, b) => formatLabel(a).localeCompare(formatLabel(b)));
        setRooms(present);
        setLoadingRooms(false);
      })
      .catch((err: unknown) => {
        if (requestId !== roomsRequestIdRef.current) return; // superseded
        const { message, isAccess } = describeError(err);
        // Clear any PREVIOUSLY-loaded list (and the open room) so a reload that
        // now fails — e.g. permission lost, or switched to a pod we can't read —
        // shows the error/access-denied state with NO stale rooms rendered
        // beneath it. The requestId guard above already ensures a concurrent
        // newer load isn't clobbered: a superseded reject returns before here.
        setRooms([]);
        setOpenRoomUrl(null);
        setRoomsError(message);
        setRoomsAccessError(isAccess);
        setLoadingRooms(false);
      });

    return () => {
      // Mark any in-flight response stale; the data layer's fetch is not
      // abortable through ChatStore, so staleness is enforced by the requestId
      // check rather than an AbortController.
      roomsRequestIdRef.current++;
    };
  }, [podRoot, webId, authedFetch, roomsReloadToken]);

  // --- Open room's message thread load ---------------------------------------
  // `messagesReloadToken` is a deliberate re-fetch TRIGGER (bumped by
  // refreshMessages()).
  // biome-ignore lint/correctness/useExhaustiveDependencies: messagesReloadToken is an intentional refetch trigger
  useEffect(() => {
    // Opening / switching / closing a room clears any leftover composer cue from
    // the previous room so a "Saved"/"failed" indicator never bleeds across rooms,
    // and marks any in-flight send for the previous room as stale.
    sendRequestIdRef.current++;
    setSendStatus("idle");
    setSendError(null);
    setSendAccessError(false);

    // No open room → nothing to load; clear the thread + its loading flag.
    if (openRoomUrl === null) {
      messagesRequestIdRef.current++;
      setMessages([]);
      setLoadingMessages(false);
      setMessagesError(null);
      setMessagesAccessError(false);
      return;
    }

    const requestId = ++messagesRequestIdRef.current;
    setLoadingMessages(true);
    setMessagesError(null);
    setMessagesAccessError(false);

    const store = createChatStore(
      authedFetch ? { podRoot, webId, fetchImpl: authedFetch } : { podRoot, webId },
    );

    // The room descriptor's forward index (`as:items`) is the source of message
    // URLs — read the room ONCE, then point-read each referenced message.
    store
      .readRoom(openRoomUrl)
      .then(async (stored) => {
        if (requestId !== messagesRequestIdRef.current) return; // superseded
        if (stored === undefined) {
          // The open room vanished (deleted / no longer a room). Surface an
          // empty thread rather than an error so the view shows "no messages".
          setMessages([]);
          setLoadingMessages(false);
          return;
        }
        const refs = [...stored.data.messages].sort((a, b) => a.localeCompare(b));
        const views = await Promise.all(refs.map((url) => readMessageView(store, url)));
        if (requestId !== messagesRequestIdRef.current) return; // superseded
        const present = views.filter((v): v is MessageView => v !== undefined);
        setMessages(chronological(present));
        setLoadingMessages(false);
      })
      .catch((err: unknown) => {
        if (requestId !== messagesRequestIdRef.current) return; // superseded
        const { message, isAccess } = describeError(err);
        setMessagesError(message);
        setMessagesAccessError(isAccess);
        setLoadingMessages(false);
      });

    return () => {
      messagesRequestIdRef.current++;
    };
  }, [openRoomUrl, podRoot, webId, authedFetch, messagesReloadToken]);

  const open = useCallback((url: string) => {
    setOpenRoomUrl(url);
  }, []);

  const back = useCallback(() => {
    setOpenRoomUrl(null);
  }, []);

  const refreshRooms = useCallback(() => {
    setRoomsReloadToken((n) => n + 1);
  }, []);

  const refreshMessages = useCallback(() => {
    setMessagesReloadToken((n) => n + 1);
  }, []);

  // Post a message to the open room with the OPTIMISTIC-MUTATION pattern: the new
  // message appears immediately (a `pending` MessageView), the pod write runs
  // async with a Saving→Saved cue, and on failure the optimistic message is
  // REMOVED (reverted) and the error surfaced. The body is stored as a PLAIN
  // literal (the data layer's typed `as:content` accessor — no markup execution),
  // and the write is scoped to the room's own message container by ChatStore.
  const send = useCallback(
    async (content: string): Promise<boolean> => {
      const roomUrl = openRoomUrlRef.current;
      // No open room, or an empty / whitespace-only body → a no-op (no write, no
      // optimistic row, no status change). Checked BEFORE the single-flight latch
      // so a no-op send never blocks a subsequent real one.
      if (roomUrl === null || content.trim().length === 0) return false;

      // SINGLE-FLIGHT: if a send is already saving, this overlapping call is a
      // no-op — return false WITHOUT adding a second optimistic row. (See
      // sendInFlightRef.) The latch is synchronous, so it wins the race even when
      // the `saving` status / disabled button hasn't propagated to the DOM yet.
      if (sendInFlightRef.current) return false;
      sendInFlightRef.current = true;

      const requestId = ++sendRequestIdRef.current;
      // A client-only key for the optimistic row, replaced by the real URL on
      // success and removed on failure. The `pod-chat:pending:` scheme is never a
      // real resource URL, so it can't collide with a persisted message key.
      const optimisticUrl = `pod-chat:pending:${requestId}`;
      const now = new Date();
      const optimistic: MessageView = {
        url: optimisticUrl,
        content,
        author: webId,
        published: now,
        task: undefined,
        pending: true,
      };

      // Show it immediately + flag "Saving…".
      setMessages((prev) => chronological([...prev, optimistic]));
      setSendStatus("saving");
      setSendError(null);
      setSendAccessError(false);

      const store = createChatStore(
        authedFetch ? { podRoot, webId, fetchImpl: authedFetch } : { podRoot, webId },
      );

      try {
        // 1) Create the message resource (well-formed AS2 as:Note; author + room
        //    link + dateSent), then 2) append its ref to the room's as:items
        //    index. The room is RE-READ first for a fresh ETag + its current
        //    refs, so the append is conditional and never clobbers a concurrent
        //    edit. Both writes go through the scope-guarded ChatStore.
        const { url } = await store.postMessage({
          content,
          author: webId,
          room: roomUrl,
          published: now,
        });
        const room = await store.readRoom(roomUrl);
        if (room === undefined) {
          throw new ResourceWriteError(roomUrl, 404);
        }
        await store.saveRoom(
          roomUrl,
          {
            name: room.data.name,
            creator: room.data.creator,
            participants: room.data.participants,
            messages: [...room.data.messages, url],
          },
          room.etag,
        );

        // The user switched/closed the room while the write was in flight (which
        // bumps sendRequestIdRef via the thread effect) — discard this stale
        // result rather than mutating a thread that no longer belongs to the room
        // we wrote to. (Overlapping sends can't reach here: the single-flight
        // latch makes a second send a no-op while this one is saving.)
        if (requestId !== sendRequestIdRef.current) return true;
        // Swap the optimistic row for the confirmed, persisted one (real URL, no
        // longer pending).
        setMessages((prev) =>
          chronological(
            prev.map((m) => (m.url === optimisticUrl ? { ...m, url, pending: false } : m)),
          ),
        );
        setSendStatus("saved");
        return true;
      } catch (err) {
        if (requestId !== sendRequestIdRef.current) return false;
        // REVERT: pull the optimistic message back out so the thread reflects the
        // true (un-persisted) state, then surface the failure.
        setMessages((prev) => prev.filter((m) => m.url !== optimisticUrl));
        const { message, isAccess } = describeError(err);
        setSendStatus("failed");
        setSendError(message);
        setSendAccessError(isAccess);
        return false;
      } finally {
        // Release the single-flight latch once this send has settled (resolved or
        // rejected), regardless of staleness, so the next send can proceed.
        sendInFlightRef.current = false;
      }
    },
    // openRoomUrlRef is a stable ref (read via `.current` for the live value), so
    // it is intentionally NOT a dependency — only the pod inputs rebind `send`.
    [podRoot, webId, authedFetch],
  );

  // The open room resolved from the current url against the current list. A url
  // no longer present (e.g. removed after a refresh) resolves to null, so the
  // view falls back to the list rather than a blank pane. Derived, not stored,
  // so it can never drift from `rooms`.
  const openRoom = useMemo(
    () => (openRoomUrl === null ? null : (rooms.find((r) => r.url === openRoomUrl) ?? null)),
    [rooms, openRoomUrl],
  );

  return {
    rooms,
    loadingRooms,
    roomsError,
    roomsAccessError,
    openRoomUrl,
    openRoom,
    messages,
    loadingMessages,
    messagesError,
    messagesAccessError,
    sendStatus,
    sendError,
    sendAccessError,
    open,
    back,
    refreshRooms,
    refreshMessages,
    send,
  };
}

/** The label a room sorts/lists by: its name, else the URL-derived fallback. */
function formatLabel(room: RoomView): string {
  return room.name !== undefined && room.name.length > 0 ? room.name : room.fallbackName;
}
