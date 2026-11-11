// AUTHORED-BY Codex (GPT-6.1 Sol)
"use client";
import type { BookmarkData } from "@jeswr/solid-bookmark";
import { type NetscapeImport, serializeNetscapeBookmarks } from "@jeswr/solid-bookmark/netscape";
import {
  Badge,
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  ErrorState,
  IconButton,
  Input,
  Label,
  LoadingSkeleton,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
  toast,
} from "@jeswr/suite-ui";
import {
  Archive,
  ArchiveRestore,
  ArrowDownToLine,
  ArrowUpFromLine,
  Bookmark,
  Check,
  LayoutGrid,
  List,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Tag,
  Trash2,
} from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { saveNatively } from "@/lib/native/save-file";
import { PodSessionProvider, usePodSessionState } from "@/lib/session/pod-session";
import { AppFrame, AppHeading, AppSessionGuard } from "@/shell/app-frame";
import { useConnectionState } from "@/shell/sync/connection-state";
import {
  type BookmarkItem,
  type BookmarkSort,
  type BookmarkView,
  bookmarkDraft,
  bookmarkImport,
  bookmarkTags,
  bookmarkTitle,
  importSizeMessage,
  visibleBookmarks,
} from "../lib/library";
import { BookmarksProvider, useBookmarkSnapshot, useBookmarks } from "../state/bookmarks-context";

