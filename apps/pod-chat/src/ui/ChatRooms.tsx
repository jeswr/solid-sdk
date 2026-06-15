// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// The Pod Chat primary VIEW — a chat rooms + messages browser over a Solid pod:
// a list of rooms (name, creator, created, counts), click a room to open its
// message thread (each message's author, time, body, and the actionable-task
// badge for messages that double as cross-app tasks), a "Back to rooms" control
// to return, and a COMPOSER (a text input + Send) to post a new message to the
// open room.
//
// Posting uses the OPTIMISTIC-MUTATION pattern: the new message is shown
// immediately, the pod write runs async with a Saving→Saved cue, and on failure
// the optimistic message is reverted (removed) and the error surfaced. The auth
// for the write rides the same injected `fetch` seam as the reads (no hard-wired
// login flow — #18-gated; see useChat.ts).
//
// This component is FRAMEWORK-AGNOSTIC React (no Next.js import, no "use client"
// pragma): it drops straight into the create-solid-app Next.js shell's
// `components/` or any React app. It never touches RDF or fetch directly; all
// data flows through `useChat`, which calls the data layer. Styling is plain
// class names (`pod-chat-*`) so the host app's CSS owns the look; the component
// ships no styles of its own.
//
// SECURITY: chat content (room names, message bodies, author + assignee IRIs,
// task titles) is UNTRUSTED — a room/message can be authored by ANY participant
// and the task overlay can be set by a remote app. It is rendered ONLY as text
// (React escapes by default; there is NO dangerouslySetInnerHTML), and the sole
// attributes a value reaches — an author/assignee `href` — are gated by
// `safeHref` so a `javascript:`/`data:` IRI can never become an active link. On
// the WRITE side, a composed body is stored as a PLAIN literal via the data
// layer's typed `as:content` accessor (no markup execution), and the write is
// scoped to the room's own message container by ChatStore.
//
// AUTH SEAM: the `fetch` prop is the injected authenticated fetch, threaded to
// `useChat` → the data layer. See useChat.ts for the full note.

import { useState } from "react";
import { formatAuthor, formatBody, formatDate, formatRoomName, safeHref } from "./format.js";
import { type MessageView, type RoomView, type SendStatus, useChat } from "./useChat.js";

/** Props for {@link ChatRooms}. */
export interface ChatRoomsProps {
  /**
   * The pod root the chat data lives under (e.g. `https://alice.pod/`). The data
   * layer derives the `pod-chat/rooms/` + `pod-chat/messages/` containers from
   * it.
   */
  podRoot: string;
  /** The WebID of the active user — used by the data layer's type-index reads. */
  webId: string;
  /**
   * The authenticated fetch for pod reads. Omit to use the ambient global fetch
   * (patched by @solid/reactive-authentication in a real session). The
   * injectable auth seam — unit tests pass a stub here.
   */
  fetch?: typeof fetch;
  /** Optional heading rendered above the view. */
  title?: string;
}

/** An author/assignee rendered as a safe link for an http(s)/mailto IRI, else text. */
function AgentRef({ className, value }: { className: string; value: string | undefined }) {
  const text = formatAuthor(value);
  const href = safeHref(value);
  if (href === undefined) {
    return <span className={className}>{text}</span>;
  }
  return (
    <a className={className} href={href} target="_blank" rel="noopener noreferrer">
      {text}
    </a>
  );
}

/** The actionable-task badge for a message that also tracks a cross-app task. */
function TaskBadge({ task }: { task: NonNullable<MessageView["task"]> }) {
  return (
    <span
      className={task.state === "closed" ? "pod-chat-task-closed" : "pod-chat-task-open"}
      data-task-state={task.state}
    >
      <span aria-hidden="true">{task.state === "closed" ? "☑" : "☐"}</span> Task
      {task.title !== undefined && task.title.length > 0 ? `: ${task.title}` : ""}
    </span>
  );
}

