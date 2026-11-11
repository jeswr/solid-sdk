// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
"use client";
import {
  Badge,
  Button,
  IconButton,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  toast,
} from "@jeswr/suite-ui";
import { Archive, ArrowLeft, MailOpen, Star, X } from "lucide-react";
import Link from "next/link";
import { useTheme } from "next-themes";
import { useEffect, useRef, useState } from "react";
import { encodeRef } from "@/lib/refs";
import { type MessageView, mailErrorMessage } from "../lib/client";
import { useFolders, useMail, useMailActions, useThread } from "../state/mail-context";
import { MailAsync } from "./async";
import { MailAttachment } from "./attachment";

/**
 * The raw .eml lives in the (access-controlled, cross-origin) pod, where a plain link would
 * carry no credentials and `download` is ignored. Fetch it through the pod-scoped transport
 * (which refuses URLs outside the storage) and save it from a blob URL.
 */
function OriginalDownload({ url }: { url: string }) {
  const { client } = useMail();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="mail-action-link"
      disabled={busy}
      onClick={() => {
        setBusy(true);
        void client
          .binaryFetch(url)
          .then(async (response) => {
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            // A fixed message type: the browser never renders sender-controlled content.
            const blob = new Blob([await response.arrayBuffer()], { type: "message/rfc822" });
            const href = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = href;
            link.download = decodeURIComponent(
              new URL(url).pathname.split("/").pop() || "message.eml",
            );
            document.body.append(link);
            link.click();
            link.remove();
            setTimeout(() => URL.revokeObjectURL(href), 1000);
          })
          .catch((error: unknown) => toast.error(mailErrorMessage(error)))
          .finally(() => setBusy(false));
      }}
    >
      Download the original message
    </button>
  );
}

