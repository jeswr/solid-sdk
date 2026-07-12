// AUTHORED-BY Claude Opus 4.8
//
// The Pod Mail inbox VIEW — the primary view over a Solid mailbox document: a
// message list (read/unread, sender, subject, date), click a row to open the
// message in a read-only reading pane, a "Back to inbox" control to return.
//
// This component is FRAMEWORK-AGNOSTIC React (no Next.js import, no "use client"
// pragma): it drops straight into the create-solid-app Next.js shell's
// `components/` or any React app. It renders only — it never touches RDF or
// fetch directly; all data flows through `useInbox`, which calls the data
// layer. Styling is plain class names (`pod-mail-*`) so the host app's CSS owns
// the look; the component ships no styles of its own.
//
// SECURITY: message content (subject, sender, body, recipients) is UNTRUSTED —
// it may have been ingested from arbitrary external mail. It is rendered ONLY
// as text (React escapes by default; there is NO dangerouslySetInnerHTML), and
// the sole attribute a value reaches — a sender `href` — is gated by `safeHref`
// so a `javascript:`/`data:` sender can never become an active link.
//
// AUTH SEAM: the `fetch` prop is the injected authenticated fetch, threaded to
// `useInbox` → the data layer. See useInbox.ts for the full note.

import { formatDate, formatSender, formatSubject, safeHref } from "./format.js";
import { type MessageView, useInbox } from "./useInbox.js";

/** Props for {@link Inbox}. */
export interface InboxProps {
  /**
   * The mailbox DOCUMENT URL to read (e.g. `…/mail/folders/inbox.ttl`). Use the
   * data layer's `folderDocument(podRoot, WellKnownFolders.inbox)` to derive it.
   */
  mailboxUrl: string;
  /**
   * The authenticated fetch for pod reads. Omit to use the ambient global fetch
   * (patched by @solid/reactive-authentication in a real session). The
   * injectable auth seam — unit tests pass a stub here.
   */
  fetch?: typeof fetch;
  /** Optional heading rendered above the inbox. */
  title?: string;
}

/** A recipient list, rendered as plain text (recipients are untrusted IRIs). */
function Recipients({ label, values }: { label: string; values: string[] }) {
  if (values.length === 0) {
    return null;
  }
  return (
    <p className="pod-mail-recipients">
      <span className="pod-mail-recipients-label">{label}:</span> {values.join(", ")}
    </p>
  );
}

/** A sender rendered as a safe link when it is an http(s)/mailto IRI, else text. */
function Sender({ sender }: { sender: string | undefined }) {
  const text = formatSender(sender);
  const href = safeHref(sender);
  if (href === undefined) {
    return <span className="pod-mail-sender">{text}</span>;
  }
  return (
    <a className="pod-mail-sender" href={href} target="_blank" rel="noopener noreferrer">
      {text}
    </a>
  );
}

/** The read-only reading pane for a single open message. */
function MessageReader({ message, onBack }: { message: MessageView; onBack: () => void }) {
  return (
    <article className="pod-mail-reader" aria-label="Message">
      <button type="button" className="pod-mail-back" onClick={onBack}>
        ← Back to inbox
      </button>
      <h3 className="pod-mail-subject">{formatSubject(message.subject)}</h3>
      <div className="pod-mail-headers">
        <p className="pod-mail-from">
          <span className="pod-mail-from-label">From:</span> <Sender sender={message.sender} />
        </p>
        <Recipients label="To" values={message.to} />
        <Recipients label="Cc" values={message.cc} />
        <p className="pod-mail-date">
          <span className="pod-mail-date-label">Date:</span> {formatDate(message.date)}
        </p>
      </div>
      {/* Body is plain text; <pre> preserves its line breaks and React escapes
          it, so embedded markup is shown literally rather than rendered. */}
      <pre className="pod-mail-body">{message.body ?? ""}</pre>
    </article>
  );
}

/**
 * Render a Solid mailbox document as an inbox: a list of messages, each row a
 * button that opens the message for read-only viewing.
 */
export function Inbox({ mailboxUrl, fetch, title }: InboxProps) {
  const { messages, loading, error, isAccessError, selected, select, back, refresh } = useInbox(
    mailboxUrl,
    fetch ? { fetch } : {},
  );

  return (
    <section className="pod-mail-inbox" aria-label={title ?? "Inbox"}>
      {title ? <h2 className="pod-mail-title">{title}</h2> : null}

      {loading ? (
        <p className="pod-mail-loading" role="status">
          Loading…
        </p>
      ) : null}

      {error ? (
        <div className="pod-mail-error" role="alert">
          <p>{error}</p>
          {!isAccessError ? (
            <button type="button" onClick={refresh}>
              Retry
            </button>
          ) : null}
        </div>
      ) : null}

      {!loading && !error && selected !== null ? (
        <MessageReader message={selected} onBack={back} />
      ) : null}

      {!loading && !error && selected === null && messages.length === 0 ? (
        <p className="pod-mail-empty">No messages.</p>
      ) : null}

      {!error && selected === null && messages.length > 0 ? (
        <table className="pod-mail-table">
          <thead>
            <tr>
              <th scope="col">
                <span className="pod-mail-sr-only">Status</span>
              </th>
              <th scope="col">From</th>
              <th scope="col">Subject</th>
              <th scope="col">Date</th>
            </tr>
          </thead>
          <tbody>
            {messages.map((message) => (
              <tr
                key={message.id}
                className={message.isRead ? "pod-mail-row-read" : "pod-mail-row-unread"}
              >
                <td className="pod-mail-status">
                  <span aria-hidden="true">{message.isRead ? "" : "●"}</span>
                  <span className="pod-mail-sr-only">{message.isRead ? "Read" : "Unread"}</span>
                </td>
                <td className="pod-mail-cell-from">{formatSender(message.sender)}</td>
                <td className="pod-mail-cell-subject">
                  <button
                    type="button"
                    className="pod-mail-open"
                    onClick={() => select(message.id)}
                  >
                    {formatSubject(message.subject)}
                  </button>
                </td>
                <td className="pod-mail-cell-date">{formatDate(message.date)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </section>
  );
}