/** A single message in the open room's thread. */
function Message({ message }: { message: MessageView }) {
  return (
    <li
      className={message.pending ? "pod-chat-message pod-chat-message-pending" : "pod-chat-message"}
      aria-busy={message.pending ? "true" : undefined}
      data-pending={message.pending ? "true" : undefined}
    >
      <div className="pod-chat-message-meta">
        <AgentRef className="pod-chat-author" value={message.author} />
        <time className="pod-chat-time">{formatDate(message.published)}</time>
        {message.task !== undefined ? <TaskBadge task={message.task} /> : null}
        {message.pending ? <span className="pod-chat-message-sending">Sending…</span> : null}
      </div>
      {message.task?.assignee !== undefined ? (
        <p className="pod-chat-assignee">
          <span className="pod-chat-assignee-label">Assigned to:</span>{" "}
          <AgentRef className="pod-chat-assignee-ref" value={message.task.assignee} />
        </p>
      ) : null}
      {/* Body is plain text; <pre> preserves its line breaks and React escapes
          it, so embedded markup is shown literally rather than rendered. */}
      <pre className="pod-chat-body">{formatBody(message.content)}</pre>
    </li>
  );
}

/** The persistence cue shown next to the composer for the most recent send. */
function SendIndicator({ status }: { status: SendStatus }) {
  if (status === "saving") {
    return (
      <span className="pod-chat-send-status" data-send-status="saving" role="status">
        Saving…
      </span>
    );
  }
  if (status === "saved") {
    return (
      <span className="pod-chat-send-status" data-send-status="saved" role="status">
        Saved
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span className="pod-chat-send-status" data-send-status="failed">
        Couldn't send
      </span>
    );
  }
  return null;
}

/**
 * The message composer for the open room: a text input + Send. Submitting posts
 * the body to the room (author = the session WebID, dateSent = now) via the
 * hook's optimistic `send`. The input is cleared on a successful send and kept
 * (so the text isn't lost) when the send fails. An empty/whitespace body is a
 * no-op — the Send button is disabled until there is something to send and while
 * a send is in flight.
 */