function Editor({ item, onClose }: { item: BookmarkItem | "new" | null; onClose(): void }) {
  const store = useBookmarks();
  const connection = useConnectionState();
  const data = typeof item === "object" ? item?.data : undefined;
  const [draft, setDraft] = useState({
    url: data?.url ?? "",
    title: data?.title ?? "",
    description: data?.description ?? "",
    notes: data?.notes ?? "",
    tags: data?.tags?.join(", ") ?? "",
  });
  const [error, setError] = useState("");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!store || connection !== "online") return;
    try {
      const value = bookmarkDraft(draft);
      if (item && item !== "new") void store.edit([item.id], value);
      else
        void store.add([
          { id: crypto.randomUUID(), data: { ...value, created: new Date(), archived: false } },
        ]);
      onClose();
    } catch (error) {
      setError((error as Error).message);
    }
  };
  return (
    <Dialog
      open={item !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="bkm-dialog">
        <DialogHeader>
          <DialogTitle>{item === "new" ? "Add a bookmark" : "Edit bookmark"}</DialogTitle>
          <DialogDescription>Keep a link, and a little context for later.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="bkm-form">
          <Label htmlFor="bkm-url">URL</Label>
          <Input
            id="bkm-url"
            type="url"
            required
            value={draft.url}
            placeholder="https://example.com/a-good-read"
            onChange={(event) => setDraft({ ...draft, url: event.target.value })}
            onBlur={() => {
              if (!draft.title) {
                try {
                  setDraft({ ...draft, title: new URL(draft.url).host });
                } catch {
                  /* Validate on save. */
                }
              }
            }}
          />
          <Label htmlFor="bkm-title">Title</Label>
          <Input
            id="bkm-title"
            value={draft.title}
            onChange={(event) => setDraft({ ...draft, title: event.target.value })}
          />
          <Label htmlFor="bkm-description">Description</Label>
          <Textarea
            id="bkm-description"
            rows={2}
            value={draft.description}
            onChange={(event) => setDraft({ ...draft, description: event.target.value })}
          />
          <Label htmlFor="bkm-notes">Notes</Label>
          <Textarea
            id="bkm-notes"
            rows={3}
            value={draft.notes}
            onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
          />
          <Label htmlFor="bkm-tags">Tags</Label>
          <Input
            id="bkm-tags"
            value={draft.tags}
            placeholder="reading, weekend"
            aria-describedby="bkm-tags-help"
            onChange={(event) => setDraft({ ...draft, tags: event.target.value })}
          />
          <p id="bkm-tags-help" className="bkm-muted">
            Separate tags with commas.
          </p>
          {error && (
            <p role="alert" className="bkm-error">
              {error}
            </p>
          )}
          {connection !== "online" && (
            <p role="status">Your draft is still here. Reconnect to save it.</p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!store || connection !== "online"}>
              Save bookmark
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ImportDialog({ open, onClose }: { open: boolean; onClose(): void }) {
  const store = useBookmarks();
  const snapshot = useBookmarkSnapshot();
  const connection = useConnectionState();
  const [parsed, setParsed] = useState<NetscapeImport | null>(null);
  const [error, setError] = useState("");
  const [reading, setReading] = useState(false);
  const existing = new Set(snapshot.items.map((item) => item.data.url));
  const candidates: BookmarkData[] = [];
  for (const data of parsed?.bookmarks ?? [])
    if (!existing.has(data.url)) {
      existing.add(data.url);
      candidates.push(data);
    }
  const duplicates = (parsed?.bookmarks.length ?? 0) - candidates.length;
  const choose = async (file?: File) => {
    if (!file) return;
    setReading(true);
    setError("");
    setParsed(null);
    try {
      if (file.size > 10_000_000) throw new Error(importSizeMessage);
      const result = bookmarkImport(await file.text());
      setParsed(result);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setReading(false);
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value) onClose();
      }}
    >
      <DialogContent className="bkm-dialog">
        <DialogHeader>
          <DialogTitle>Import bookmarks</DialogTitle>
          <DialogDescription>
            Choose a Netscape HTML export from your browser, Pocket or Raindrop. Folders become
            tags.
          </DialogDescription>
        </DialogHeader>
        <Label htmlFor="bkm-import">Bookmarks HTML file</Label>
        <Input
          id="bkm-import"
          type="file"
          accept=".html,.htm,text/html"
          disabled={reading}
          onChange={(event) => {
            void choose(event.target.files?.[0]);
          }}
        />
        {reading && <LoadingSkeleton preset="list" label="Reading bookmark file" />}
        {error && <p role="alert">{error}</p>}
        {parsed && (
          <p role="status">
            {candidates.length} {candidates.length === 1 ? "bookmark" : "bookmarks"} to import.{" "}
            {duplicates} duplicates and {parsed.skipped} invalid links skipped.
          </p>
        )}
        {connection !== "online" && <p role="status">Reconnect to import your bookmarks.</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!store || !candidates.length || reading || connection !== "online"}
            onClick={() => {
              void store?.add(
                candidates.map((data) => ({
                  id: crypto.randomUUID(),
                  data: { ...data, created: data.created ?? new Date() },
                })),
              );
              onClose();
            }}
          >
            Import bookmarks
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Library() {
  const store = useBookmarks();
  const snapshot = useBookmarkSnapshot();
  const connection = useConnectionState();
  const [view, setView] = useState<BookmarkView>("all");
  const [tag, setTag] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<BookmarkSort>("newest");
  const [layout, setLayout] = useState<"list" | "cards">("list");
  const [selected, setSelected] = useState<string[]>([]);
  const [editor, setEditor] = useState<BookmarkItem | "new" | null>(null);
  const [importing, setImporting] = useState(false);
  const [tagging, setTagging] = useState(false);
  const [bulkTag, setBulkTag] = useState("");
  const [registrationHintDismissed, setRegistrationHintDismissed] = useState(false);
  const [filterNotice, setFilterNotice] = useState("");
  const announcementTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(announcementTimer.current), []);
  const items = visibleBookmarks(snapshot.items, { view, tag, search, sort });
  const unreadable = snapshot.skipped.filter(
    ({ reason }) => reason !== "not-found" && reason !== "not-rdf",
  ).length;
  const rateLimited = snapshot.skipped.some(({ reason }) => reason === "rate-limited");
  const selection = selected.filter((id) => items.some((item) => item.id === id));
  const tags = bookmarkTags(snapshot.items);
  const editable = snapshot.status === "ready" && connection === "online";
  const views: { key: BookmarkView; label: string; count: number }[] = [
    { key: "all", label: "All bookmarks", count: snapshot.items.length },
    {
      key: "unread",
      label: "Unread",
      count: snapshot.items.filter((item) => !item.data.archived).length,
    },
    {
      key: "archived",
      label: "Archived",
      count: snapshot.items.filter((item) => item.data.archived).length,
    },
  ];
  const filter = (nextView: BookmarkView, nextTag: string | null, nextSearch = search) => {
    announceCount(
      visibleBookmarks(snapshot.items, { view: nextView, tag: nextTag, search: nextSearch, sort })
        .length,
    );
    setView(nextView);
    setTag(nextTag);
    setSearch(nextSearch);
    setSelected([]);
  };
  const announceCount = (count: number) => {
    if (count === items.length) return;
    clearTimeout(announcementTimer.current);
    announcementTimer.current = setTimeout(() => {
      setFilterNotice(`${count} ${count === 1 ? "bookmark" : "bookmarks"}`);
    }, 300);
  };
  const remove = (ids: string[]) => {
    if (!store) return;
    const undo = store.remove(ids);
    setSelected([]);
    toast(`${ids.length === 1 ? "Bookmark" : `${ids.length} bookmarks`} deleted`, {
      duration: 8000,
      action: { label: "Undo", onClick: undo },
    });
  };
  const exportFile = async () => {
    try {
      const blob = new Blob([serializeNetscapeBookmarks(snapshot.items.map((item) => item.data))], {
        type: "text/html;charset=utf-8",
      });
      if (process.env.NEXT_PUBLIC_SUITE_TARGET === "native") {
        await saveNatively(blob, "bookmarks.html", "text/html");
        return;
      }
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "bookmarks.html";
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch {
      toast.error("Couldn't export your bookmarks. Try again.");
    }
  };
  const sidebar = (
    <div className="bkm-sidebar">
      <div className="bkm-brand">
        <Bookmark size={22} aria-hidden="true" />
        <strong>Bookmarks</strong>
      </div>
      <nav aria-label="Bookmark views">
        {views.map(({ key, label, count }) => (
          <Button
            key={key}
            variant={view === key && !tag ? "secondary" : "ghost"}
            aria-pressed={view === key && !tag}
            onClick={() => filter(key, null)}
          >
            <span>{label}</span>
            <span className="bkm-count">{count}</span>
          </Button>
        ))}
      </nav>
      <div className="bkm-tag-heading">
        <Tag size={15} aria-hidden="true" />
        <h2>Tags</h2>
      </div>
      <nav aria-label="Bookmark tags">
        {tags.length ? (
          tags.map(([name, count]) => (
            <Button
              key={name}
              variant={tag === name ? "secondary" : "ghost"}
              aria-pressed={tag === name}
              onClick={() => filter("all", name)}
            >
              <span className="bkm-tag-name">{name}</span>
              <span className="bkm-count">{count}</span>
            </Button>
          ))
        ) : (
          <p className="bkm-muted">Your tags will appear here.</p>
        )}
      </nav>
      <p className="bkm-sidebar-foot">
        Good things, kept for later.
        <br />
        Your bookmarks live in your pod.
      </p>
    </div>
  );
  return (
    <AppFrame
      app="bookmarks"
      sidebar={sidebar}
      context={<span>Bookmarks</span>}
      actions={
        <Button size="sm" disabled={!editable} onClick={() => setEditor("new")}>
          <Plus size={16} aria-hidden="true" />
          Add bookmark
        </Button>
      }
    >
      <div className="bkm-page">
        <header className="bkm-heading">
          <div>
            <p className="bkm-eyebrow">YOUR READING CORNER</p>
            <AppHeading>
              {tag ? `Tagged “${tag}”` : views.find((entry) => entry.key === view)?.label}
            </AppHeading>
            <p className="bkm-muted">A little less searching. A little more finding.</p>
          </div>
          <div className="bkm-import-export">
            <Button variant="outline" disabled={!editable} onClick={() => setImporting(true)}>
              <ArrowDownToLine size={16} aria-hidden="true" />
              Import
            </Button>
            <Button
              variant="outline"
              disabled={!snapshot.items.length}
              onClick={() => {
                void exportFile();
              }}
            >
              <ArrowUpFromLine size={16} aria-hidden="true" />
              Export
            </Button>
          </div>
        </header>
        {connection !== "online" && (
          <p className="bkm-notice" role="status">
            You're offline. Browse loaded bookmarks or export a copy. Reconnect to save changes.
          </p>
        )}
        {unreadable > 0 && (
          <p className="bkm-notice">
            {rateLimited
              ? "Your library is incomplete. The pod is receiving too many requests. Try refreshing later."
              : `${unreadable} ${unreadable === 1 ? "item couldn't" : "items couldn't"} be read.`}
          </p>
        )}
        {snapshot.registration === "failed" && !registrationHintDismissed && (
          <div className="bkm-notice">
            <span>Your bookmarks are available here. Other apps may not find them yet.</span>
            <Button variant="ghost" size="sm" onClick={() => setRegistrationHintDismissed(true)}>
              Dismiss hint
            </Button>
          </div>
        )}
        <div className="bkm-mobile-filters">
          <Label htmlFor="bkm-view">View</Label>
          <Select
            value={tag ? `tag:${tag}` : view}
            onValueChange={(value) => {
              if (value.startsWith("tag:")) filter("all", value.slice(4));
              else filter(value as BookmarkView, null);
            }}
          >
            <SelectTrigger id="bkm-view">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {views.map((entry) => (
                <SelectItem key={entry.key} value={entry.key}>
                  {entry.label} ({entry.count})
                </SelectItem>
              ))}
              {tags.map(([name, count]) => (
                <SelectItem key={name} value={`tag:${name}`}>
                  #{name} ({count})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="bkm-toolbar">
          <div className="bkm-search">
            <Search size={18} aria-hidden="true" />
            <Input
              aria-label="Search bookmarks"
              placeholder="Search your bookmarks…"
              value={search}
              onChange={(event) => {
                announceCount(
                  visibleBookmarks(snapshot.items, { view, tag, search: event.target.value, sort })
                    .length,
                );
                setSearch(event.target.value);
                setSelected([]);
              }}
            />
          </div>
          <Select value={sort} onValueChange={(value) => setSort(value as BookmarkSort)}>
            <SelectTrigger aria-label="Sort bookmarks" className="bkm-sort">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="newest">Newest first</SelectItem>
              <SelectItem value="oldest">Oldest first</SelectItem>
              <SelectItem value="title">Title A–Z</SelectItem>
            </SelectContent>
          </Select>
          <fieldset className="bkm-layout" aria-label="Bookmark layout">
            <IconButton
              label="List layout"
              variant={layout === "list" ? "secondary" : "ghost"}
              aria-pressed={layout === "list"}
              onClick={() => setLayout("list")}
            >
              <List size={18} aria-hidden="true" />
            </IconButton>
            <IconButton
              label="Card layout"
              variant={layout === "cards" ? "secondary" : "ghost"}
              aria-pressed={layout === "cards"}
              onClick={() => setLayout("cards")}
            >
              <LayoutGrid size={18} aria-hidden="true" />
            </IconButton>
          </fieldset>
          <IconButton
            label="Refresh bookmarks"
            variant="ghost"
            disabled={snapshot.saving > 0 || connection !== "online"}
            onClick={() => {
              void store?.load();
            }}
          >
            <RefreshCw size={18} aria-hidden="true" />
          </IconButton>
        </div>
        <div className="bkm-selection">
          <Checkbox
            aria-label="Select all visible bookmarks"
            disabled={!items.length}
            checked={
              selection.length > 0 && selection.length < items.length
                ? "indeterminate"
                : items.length > 0 && selection.length === items.length
            }
            onCheckedChange={(checked) => setSelected(checked ? items.map((item) => item.id) : [])}
          />
          <span>
            {selection.length
              ? `${selection.length} selected`
              : `${items.length} ${items.length === 1 ? "bookmark" : "bookmarks"}`}
          </span>
          <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
            {filterNotice}
          </span>
          {selection.length > 0 && (
            <div className="bkm-bulk">
              <Button
                variant="ghost"
                disabled={!editable}
                onClick={() => {
                  void store?.edit(selection, { archived: view !== "archived" });
                  setSelected([]);
                }}
              >
                {view === "archived" ? "Unarchive" : "Archive"}
              </Button>
              <Button variant="ghost" disabled={!editable} onClick={() => setTagging(true)}>
                Add tag
              </Button>
              <Button variant="ghost" disabled={!editable} onClick={() => remove(selection)}>
                Delete
              </Button>
              <Button variant="ghost" onClick={() => setSelected([])}>
                Clear selection
              </Button>
            </div>
          )}
        </div>
        {snapshot.status === "loading" ? (
          <LoadingSkeleton preset="list" label="Loading your bookmarks" />
        ) : snapshot.status === "error" ? (
          <ErrorState
            error="unreachable"
            actions={{
              retry: () => {
                void store?.load();
              },
            }}
          >
            <p>Couldn't refresh your bookmarks. Check your connection and try again.</p>
          </ErrorState>
        ) : null}
        {snapshot.status !== "loading" && !items.length && snapshot.status !== "error" && (
          <EmptyState
            variant={search || tag || view !== "all" ? "filtered-empty" : "first-use"}
            title={
              search || tag || view !== "all" ? "Nothing here just yet" : "Keep your next good find"
            }
            body={
              search || tag || view !== "all"
                ? "Try another search, tag or view."
                : "Save an article, a useful guide or an idea worth coming back to."
            }
            icon={<Bookmark size={24} aria-hidden="true" />}
            primaryAction={
              <Button disabled={!editable} onClick={() => setEditor("new")}>
                Add your first bookmark
              </Button>
            }
            secondaryAction={
              (search || tag || view !== "all") && (
                <Button
                  variant="outline"
                  onClick={() => {
                    filter("all", null, "");
                  }}
                >
                  Clear filters
                </Button>
              )
            }
          />
        )}
        <ul className={`bkm-collection bkm-${layout}`} aria-label="Bookmarks">
          {items.map((item) => (
            <li key={item.id} className="bkm-item">
              <div className="bkm-item-select">
                <Checkbox
                  aria-label={`Select ${bookmarkTitle(item.data)}`}
                  checked={selection.includes(item.id)}
                  onCheckedChange={(checked) =>
                    setSelected(
                      checked ? [...selection, item.id] : selection.filter((id) => id !== item.id),
                    )
                  }
                />
              </div>
              <div className="bkm-domain-tile" aria-hidden="true">
                <Bookmark size={23} strokeWidth={1.5} />
              </div>
              <div className="bkm-item-content">
                <div className="bkm-item-meta">
                  <span>{new URL(item.data.url).host}</span>
                  {item.data.archived && (
                    <span className="bkm-archived">
                      <Check size={12} aria-hidden="true" />
                      Archived
                    </span>
                  )}
                </div>
                <h3>
                  <a href={item.data.url} target="_blank" rel="noopener noreferrer">
                    {bookmarkTitle(item.data)}
                  </a>
                </h3>
                {item.data.description && (
                  <p className="bkm-description">{item.data.description}</p>
                )}
                {item.data.notes && <p className="bkm-notes">{item.data.notes}</p>}
                <div className="bkm-item-footer">
                  <div className="bkm-item-tags">
                    {item.data.tags?.map((name) => (
                      <Button
                        key={name}
                        variant="ghost"
                        size="sm"
                        onClick={() => filter("all", name)}
                      >
                        <Badge variant="secondary">{name}</Badge>
                      </Button>
                    ))}
                  </div>
                  {item.data.created && (
                    <time dateTime={item.data.created.toISOString()}>
                      {item.data.created.toLocaleDateString("en-GB", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                    </time>
                  )}
                </div>
              </div>
              <div className="bkm-item-actions">
                <IconButton
                  label={`Edit ${bookmarkTitle(item.data)}`}
                  variant="ghost"
                  disabled={!editable}
                  onClick={() => setEditor(item)}
                >
                  <Pencil size={16} aria-hidden="true" />
                </IconButton>
                <IconButton
                  label={`${item.data.archived ? "Unarchive" : "Archive"} ${bookmarkTitle(item.data)}`}
                  variant="ghost"
                  disabled={!editable}
                  onClick={() => {
                    void store?.edit([item.id], { archived: !item.data.archived });
                  }}
                >
                  {item.data.archived ? (
                    <ArchiveRestore size={16} aria-hidden="true" />
                  ) : (
                    <Archive size={16} aria-hidden="true" />
                  )}
                </IconButton>
                <IconButton
                  label={`Delete ${bookmarkTitle(item.data)}`}
                  variant="ghost"
                  disabled={!editable}
                  onClick={() => remove([item.id])}
                >
                  <Trash2 size={16} aria-hidden="true" />
                </IconButton>
              </div>
            </li>
          ))}
        </ul>
        <p className="bkm-save-status" role="status" aria-live="polite">
          {snapshot.saving
            ? `Saving ${snapshot.saving === 1 ? "change" : "changes"} to your pod…`
            : ""}
        </p>
      </div>
      {editor !== null && (
        <Editor
          key={editor === "new" ? "new" : editor.id}
          item={editor}
          onClose={() => setEditor(null)}
        />
      )}
      {importing && <ImportDialog open onClose={() => setImporting(false)} />}
      <Dialog open={tagging} onOpenChange={setTagging}>
        <DialogContent className="bkm-dialog">
          <DialogHeader>
            <DialogTitle>Tag selected bookmarks</DialogTitle>
            <DialogDescription>
              Add one tag to {selection.length} selected bookmarks.
            </DialogDescription>
          </DialogHeader>
          <form
            className="bkm-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (editable && bulkTag.trim()) {
                void store?.tag(selection, bulkTag);
                setTagging(false);
                setBulkTag("");
                setSelected([]);
              }
            }}
          >
            <Label htmlFor="bkm-bulk-tag">Tag name</Label>
            <Input
              id="bkm-bulk-tag"
              value={bulkTag}
              onChange={(event) => setBulkTag(event.target.value)}
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setTagging(false)}>
                Cancel
              </Button>
              <Button disabled={!editable || !bulkTag.trim()}>Add tag</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </AppFrame>
  );
}
function SessionGate() {
  const state = usePodSessionState();
  if (state.status === "loading")
    return (
      <div className="bkm-page">
        <AppHeading>Opening Bookmarks</AppHeading>
        <LoadingSkeleton preset="list" />
      </div>
    );
  if (state.status === "error")
    return (
      <div className="bkm-page">
        <AppHeading>Bookmarks</AppHeading>
        <ErrorState error="unreachable" actions={{ retry: () => location.reload() }} />
      </div>
    );
  if (state.status === "signed-out")
    return (
      <div className="bkm-page">
        <AppHeading>Bookmarks</AppHeading>
        <p role="status">Sign in to open your bookmarks.</p>
      </div>
    );
  return (
    <BookmarksProvider
      key={`${state.session.mode}:${state.session.webId}:${state.session.storageUrl}`}
      session={state.session}
    >
      <Library />
    </BookmarksProvider>
  );
}
export function BookmarksApp() {
  return (
    <AppSessionGuard>
      <PodSessionProvider>
        <SessionGate />
      </PodSessionProvider>
    </AppSessionGuard>
  );
}
