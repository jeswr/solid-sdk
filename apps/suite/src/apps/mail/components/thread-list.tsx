// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { Button, IconButton, toast } from "@jeswr/suite-ui";
import { Archive, MailCheck, MailOpen, Paperclip, RefreshCw, Star } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { type KeyboardEvent, type MouseEvent, useRef, useState } from "react";
import { encodeRef } from "@/lib/refs";
import { fileChunks, mailErrorMessage, type ThreadRow } from "../lib/client";
import { useMail, useMailActions } from "../state/mail-context";
import { MailEmptyState } from "./async";

function dateLabel(date: Date) {
  const now = new Date();
  const locale = typeof document === "undefined" ? "en" : document.documentElement.lang || "en";
  if (date.toDateString() === now.toDateString())
    return new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(date);
  if (date.getFullYear() === now.getFullYear())
    return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" }).format(date);
  return new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}
export function NoMail({ title, inbox = false }: { title: string; inbox?: boolean }) {
  const { client, setAccount, invalidate } = useMail();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const sample = async () => {
    setBusy(true);
    try {
      const response = await fetch("/samples/sample-mailbox.mbox");
      if (!response.ok) throw new Error("Sample unavailable");
      const result = await client.importMailbox("sample", fileChunks(await response.blob()));
      if (result.failed) toast.error(`${result.failed} sample messages couldn't be imported`);
      setAccount("sample");
      invalidate();
      router.push("/mail/inbox");
    } catch (error) {
      toast.error(mailErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <MailEmptyState
        title={inbox ? "No mail yet" : `Nothing in ${title}`}
        body={
          inbox
            ? "Bring a mailbox export into your pod to start reading."
            : "Messages in this folder will appear here."
        }
        primaryAction={
          inbox && (
            <Button asChild>
              <Link href="/mail/import">Import a mailbox</Link>
            </Button>
          )
        }
        secondaryAction={
          inbox && (
            <Button variant="outline" disabled={busy} onClick={() => void sample()}>
              {busy ? "Importing sample…" : "Try a sample mailbox"}
            </Button>
          )
        }
      />
      {busy && (
        <p role="status" aria-live="polite">
          Importing the sample mailbox…
        </p>
      )}
    </>
  );
}
export function ThreadList({
  rows,
  title,
  next,
  loadMore,
  refresh,
}: {
  rows: ThreadRow[];
  title: string;
  next?: number | null;
  loadMore?: () => void;
  refresh: () => void;
}) {
  const actions = useMailActions();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [focused, setFocused] = useState<string>();
  const refs = useRef(new Map<string, HTMLTableRowElement>());
  const selectedRows = rows.filter((row) => selected.has(row.iri));
  const toggle = (iri: string) =>
    setSelected((old) => {
      const next = new Set(old);
      if (next.has(iri)) next.delete(iri);
      else next.add(iri);
      return next;
    });
  const href = (row: ThreadRow) =>
    `/mail/t/${encodeRef(row.iri)}?back=${encodeURIComponent(pathname + (params.toString() ? `?${params}` : ""))}`;
  const open = (row: ThreadRow, event?: MouseEvent) => {
    if (
      event &&
      (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0)
    )
      return;
    if (window.matchMedia("(min-width: 1024px)").matches) {
      event?.preventDefault();
      const query = new URLSearchParams(params);
      query.set("t", encodeRef(row.iri));
      router.push(`${pathname}?${query}`, { scroll: false });
    } else if (!event) router.push(href(row));
  };
  const keyDown = (event: KeyboardEvent<HTMLTableRowElement>, row: ThreadRow, index: number) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    // Preserve native activation of checkboxes, buttons and links with Enter/Space.
    if (event.target !== event.currentTarget && ["Enter", " "].includes(event.key)) return;
    const key = event.key;
    if (["ArrowDown", "ArrowUp", "j", "k", "Enter", "o", "x", "s", "e", "I", "U"].includes(key))
      event.preventDefault();
    if (["ArrowDown", "ArrowUp", "j", "k"].includes(key)) {
      const target =
        rows[
          Math.max(
            0,
            Math.min(rows.length - 1, index + (["ArrowDown", "j"].includes(key) ? 1 : -1)),
          )
        ];
      if (target) {
        setFocused(target.iri);
        refs.current.get(target.iri)?.focus();
      }
    }
    if (key === "Enter" || key === "o") open(row);
    if (key === "x") toggle(row.iri);
    if (key === "s") void actions.forRows([row], "star", !row.starred);
    if (key === "e") void actions.forRows(selectedRows.length ? selectedRows : [row], "archive");
    if (event.shiftKey && (key === "I" || key === "U"))
      void actions.forRows(selectedRows.length ? selectedRows : [row], "read", key === "I");
  };
  const active = rows.some((row) => row.iri === focused) ? focused : rows[0]?.iri;
  return (
    <div className="mail-list">
      <div className="mail-toolbar" role="toolbar" aria-label="Mail actions">
        <input
          type="checkbox"
          aria-label="Select all threads"
          checked={rows.length > 0 && selectedRows.length === rows.length}
          onChange={(event) =>
            setSelected(new Set(event.target.checked ? rows.map((row) => row.iri) : []))
          }
        />
        <IconButton
          label="Mark read"
          variant="ghost"
          disabled={!selectedRows.length}
          onClick={() => void actions.forRows(selectedRows, "read", true)}
        >
          <MailCheck size={18} aria-hidden="true" />
        </IconButton>
        <IconButton
          label="Mark unread"
          variant="ghost"
          disabled={!selectedRows.length}
          onClick={() => void actions.forRows(selectedRows, "read", false)}
        >
          <MailOpen size={18} aria-hidden="true" />
        </IconButton>
        <IconButton
          label="Archive"
          variant="ghost"
          disabled={!selectedRows.length}
          onClick={() => {
            void actions.forRows(selectedRows, "archive");
            setSelected(new Set());
          }}
        >
          <Archive size={18} aria-hidden="true" />
        </IconButton>
        <IconButton label="Refresh" variant="ghost" onClick={refresh}>
          <RefreshCw size={18} aria-hidden="true" />
        </IconButton>
        <span className="mail-muted">
          {selectedRows.length ? `${selectedRows.length} selected` : `${rows.length} threads`}
        </span>
      </div>
      <table
        // biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: A grid uses row keyboard navigation on the native table.
        role="grid"
        aria-label={`${title} threads`}
        aria-multiselectable="true"
        className="mail-grid"
      >
        <tbody>
          {rows.map((row, index) => (
            <tr
              key={row.iri}
              data-thread={row.iri}
              data-unread={row.unread}
              aria-label={row.subject}
              aria-selected={selected.has(row.iri)}
              tabIndex={row.iri === active ? 0 : -1}
              className="mail-row"
              ref={(node) => {
                if (node) refs.current.set(row.iri, node);
                else refs.current.delete(row.iri);
              }}
              onFocus={() => setFocused(row.iri)}
              onKeyDown={(event) => keyDown(event, row, index)}
            >
              <td className="mail-row-check">
                <input
                  type="checkbox"
                  tabIndex={row.iri === active ? 0 : -1}
                  aria-label={`Select ${row.subject}`}
                  checked={selected.has(row.iri)}
                  onChange={() => toggle(row.iri)}
                />
              </td>
              <td className="mail-row-star">
                <IconButton
                  tabIndex={row.iri === active ? 0 : -1}
                  label={row.starred ? "Unstar" : "Star"}
                  aria-pressed={row.starred}
                  variant="ghost"
                  onClick={() => void actions.forRows([row], "star", !row.starred)}
                >
                  <Star size={18} fill={row.starred ? "currentColor" : "none"} aria-hidden="true" />
                </IconButton>
              </td>
              <td className="mail-row-content">
                <div className="mail-row-people">
                  {row.participants.join(", ") || "Unknown sender"}
                  {row.count > 1 && <span className="mail-muted"> ({row.count})</span>}
                </div>
                <Link
                  className="mail-row-copy"
                  tabIndex={row.iri === active ? 0 : -1}
                  href={href(row)}
                  onClick={(event) => open(row, event)}
                >
                  <span className="mail-row-subject">{row.subject}</span>
                  {" — "}
                  <span className="mail-row-snippet">{row.snippet}</span>
                </Link>
              </td>
              <td className="mail-row-meta">
                <time dateTime={row.latest.toISOString()} title={row.latest.toLocaleString()}>
                  {dateLabel(row.latest)}
                </time>
                {row.hasAttachment && <Paperclip size={16} aria-label="Has attachment" />}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {next != null && (
        <Button variant="outline" className="mail-load-more" onClick={loadMore}>
          Load more
        </Button>
      )}
    </div>
  );
}