function MessageCard({
  message,
  last,
  expandAll,
}: {
  message: MessageView;
  last: boolean;
  expandAll: boolean | undefined;
}) {
  const { resolvedTheme } = useTheme();
  const colorScheme = resolvedTheme === "dark" ? "dark" : "light";
  const [open, setOpen] = useState(last || !message.read);
  useEffect(() => {
    if (expandAll !== undefined) setOpen(expandAll);
  }, [expandAll]);
  const visible = open;
  const sender = /^(.*?)\s*<([^<>]+)>$/.exec(message.from);
  const name = sender ? sender[1]?.trim() : message.from;
  const initials = (name || message.from)
    .split(/[\s@.]+/)
    .slice(0, 2)
    .map((s) => s[0])
    .join("")
    .toUpperCase();
  return (
    <article className="mail-message">
      <button
        type="button"
        className="mail-message-header"
        aria-expanded={visible}
        onClick={() => setOpen(!visible)}
      >
        <span className="mail-avatar" aria-hidden="true">
          {initials}
        </span>
        <span className="mail-message-person">
          <span>
            {name && <strong>{name}</strong>}
            {sender && (
              <span className="mail-sender-address mail-muted">
                {name ? ` <${sender[2]}>` : sender[2]}
              </span>
            )}
          </span>
          <span className="mail-muted">
            To: {message.to.join(", ") || "Undisclosed recipients"}
            {message.cc.length > 0 && ` · Cc: ${message.cc.join(", ")}`}
          </span>
        </span>
        <time
          className="mail-muted"
          dateTime={message.date.toISOString()}
          title={message.date.toLocaleString()}
        >
          {new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
            message.date,
          )}
        </time>
      </button>
      {visible && (
        <div className="mail-message-content">
          {message.html !== undefined ? (
            <>
              <p className="mail-muted">Remote images hidden</p>
              {/* Empty sandbox deliberately forbids scripts AND same-origin access. Content cannot be measured safely, so the reader scrolls within a fixed-height frame. */}
              <iframe
                title={`Message from ${message.from}`}
                className="mail-html"
                sandbox=""
                referrerPolicy="no-referrer"
                srcDoc={`<!doctype html><html lang="en"><head><title>Mail message</title><meta name="color-scheme" content="${colorScheme}"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'none'; style-src 'none'; form-action 'none'; base-uri 'none'"></head><body>${message.html}</body></html>`}
              />
            </>
          ) : (
            <>
              <div className="mail-message-text">
                {message.quoted.segments
                  .filter((s) => s.kind === "body" || s.kind === "signature")
                  .map((s) => s.text)
                  .join("")}
              </div>
              {message.quoted.hasQuotedHistory && (
                <details className="mail-quotes">
                  <summary>Show quoted text</summary>
                  <blockquote>
                    {message.quoted.segments
                      .filter((s) => !["body", "signature"].includes(s.kind))
                      .map((s) => s.text)
                      .join("")}
                  </blockquote>
                </details>
              )}
            </>
          )}
          {message.draft && (
            <p className="mail-draft-note">
              <span className="mail-muted">Draft, not sent.</span>{" "}
              <Link
                className="mail-action-link"
                href={`/mail/compose?draft=${encodeRef(message.iri)}`}
              >
                Edit draft
              </Link>
            </p>
          )}
          {message.truncated && (
            <p className="mail-muted">
              This message is shown as a plain-text preview.{" "}
              {message.originalUrl && <OriginalDownload url={message.originalUrl} />}
            </p>
          )}
          {message.attachments.length > 0 && (
            <section className="mail-attachments" aria-label="Attachments">
              {message.attachments.map((a) => (
                <MailAttachment attachment={a} key={a.url} />
              ))}
            </section>
          )}
        </div>
      )}
    </article>
  );
}
export function ThreadView({
  iri,
  back = "/mail/inbox",
  headingLevel = 1,
}: {
  iri: string;
  back?: string;
  headingLevel?: 1 | 2;
}) {
  const Heading = headingLevel === 1 ? "h1" : "h2";
  const state = useThread(iri);
  const folders = useFolders();
  const { client, invalidate } = useMail();
  const actions = useMailActions();
  const opened = useRef<string | undefined>(undefined);
  const [expandAll, setExpandAll] = useState<boolean | undefined>(undefined);
  const unread = state.data?.messages.filter((m) => !m.read).map((m) => m.iri);
  const markRead = actions.markRead;
  useEffect(() => {
    if (!state.data || opened.current === iri) return;
    opened.current = iri;
    if (unread?.length) void markRead(unread, true, iri);
  }, [iri, state.data, unread, markRead]);
  return (
    <section className="mail-thread" aria-label="Conversation">
      <MailAsync state={state}>
        {(thread) => {
          const iris = thread.messages.map((m) => m.iri);
          const starred = thread.messages.some((m) => m.starred);
          const labels = [...new Set(thread.messages.flatMap((m) => m.labels))];
          const label = async (folderIri: string, on: boolean) => {
            try {
              for (const id of iris) await client.label(id, folderIri, on);
              invalidate();
            } catch (error) {
              toast.error(mailErrorMessage(error));
              invalidate();
            }
          };
          return (
            <>
              <div className="mail-actions">
                <Link className="mail-back" href={back}>
                  <ArrowLeft size={18} aria-hidden="true" />
                  Back
                </Link>
                <IconButton
                  label="Archive thread"
                  variant="ghost"
                  onClick={() => void actions.archive(iris, iri)}
                >
                  <Archive size={18} aria-hidden="true" />
                </IconButton>
                <IconButton
                  label="Mark unread"
                  variant="ghost"
                  onClick={() => void actions.markRead(iris, false, iri)}
                >
                  <MailOpen size={18} aria-hidden="true" />
                </IconButton>
                <IconButton
                  label={starred ? "Unstar thread" : "Star thread"}
                  variant="ghost"
                  aria-pressed={starred}
                  onClick={() => void actions.star(iris, !starred, iri)}
                >
                  <Star size={18} fill={starred ? "currentColor" : "none"} aria-hidden="true" />
                </IconButton>
              </div>
              <Heading>{thread.subject}</Heading>
              <div className="mail-chips">
                {labels.map((iri) => {
                  const folder = folders.data?.find((f) => f.iri === iri);
                  return (
                    folder && (
                      <Badge variant="secondary" className="mail-chip" key={iri}>
                        {folder.title}
                        {!folder.system && (
                          <IconButton
                            size="icon-sm"
                            label={`Remove ${folder.title} label`}
                            variant="ghost"
                            onClick={() => void label(iri, false)}
                          >
                            <X size={14} aria-hidden="true" />
                          </IconButton>
                        )}
                      </Badge>
                    )
                  );
                })}
                {folders.data?.some((f) => !f.system && !labels.includes(f.iri)) && (
                  <Select value="" onValueChange={(value) => void label(value, true)}>
                    <SelectTrigger aria-label="Add label">
                      <SelectValue placeholder="Add label" />
                    </SelectTrigger>
                    <SelectContent>
                      {folders.data
                        .filter((f) => !f.system && !labels.includes(f.iri))
                        .map((f) => (
                          <SelectItem key={f.iri} value={f.iri}>
                            {f.title}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
              <Button
                className="mail-expand"
                variant="ghost"
                size="sm"
                onClick={() => setExpandAll(!expandAll)}
              >
                {expandAll ? "Collapse messages" : "Expand all"}
              </Button>
              {thread.messages.map((m, i) => (
                <MessageCard
                  key={m.iri}
                  message={m}
                  last={i === thread.messages.length - 1}
                  expandAll={expandAll}
                />
              ))}
            </>
          );
        }}
      </MailAsync>
    </section>
  );
}
