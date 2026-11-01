// AUTHORED-BY Claude Opus 5.5
"use client";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
  Button,
  ErrorState,
  LoadingSkeleton,
  renderAsync,
} from "@jeswr/suite-ui";
import { RotateCcw, Trash2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { Snapshot } from "../lib/model";
import { TRASH_RETENTION_DAYS, type TrashData } from "../lib/model/trash";
import { useAddressBook, useContactMutations, useGroups } from "../state/contacts-context";
import { projectContact } from "../state/data";
import { ContactAvatar } from "./contacts-list";

type Item = Snapshot<TrashData>;
type Confirm = { kind: "one"; item: Item } | { kind: "all"; count: number };
const dateFormat = new Intl.DateTimeFormat("en", { dateStyle: "medium" });

function displayName(item: Item) {
  return projectContact({ ...item, url: item.data.original, data: item.data.contact }).displayName;
}

/** `/contacts/trash`: restore, delete for ever, or empty the app-managed trash. */
export function ContactTrash() {
  const state = useAddressBook();
  const groups = useGroups();
  const mutations = useContactMutations();
  const items = state.data.trash;
  const [confirm, setConfirm] = useState<Confirm>();
  const [announcement, setAnnouncement] = useState("");
  const restoreButtons = useRef(new Map<string, HTMLButtonElement>());
  const emptyHeading = useRef<HTMLHeadingElement>(null);
  // After an item leaves the list, focus the item now in its place (or the previous one, or
  // the empty state) once the list has re-rendered and any confirmation has closed.
  const pendingFocus = useRef<number | null>(null);
  const closing = useRef(false);
  // The dialog has no Radix trigger, so return focus to the button that opened it.
  const opener = useRef<HTMLElement | null>(null);
  const ask = (next: Confirm, element: HTMLElement) => {
    opener.current = element;
    setConfirm(next);
  };
  const latest = useRef(items);
  latest.current = items;
  const applyFocus = () => {
    const index = pendingFocus.current;
    if (index === null) return;
    pendingFocus.current = null;
    const next = latest.current[Math.min(index, latest.current.length - 1)];
    (next ? restoreButtons.current.get(next.url) : emptyHeading.current)?.focus();
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: Rows register on commit, so retry whenever the list re-renders.
  useEffect(() => {
    if (!confirm && !closing.current) applyFocus();
  }, [items, confirm]);
  const labelNames = (item: Item) =>
    groups
      .filter((group) => item.data.labels.includes(`${group.url}#this`))
      .map((group) => group.data.name);
  const name = (item: Item) => displayName(item) ?? "Unnamed contact";
  const restore = (item: Item, index: number) => {
    pendingFocus.current = index;
    setAnnouncement(`${name(item)} restored to your contacts.`);
    void mutations.restoreTrash(item.url).catch(() => setAnnouncement(""));
  };
  const deleteForever = (item: Item) => {
    pendingFocus.current = items.indexOf(item);
    closing.current = true;
    setAnnouncement(`${name(item)} deleted for ever.`);
    void mutations.purge([item.url]).catch(() => setAnnouncement(""));
  };
  const empty = () => {
    pendingFocus.current = 0;
    closing.current = true;
    setAnnouncement("Trash emptied.");
    void mutations.emptyTrash().catch(() => setAnnouncement(""));
  };
  const count = items.length;
  return (
    <section className="con-trash" aria-labelledby="con-trash-heading">
      <div className="con-list-heading">
        <h1 id="con-trash-heading">Trash</h1>
        {state.status === "ready" && state.book && (
          <span className="con-trash-count">{count === 1 ? "1 contact" : `${count} contacts`}</span>
        )}
        {state.status === "ready" && count > 0 && (
          <Button
            className="con-trash-empty-action"
            variant="destructive"
            onClick={(event) => ask({ kind: "all", count }, event.currentTarget)}
          >
            <Trash2 size={16} aria-hidden="true" />
            Empty trash
          </Button>
        )}
      </div>
      <p className="con-trash-intro">
        Contacts in the trash are deleted for ever after {TRASH_RETENTION_DAYS} days.
      </p>
      <p className="con-trash-status" role="status" aria-live="polite">
        {announcement}
      </p>
      {state.status === "ready" && state.data.trashIncomplete && (
        <div className="con-dup-warning" role="alert">
          <p>Some contacts in the trash couldn't be loaded. They are kept.</p>
          <Button variant="outline" onClick={() => void state.retry()}>
            Try again
          </Button>
        </div>
      )}
      {renderAsync({
        loading: state.status === "loading" && (
          <LoadingSkeleton preset="table" label="Loading trash" />
        ),
        error: state.status === "error" && (
          <ErrorState error="unreachable" actions={{ retry: state.retry }} />
        ),
        empty: !count && (
          <div className="con-dup-empty">
            <div className="con-trash-icon" aria-hidden="true">
              <Trash2 size={32} />
            </div>
            <h2 ref={emptyHeading} tabIndex={-1}>
              Trash is empty
            </h2>
            <p>Deleted contacts stay here for {TRASH_RETENTION_DAYS} days.</p>
            <Button variant="outline" asChild>
              <Link href="/contacts">All contacts</Link>
            </Button>
          </div>
        ),
        children: () => (
          <ul className="con-trash-list" aria-labelledby="con-trash-heading">
            {items.map((item, index) => {
              const labels = labelNames(item);
              const title = name(item);
              const nameId = `con-trash-${index}`;
              return (
                <li key={item.url} className="con-trash-item" aria-labelledby={nameId}>
                  <ContactAvatar
                    contact={projectContact({
                      ...item,
                      url: item.data.original,
                      data: item.data.contact,
                    })}
                  />
                  <div className="con-person-text">
                    <h2 id={nameId} className="con-name">
                      {title}
                    </h2>
                    <p className="con-trash-meta">
                      Deleted{" "}
                      <time dateTime={item.data.deletedAt.toISOString()}>
                        {dateFormat.format(item.data.deletedAt)}
                      </time>
                      {labels.length ? ` · ${labels.join(", ")}` : ""}
                    </p>
                  </div>
                  <div className="con-trash-actions">
                    <Button
                      variant="outline"
                      ref={(element: HTMLButtonElement | null) => {
                        if (element) restoreButtons.current.set(item.url, element);
                        else restoreButtons.current.delete(item.url);
                      }}
                      onClick={() => restore(item, index)}
                    >
                      <RotateCcw size={16} aria-hidden="true" />
                      Restore<span className="sr-only"> {title}</span>
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={(event) => ask({ kind: "one", item }, event.currentTarget)}
                    >
                      Delete for ever<span className="sr-only"> {title}</span>
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        ),
      })}
      <AlertDialog
        open={confirm !== undefined}
        onOpenChange={(open) => {
          if (!open) setConfirm(undefined);
        }}
      >
        <AlertDialogContent
          onCloseAutoFocus={(event) => {
            // After a deletion the opener is gone: focus the item in its place instead.
            event.preventDefault();
            if (!closing.current) {
              opener.current?.focus();
              return;
            }
            closing.current = false;
            applyFocus();
          }}
        >
          <AlertDialogTitle>
            {confirm?.kind === "one" ? `Delete ${name(confirm.item)} for ever?` : "Empty trash?"}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {confirm?.kind === "one"
              ? "The contact is deleted permanently. This can't be undone."
              : `${confirm?.count === 1 ? "1 contact is" : `All ${confirm?.count ?? 0} contacts are`} deleted permanently. This can't be undone.`}
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (confirm?.kind === "one") deleteForever(confirm.item);
                else empty();
              }}
            >
              {confirm?.kind === "one" ? "Delete for ever" : "Empty trash"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
