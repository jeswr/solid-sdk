// AUTHORED-BY Codex
"use client";
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  DropdownMenuItem,
  DropdownMenuSeparator,
  FileTypeIcon,
  IconButton,
  Input,
  Skeleton,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  toast,
} from "@jeswr/suite-ui";
import { Plus, RefreshCw, Star } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { SuiteFrame } from "@/components/interim-shell/suite-frame";
import { encodeRef } from "@/lib/refs";
import type { PodSession } from "@/lib/session/pod-session";
import { copyDocument } from "../editor/copy";
import { type LocalDraft, listLocalDrafts } from "../editor/drafts";
import { downloadDocument, rowExportJson } from "../editor/export-document";
import { importDocument } from "../editor/import-document";
import { useDialogFocus } from "../hooks/use-dialog-focus";
import { useDocsStore } from "../hooks/use-docs-store";
import { useStarred } from "../hooks/use-starred";
import type { DocumentEntry } from "../lib/model";
import { ActionsMenu } from "./actions-menu";
import { DocsError, DocsSidebar } from "./common";
import { DeleteDialog } from "./delete-dialog";
import { DownloadMenu } from "./download-menu";
import { ImportDialog } from "./import-dialog";
import { ModifiedTime } from "./modified-time";
import { trashDocumentWithUndo } from "./trash-actions";
export function DocumentList({ session }: { session: PodSession }) {
  const listRef = useRef<HTMLDivElement>(null);
  const refreshRef = useRef<HTMLButtonElement>(null);
  const dialogRowIndex = useRef(0);
  const focusFallback = () => {
    const controls = listRef.current?.querySelectorAll<HTMLButtonElement>(
      ".docs-row-actions button[aria-label]",
    );
    return controls?.[Math.min(dialogRowIndex.current, controls.length - 1)] ?? refreshRef.current;
  };
  const renameFocus = useDialogFocus(focusFallback);
  const store = useDocsStore(session);
  useEffect(() => {
    document.title = "Documents · Docs · Solid Suite";
  }, []);
  const router = useRouter();
  const params = useSearchParams();
  const filter = params.get("filter") ?? "all";
  const query = params.get("q") ?? "";
  const { starred, toggle } = useStarred();
  const [entries, setEntries] = useState<DocumentEntry[] | null>(null);
  const [localDrafts, setLocalDrafts] = useState<{ webId: string; entries: LocalDraft[] } | null>(
    null,
  );
  const drafts = localDrafts?.webId === session.webId ? localDrafts.entries : [];
  const [error, setError] = useState(false);
  const [renaming, setRenaming] = useState<{ entry: DocumentEntry; title: string } | null>(null);
  const [deleting, setDeleting] = useState<DocumentEntry | null>(null);
  const [importing, setImporting] = useState(false);
  const [busy, setBusy] = useState(false);
  const loadGeneration = useRef(0);
  const reload = useCallback(async () => {
    const generation = ++loadGeneration.current;
    setError(false);
    try {
      const next = await store.list();
      if (generation === loadGeneration.current) setEntries(next);
    } catch {
      if (generation !== loadGeneration.current) return;
      setEntries(null);
      setError(true);
    }
  }, [store]);
  useEffect(() => {
    let active = true;
    void listLocalDrafts(session.webId).then(
      (local) => {
        if (active) setLocalDrafts({ webId: session.webId, entries: local });
      },
      () => {
        if (active) setLocalDrafts({ webId: session.webId, entries: [] });
      },
    );
    return () => {
      active = false;
    };
  }, [session.webId]);
  useEffect(() => {
    void reload();
    return () => {
      ++loadGeneration.current;
    };
  }, [reload]);
  const rows = entries
    ?.filter(
      (entry) =>
        (filter !== "starred" || starred.includes(entry.url)) &&
        entry.title.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
    )
    .sort((a, b) => (b.modified ?? "").localeCompare(a.modified ?? ""));
  const act = async (task: () => Promise<void>) => {
    setBusy(true);
    try {
      await task();
    } catch {
      toast.error("We couldn't complete that action. Please try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <SuiteFrame
      app="docs"
      sidebar={<DocsSidebar filter={filter} />}
      context={<h1 className="docs-list-title">Documents</h1>}
      search={{ placeholder: "Search documents", action: "/docs", scopeLabel: "Docs" }}
      actions={
        <IconButton
          ref={refreshRef}
          label="Refresh documents"
          variant="ghost"
          onClick={() => void reload()}
        >
          <RefreshCw aria-hidden="true" />
        </IconButton>
      }
    >
      <div className="docs-list" ref={listRef}>
        <div className="docs-list-heading">
          <div>
            <p className="docs-eyebrow">YOUR WORKSPACE</p>
            <h2>
              {filter === "starred"
                ? "Starred documents"
                : filter === "recent"
                  ? "Recent documents"
                  : "All documents"}
            </h2>
          </div>
          <div className="docs-list-create">
            <Button variant="outline" onClick={() => setImporting(true)}>
              Upload
            </Button>
            <Button asChild className="docs-desktop-new">
              <Link href="/docs/new">
                <Plus aria-hidden="true" />
                New document
              </Link>
            </Button>
          </div>
        </div>
        {drafts.length > 0 && (
          <aside aria-label="Unsaved documents on this device">
            <h2>Unsaved documents on this device</h2>
            <ul>
              {drafts.map((draft) => (
                <li key={draft.id}>
                  <Link href={`/docs/new?draft=${encodeURIComponent(draft.id)}`}>
                    Resume {draft.title}
                  </Link>
                </li>
              ))}
            </ul>
          </aside>
        )}
        {importing && (
          <ImportDialog
            close={() => setImporting(false)}
            run={async (file, progress) => {
              const result = await importDocument(file, session, progress);
              return {
                skipped: result.skipped,
                done: () => router.push(`/docs/d/${encodeRef(result.url)}`),
              };
            }}
          />
        )}
        {error ? (
          <DocsError title="We couldn't load your documents">
            <Button onClick={() => void reload()}>Retry</Button>
          </DocsError>
        ) : entries === null ? (
          <div
            role="status"
            aria-label="Loading documents"
            aria-busy="true"
            className="docs-list-skeleton"
          >
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i.toString()} className="h-11 w-full" />
            ))}
          </div>
        ) : !rows?.length ? (
          <div className="docs-empty">
            <FileTypeIcon
              contentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              size={48}
              decorative
            />
            <h2>
              {query || filter === "starred"
                ? "No documents match your filters"
                : "No documents yet"}
            </h2>
            <p>
              {query || filter === "starred"
                ? "Try another search or clear your filters."
                : "Create a document or upload a .docx or Markdown file."}
            </p>
            <Button asChild>
              <Link href={query || filter === "starred" ? "/docs" : "/docs/new"}>
                {query || filter === "starred" ? "Clear filters" : "New document"}
              </Link>
            </Button>
          </div>
        ) : (
          <table className="docs-table">
            <caption className="sr-only">Your documents</caption>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col" className="docs-owner">
                  Owner
                </th>
                <th scope="col" className="docs-modified">
                  Last modified
                </th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((entry) => (
                <tr key={entry.url}>
                  <td className="docs-name">
                    <Link href={`/docs/d/${encodeRef(entry.url)}`}>
                      <FileTypeIcon
                        contentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                        size={24}
                        decorative
                      />
                      <span>{entry.title || "Untitled document"}</span>
                      {starred.includes(entry.url) && <Star size={14} aria-label="Starred" />}
                      {entry.legacy && <Badge>Older location</Badge>}
                    </Link>
                  </td>
                  <td className="docs-owner">You</td>
                  <td className="docs-modified">
                    <ModifiedTime value={entry.modified} />
                  </td>
                  <td className="docs-row-actions">
                    <ActionsMenu label={`Actions for ${entry.title || "Untitled document"}`}>
                      {(choose) => (
                        <>
                          <DropdownMenuItem asChild>
                            <Link href={`/docs/d/${encodeRef(entry.url)}`}>Open</Link>
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            disabled={entry.readOnly}
                            onSelect={choose(() => {
                              dialogRowIndex.current = rows.findIndex(
                                (row) => row.url === entry.url,
                              );
                              setRenaming({ entry, title: entry.title });
                            })}
                          >
                            Rename
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => toggle(entry.url)}>
                            {starred.includes(entry.url) ? "Unstar" : "Star"}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            disabled={busy}
                            onSelect={() =>
                              void act(async () => {
                                const source = await store.read(entry.url);
                                if (!source) throw new Error("Missing document");
                                const copy = await copyDocument(store, source, session);
                                router.push(`/docs/d/${encodeRef(copy.url)}`);
                              })
                            }
                          >
                            Make a copy
                          </DropdownMenuItem>
                          <DownloadMenu
                            download={(format) =>
                              void act(async () => {
                                const json = await rowExportJson(entry.url, session);
                                const name = await downloadDocument(
                                  json,
                                  entry.title,
                                  format,
                                  session,
                                );
                                toast.success(`Downloaded ${name}`);
                              })
                            }
                            print={() => router.push(`/docs/d/${encodeRef(entry.url)}?print=1`)}
                          />
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            disabled={entry.readOnly}
                            variant="destructive"
                            onSelect={choose(() => {
                              dialogRowIndex.current = rows.findIndex(
                                (row) => row.url === entry.url,
                              );
                              setDeleting(entry);
                            })}
                          >
                            Move to trash
                          </DropdownMenuItem>
                        </>
                      )}
                    </ActionsMenu>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button asChild className="docs-fab" size="icon" aria-label="New document">
              <Link href="/docs/new">
                <Plus aria-hidden="true" />
              </Link>
            </Button>
          </TooltipTrigger>
          <TooltipContent>New document</TooltipContent>
        </Tooltip>
        <Dialog open={renaming !== null} onOpenChange={(open) => !open && setRenaming(null)}>
          <DialogContent {...renameFocus}>
            <DialogTitle>Rename document</DialogTitle>
            <DialogDescription>Choose a title for this document.</DialogDescription>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (!renaming) return;
                void act(async () => {
                  const stored = await store.read(renaming.entry.url);
                  if (stored)
                    await store.save(
                      stored,
                      { title: renaming.title },
                      {
                        regenerate: () => ({ body: stored.data.body, format: stored.data.format }),
                      },
                    );
                  await reload();
                  setRenaming((current) => (current === renaming ? null : current));
                });
              }}
            >
              <label htmlFor="rename-title">Document title</label>
              <Input
                id="rename-title"
                maxLength={200}
                value={renaming?.title ?? ""}
                onChange={(event) => {
                  const title = event.target.value;
                  setRenaming((current) => current && { ...current, title });
                }}
              />
              <DialogFooter>
                <Button type="submit" disabled={busy}>
                  Save title
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
        <DeleteDialog
          open={deleting !== null}
          busy={busy}
          focusFallback={focusFallback}
          onOpenChange={(open) => !open && setDeleting(null)}
          onConfirm={() => {
            if (!deleting) return;
            void act(async () => {
              const complete = await trashDocumentWithUndo(deleting.url, session, reload);
              await reload();
              if (complete) {
                if (starred.includes(deleting.url)) toggle(deleting.url);
                setDeleting(null);
              }
            });
          }}
        />
      </div>
    </SuiteFrame>
  );
}
