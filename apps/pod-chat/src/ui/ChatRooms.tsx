// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// The Pod Chat primary VIEW — a chat rooms + messages browser over a Solid pod:
// a list of rooms (name, creator, created, counts), click a room to open its
// message thread (each message's author, time, body, and the actionable-task
// badge for messages that double as cross-app tasks), a "Back to rooms" control
// to return. RENDER-ONLY: there is no send/compose box (composing needs an
// authenticated, interactive session — a deliberate follow-up; see useChat.ts).
//
// This component is FRAMEWORK-AGNOSTIC React (no Next.js import, no "use client"
// pragma): it drops straight into the create-solid-app Next.js shell's
// `components/` or any React app. It renders only — it never touches RDF or
// fetch directly; all data flows through `useChat`, which calls the data layer.
// Styling is plain class names (`pod-chat-*`) so the host app's CSS owns the
// look; the component ships no styles of its own.
//
// SECURITY: chat content (room names, message bodies, author + assignee IRIs,
// task titles) is UNTRUSTED — a room/message can be authored by ANY participant
// and the task overlay can be set by a remote app. It is rendered ONLY as text
// (React escapes by default; there is NO dangerouslySetInnerHTML), and the sole
// attributes a value reaches — an author/assignee `href` — are gated by
// `safeHref` so a `javascript:`/`data:` IRI can never become an active link.
//
// AUTH SEAM: the `fetch` prop is the injected authenticated fetch, threaded to
// `useChat` → the data layer. See useChat.ts for the full note.

import { formatAuthor, formatBody, formatDate, formatRoomName, safeHref } from "./format.js";
import { type MessageView, type RoomView, useChat } from "./useChat.js";

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
    <li className="pod-chat-message">
      <div className="pod-chat-message-meta">
        <AgentRef className="pod-chat-author" value={message.author} />
        <time className="pod-chat-time">{formatDate(message.published)}</time>
        {message.task !== undefined ? <TaskBadge task={message.task} /> : null}
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

/** The read-only message thread for a single open room. */
function RoomThread({
  room,
  messages,
  loading,
  error,
  isAccessError,
  onBack,
  onRetry,
}: {
  room: RoomView | null;
  messages: MessageView[];
  loading: boolean;
  error: string | null;
  isAccessError: boolean;
  onBack: () => void;
  onRetry: () => void;
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
    open,
    back,
    refreshRooms,
    refreshMessages,
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
          onBack={back}
          onRetry={refreshMessages}
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
