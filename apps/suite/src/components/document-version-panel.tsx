// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { Button } from "@jeswr/suite-ui";
import type { ReactNode, Ref } from "react";

/** Shared presentation for the suite's Docs and Notes history adapters. */
export function DocumentVersionPanel({
  entries,
  selectedId,
  choose,
  close,
  closeLabel,
  listLabel,
  className,
  headingId,
  headingRef,
  heading,
  error,
  loading,
  restoreAction,
  preview,
  emptyMessage,
}: {
  entries: {
    id: string;
    created: string;
    label?: string | undefined;
    author?: string | undefined;
  }[];
  selectedId: string | undefined;
  choose: (id: string | undefined) => void;
  close: () => void;
  closeLabel: string;
  listLabel: string;
  className: string;
  headingId: string;
  headingRef?: Ref<HTMLHeadingElement>;
  heading?: ReactNode;
  error?: string | undefined;
  loading?: boolean;
  restoreAction?: ReactNode;
  preview?: ReactNode;
  emptyMessage?: string;
}) {
  return (
    <aside className={className} aria-labelledby={headingId}>
      {heading ?? (
        <h2 id={headingId} ref={headingRef} tabIndex={-1}>
          Version history
        </h2>
      )}
      <Button variant="ghost" onClick={close}>
        {closeLabel}
      </Button>
      {error && <p role="alert">{error}</p>}
      {loading && <p role="status">Loading versions…</p>}
      <ul aria-label={listLabel}>
        <li>
          <button
            type="button"
            aria-current={!selectedId ? "true" : undefined}
            onClick={() => choose(undefined)}
          >
            Current version
          </button>
        </li>
        {entries.map((entry) => (
          <li key={entry.id}>
            <button
              type="button"
              aria-current={selectedId === entry.id ? "true" : undefined}
              onClick={() => choose(entry.id)}
            >
              {entry.label && <span>{entry.label}</span>}
              <time dateTime={entry.created}>{new Date(entry.created).toLocaleString()}</time>
              <small>{entry.author || "Unknown author"}</small>
            </button>
          </li>
        ))}
      </ul>
      {!loading && !entries.length && emptyMessage && <p>{emptyMessage}</p>}
      {preview}
      {selectedId && restoreAction}
    </aside>
  );
}
