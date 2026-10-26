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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  FileTypeIcon,
  IconButton,
  Input,
  Skeleton,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  toast,
} from "@jeswr/suite-ui";
import { MoreHorizontal, Plus, RefreshCw, Star } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { SuiteFrame } from "@/components/interim-shell/suite-frame";
import { encodeRef } from "@/lib/refs";
import type { PodSession } from "@/lib/session/pod-session";
import { copyDocument } from "../editor/copy";
import { downloadDocument, rowExportJson } from "../editor/export-document";
import { importDocument } from "../editor/import-document";
import { deleteDocument } from "../editor/operations";
import { useDocsStore } from "../hooks/use-docs-store";
import { useStarred } from "../hooks/use-starred";
import { relativeTime } from "../lib/editor/logic";
import type { DocumentEntry } from "../lib/model";
import { DocsError, DocsSidebar } from "./common";
import { DeleteDialog } from "./delete-dialog";
import { DownloadMenu } from "./download-menu";
import { ImportDialog } from "./import-dialog";
export function DocumentList({ session }: { session: PodSession }) {
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
  const [error, setError] = useState(false);
  const [renaming, setRenaming] = useState<DocumentEntry | null>(null);
  const [title, setTitle] = useState("");
  const [deleting, setDeleting] = useState<DocumentEntry | null>(null);
  const [importing, setImporting] = useState(false);
  const [busy, setBusy] = useState(false);
  const reload = useCallback(async () => {
    setError(false);
    try {
      setEntries(await store.list());
    } catch {
      setEntries(null);
      setError(true);
    }
  }, [store]);
  useEffect(() => {
    void reload();
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
        <IconButton label="Refresh documents" variant="ghost" onClick={() => void reload()}>
          <RefreshCw aria-hidden="true" />
        </IconButton>
      }
    >
      <div className="docs-list">
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
                    <time
                      dateTime={entry.modified}
                      title={entry.modified ? new Date(entry.modified).toLocaleString() : "Unknown"}
                    >
                      {entry.modified ? relativeTime(Date.parse(entry.modified), Date.now()) : "—"}
                    </time>
                  </td>
                  <td className="docs-row-actions">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <IconButton
                          label={`Actions for ${entry.title || "Untitled document"}`}
                          variant="ghost"
                        >
                          <MoreHorizontal aria-hidden="true" />
                        </IconButton>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem asChild>
                          <Link href={`/docs/d/${encodeRef(entry.url)}`}>Open</Link>
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          disabled={entry.readOnly}
                          onSelect={() => {
                            setTitle(entry.title);
                            setRenaming(entry);
                          }}
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
                          onSelect={() => setDeleting(entry)}
                        >
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
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
          <DialogContent>
            <DialogTitle>Rename document</DialogTitle>
            <DialogDescription>Choose a title for this document.</DialogDescription>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (!renaming) return;
                void act(async () => {
                  const stored = await store.read(renaming.url);
                  if (stored)
                    await store.save(
                      stored,
                      { title },
                      {
                        regenerate: () => ({ body: stored.data.body, format: stored.data.format }),
                      },
                    );
                  setRenaming(null);
                  await reload();
                });
              }}
            >
              <label htmlFor="rename-title">Document title</label>
              <Input
                id="rename-title"
                maxLength={200}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
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
          onOpenChange={(open) => !open && setDeleting(null)}
          onConfirm={() => {
            if (!deleting) return;
            void act(async () => {
              await deleteDocument(deleting.url, session);
              if (starred.includes(deleting.url)) toggle(deleting.url);
              setDeleting(null);
              await reload();
            });
          }}
        />
      </div>
    </SuiteFrame>
  );
}