function Composer({
  status,
  error,
  onSend,
}: {
  status: SendStatus;
  error: string | null;
  onSend: (content: string) => Promise<boolean>;
}) {
  const [text, setText] = useState("");
  const saving = status === "saving";
  const canSend = text.trim().length > 0 && !saving;

  const submit = async () => {
    if (!canSend) return;
    const ok = await onSend(text);
    // Clear on success; KEEP the text on failure so the user can retry without
    // retyping. The optimistic message has already been reverted by the hook.
    if (ok) setText("");
  };

  return (
    <form
      className="pod-chat-composer"
      aria-label="Send a message"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <label className="pod-chat-composer-label" htmlFor="pod-chat-composer-input">
        Message
      </label>
      <input
        id="pod-chat-composer-input"
        className="pod-chat-composer-input"
        type="text"
        value={text}
        placeholder="Write a message…"
        onChange={(e) => setText(e.target.value)}
      />
      <button type="submit" className="pod-chat-send" disabled={!canSend}>
        Send
      </button>
      <SendIndicator status={status} />
      {status === "failed" && error !== null ? (
        <p className="pod-chat-send-error" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}

/** The message thread + composer for a single open room. */
function RoomThread({
  room,
  messages,
  loading,
  error,
  isAccessError,
  sendStatus,
  sendError,
  onBack,
  onRetry,
  onSend,
}: {
  room: RoomView | null;
  messages: MessageView[];
  loading: boolean;
  error: string | null;
  isAccessError: boolean;
  sendStatus: SendStatus;
  sendError: string | null;
  onBack: () => void;
  onRetry: () => void;
  onSend: (content: string) => Promise<boolean>;
}) {
  // `room` is the open room resolved against the list; it is non-null whenever a
  // row was clicked (the row only exists for a listed room). The `null` arm is a
  // defensive fallback for a not-yet-resolvable open room — unreachable through
  // the view's own controls, so it is excluded from the coverage bar rather than
  // padded with a contrived test.
  /* v8 ignore next */
  const heading = room === null ? "Room" : formatRoomName(room.name, room.fallbackName);
  return (
    <section className="pod-chat-thread" aria-label="Room">
      <button type="button" className="pod-chat-back" onClick={onBack}>
        ← Back to rooms
      </button>
      <h3 className="pod-chat-room-name">{heading}</h3>

      {loading ? (
        <p className="pod-chat-loading" role="status">
          Loading…
        </p>
      ) : null}

      {error ? (
        <div className="pod-chat-error" role="alert">
          <p>{error}</p>
          {!isAccessError ? (
            <button type="button" onClick={onRetry}>
              Retry
            </button>
          ) : null}
        </div>
      ) : null}

      {!loading && !error && messages.length === 0 ? (
        <p className="pod-chat-empty">No messages.</p>
      ) : null}

      {!error && messages.length > 0 ? (
        <ol className="pod-chat-messages">
          {messages.map((message) => (
            <Message key={message.url} message={message} />
          ))}
        </ol>
      ) : null}

      {/* The composer is shown unless the thread is access-walled (can't read →
          composing is moot). A generic (retryable) thread error still allows
          composing — the body posts to its own resource independently. */}
      {!isAccessError ? <Composer status={sendStatus} error={sendError} onSend={onSend} /> : null}
    </section>
  );
}

/** A single row in the room list. */
function RoomRow({ room, onOpen }: { room: RoomView; onOpen: (url: string) => void }) {
  return (
    <tr className="pod-chat-room-row">
      <td className="pod-chat-cell-name">
        <button type="button" className="pod-chat-open" onClick={() => onOpen(room.url)}>
          {formatRoomName(room.name, room.fallbackName)}
        </button>
      </td>
      <td className="pod-chat-cell-creator">
        <AgentRef className="pod-chat-creator" value={room.creator} />
      </td>
      <td className="pod-chat-cell-created">{formatDate(room.created)}</td>
      <td className="pod-chat-cell-count">{room.messageCount}</td>
    </tr>
  );
}

/**
 * Render a pod's chat rooms as a list; click a room to read its message thread.
 */
export function ChatRooms({ podRoot, webId, fetch, title }: ChatRoomsProps) {
  const {
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
    open,
    back,
    refreshRooms,
    refreshMessages,
    send,
  } = useChat(podRoot, webId, fetch ? { fetch } : {});

  return (
    <section className="pod-chat" aria-label={title ?? "Chat"}>
      {title ? <h2 className="pod-chat-title">{title}</h2> : null}

      {openRoomUrl !== null ? (
        <RoomThread
          room={openRoom}
          messages={messages}
          loading={loadingMessages}
          error={messagesError}
          isAccessError={messagesAccessError}
          sendStatus={sendStatus}
          sendError={sendError}
          onBack={back}
          onRetry={refreshMessages}
          onSend={send}
        />
      ) : (
        <div className="pod-chat-rooms">
          {loadingRooms ? (
            <p className="pod-chat-loading" role="status">
              Loading…
            </p>
          ) : null}

          {roomsError ? (
            <div className="pod-chat-error" role="alert">
              <p>{roomsError}</p>
              {!roomsAccessError ? (
                <button type="button" onClick={refreshRooms}>
                  Retry
                </button>
              ) : null}
            </div>
          ) : null}

          {!loadingRooms && !roomsError && rooms.length === 0 ? (
            <p className="pod-chat-empty">No rooms.</p>
          ) : null}

          {!roomsError && rooms.length > 0 ? (
            <table className="pod-chat-table">
              <thead>
                <tr>
                  <th scope="col">Room</th>
                  <th scope="col">Creator</th>
                  <th scope="col">Created</th>
                  <th scope="col">Messages</th>
                </tr>
              </thead>
              <tbody>
                {rooms.map((room) => (
                  <RoomRow key={room.url} room={room} onOpen={open} />
                ))}
              </tbody>
            </table>
          ) : null}
        </div>
      )}
    </section>
  );
}
