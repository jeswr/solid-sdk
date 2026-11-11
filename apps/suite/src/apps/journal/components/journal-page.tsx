// AUTHORED-BY Codex (GPT-6.1 Sol)
"use client";
import {
  calculateStreak,
  dayKey,
  excerpt,
  exportMarkdown,
  type JournalEntry,
  onThisDay,
  wordCount,
} from "@jeswr/solid-journal";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  ErrorState,
  Input,
  Label,
  LoadingSkeleton,
  SafeMarkdown,
} from "@jeswr/suite-ui";
import { BookOpen, CalendarDays, Download, LockKeyhole, Plus } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { AppHeading } from "@/shell/app-frame";
import { useConnectionState } from "@/shell/sync/connection-state";
import { useJournal } from "../state/journal-context";
import { JournalCalendar } from "./calendar";
import { Editor } from "./editor";
import { Photo } from "./photo";

export function JournalPage() {
  const { entries, loading, error, saving, failed, skipped, needsPrivacy, controller } =
    useJournal();
  const connection = useConnectionState();
  const [now, setNow] = useState(() => new Date());
  const newDraftStarted = useRef(false);
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);
  const [view, setView] = useState<"timeline" | "calendar">("timeline");
  const [query, setQuery] = useState("");
  const [day, setDay] = useState("");
  const [limit, setLimit] = useState(20);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<JournalEntry>();
  const [editorKey, setEditorKey] = useState(0);
  const [reading, setReading] = useState<string>();
  const [deleting, setDeleting] = useState(false);
  const focusReturn = useRef<HTMLElement | null>(null);
  const openEntry = (url: string | undefined) => {
    focusReturn.current = document.activeElement as HTMLElement;
    setReading(url);
  };
  const sentinel = useRef<HTMLDivElement>(null);
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const streak = calculateStreak(entries, now, timeZone);
  const memories = onThisDay(entries, now, timeZone);
  const selected = entries.find((entry) => entry.url === reading);
  const filtered = useMemo(() => {
    const search = query.trim().toLocaleLowerCase("en-GB");
    return entries.filter(
      (entry) =>
        (!day || dayKey(entry.created, timeZone) === day) &&
        (!search ||
          [entry.title, entry.text, entry.mood, entry.location, ...(entry.tags ?? [])]
            .join(" ")
            .toLocaleLowerCase("en-GB")
            .includes(search)),
    );
  }, [entries, day, query, timeZone]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: new filters restart the render window
  useEffect(() => setLimit(20), [query, day]);
  useEffect(() => {
    const element = sentinel.current;
    if (!element || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (items) => {
        if (items.some((item) => item.isIntersecting)) setLimit((value) => value + 20);
      },
      { rootMargin: "300px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const newEntry = () => {
    focusReturn.current = document.activeElement as HTMLElement;
    if (editing || !newDraftStarted.current) setEditorKey((value) => value + 1);
    newDraftStarted.current = true;
    setEditing(undefined);
    setEditorOpen(true);
  };
  const download = () => {
    const url = URL.createObjectURL(
      new Blob([exportMarkdown(entries)], { type: "text/markdown;charset=utf-8" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "my-journal.md";
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const groups = new Map<string, JournalEntry[]>();
  for (const entry of filtered.slice(0, limit)) {
    const date = dayKey(entry.created, timeZone);
    groups.set(date, [...(groups.get(date) ?? []), entry]);
  }
  return (
    <div className="jn-page">
      <header className="jn-header">
        <div>
          <p className="jn-eyebrow">A MOMENT FOR YOURSELF</p>
          <AppHeading>Your days, in your words</AppHeading>
          <p className="jn-private">
            <LockKeyhole size={15} aria-hidden="true" />
            Only you can see this
          </p>
        </div>
        <div className="jn-row">
          <Button
            variant="outline"
            onClick={download}
            disabled={
              loading || error || skipped > 0 || saving > 0 || failed.length > 0 || !entries.length
            }
          >
            <Download size={16} aria-hidden="true" />
            Export Markdown
          </Button>
          <Button onClick={newEntry}>
            <Plus size={18} aria-hidden="true" />
            New entry
          </Button>
        </div>
      </header>
      {connection !== "online" && (
        <div className="jn-notice" role="status">
          You're offline. You can keep writing here. Keep this tab open and retry any unsaved
          entries when you're connected.
        </div>
      )}
      <div role="status" aria-live="polite" className="jn-muted">
        {saving
          ? `Saving ${saving === 1 ? "your entry" : `${saving} entries`}…`
          : failed.length
            ? "Some changes haven't been saved to your pod."
            : ""}
      </div>
      {failed.length > 0 && (
        <div className="jn-notice" role="alert">
          <p>Your unsaved words and attachments are kept in this tab.</p>
          {failed.some((edit) => !edit.conflict) && (
            <Button onClick={() => controller.retryFailed()}>Retry unsaved changes</Button>
          )}
          {failed
            .filter((edit) => edit.conflict)
            .map((edit) => (
              <section
                key={edit.id}
                aria-label={`Conflict: ${edit.data?.title || "Untitled entry"}`}
              >
                <p>This entry changed on another device. Your version is kept below.</p>
                {edit.data && <SafeMarkdown className="jn-prose">{edit.data.text}</SafeMarkdown>}
                {!edit.data && <p>Your change: delete this entry.</p>}
                <Button onClick={() => controller.overwriteFailed(edit.id)}>Overwrite</Button>
                <Button variant="outline" onClick={() => controller.discardFailed(edit.id)}>
                  Discard mine
                </Button>
              </section>
            ))}
          <Button
            variant="outline"
            onClick={() => {
              const url = URL.createObjectURL(
                new Blob(
                  [exportMarkdown(failed.flatMap((item) => (item.data ? [item.data] : [])))],
                  { type: "text/markdown" },
                ),
              );
              const anchor = document.createElement("a");
              anchor.href = url;
              anchor.download = "unsaved-journal.md";
              anchor.click();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
            }}
          >
            Download unsaved words
          </Button>
        </div>
      )}
      {skipped > 0 && (
        <div className="jn-notice" role="alert">
          {skipped} {skipped === 1 ? "entry was" : "entries were"} left out because private access
          couldn't be verified. Check their permissions in Drive. Export is paused until all entries
          are private.
        </div>
      )}
      <div className="jn-overview">
        <section className="jn-stat">
          <span className="jn-stat-number">{streak.current}</span>
          <div>
            <strong>{streak.current === 1 ? "day" : "days"} of writing</strong>
            <p>Longest streak: {streak.longest} days</p>
          </div>
        </section>
        <section className="jn-stat">
          <span className="jn-stat-number">{entries.length}</span>
          <div>
            <strong>Moments kept</strong>
            <p>
              {entries
                .reduce((total, entry) => total + wordCount(entry.text), 0)
                .toLocaleString("en-GB")}{" "}
              words, all yours
            </p>
          </div>
        </section>
        <section className="jn-memory" aria-label="On this day">
          <span className="jn-eyebrow">ON THIS DAY</span>
          {memories.length ? (
            <Button variant="ghost" onClick={() => openEntry(memories[0]?.url)}>
              {memories[0]?.title || "An earlier chapter"} · {memories[0]?.created.getFullYear()}
            </Button>
          ) : (
            <p>Future you will be glad you wrote today.</p>
          )}
        </section>
      </div>
      <div className="jn-toolbar">
        <fieldset className="jn-row" aria-label="Journal view">
          <Button
            variant={view === "timeline" ? "secondary" : "ghost"}
            aria-pressed={view === "timeline"}
            onClick={() => setView("timeline")}
          >
            <BookOpen size={16} aria-hidden="true" />
            Timeline
          </Button>
          <Button
            variant={view === "calendar" ? "secondary" : "ghost"}
            aria-pressed={view === "calendar"}
            onClick={() => setView("calendar")}
          >
            <CalendarDays size={16} aria-hidden="true" />
            Calendar
          </Button>
        </fieldset>
        <div className="jn-search">
          <Label htmlFor="journal-search" className="sr-only">
            Search your journal
          </Label>
          <Input
            id="journal-search"
            type="search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setView("timeline");
            }}
            placeholder="Search words, moods or tags"
          />
        </div>
      </div>
      {day && (
        <div className="jn-row">
          <p>Entries for {day}</p>
          <Button variant="ghost" onClick={() => setDay("")}>
            Clear date filter
          </Button>
        </div>
      )}
      {loading ? (
        <LoadingSkeleton preset="list" label="Loading journal entries" />
      ) : error ? (
        <ErrorState
          error="unreachable"
          actions={{
            retry: () => {
              void controller.load();
            },
          }}
        >
          <p>
            We couldn't refresh your journal. Reconnect and try again. Export is paused until all
            entries are available.
          </p>
          {needsPrivacy && (
            <Button
              onClick={() => {
                void controller.makePrivate();
              }}
            >
              Make my journal private
            </Button>
          )}
        </ErrorState>
      ) : view === "calendar" ? (
        <JournalCalendar
          entries={entries}
          timeZone={timeZone}
          select={(date) => {
            setDay(date);
            setView("timeline");
          }}
        />
      ) : !filtered.length ? (
        <EmptyState
          variant={query || day ? "no-results" : "first-use"}
          title={query || day ? "No entries found" : "Your story starts here"}
          body={
            query || day
              ? "Try different words or clear your filters."
              : "A sentence, a small win, a whole day — make a little space for it."
          }
          primaryAction={
            <Button
              onClick={
                query || day
                  ? () => {
                      setQuery("");
                      setDay("");
                    }
                  : newEntry
              }
            >
              {query || day ? "Clear filters" : "Write your first entry"}
            </Button>
          }
        />
      ) : (
        <div className="jn-timeline">
          {[...groups].map(([date, group]) => (
            <section key={date} className="jn-day" aria-label={`Entries for ${date}`}>
              <h2>
                {group[0]?.created.toLocaleDateString("en-GB", {
                  weekday: "long",
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })}
              </h2>
              <div className="jn-day-entries">
                {group.map((entry) => (
                  <article key={entry.url} className="jn-entry">
                    <div className="jn-row">
                      <time dateTime={entry.created.toISOString()}>
                        {entry.created.toLocaleTimeString("en-GB", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </time>
                      {entry.mood && <span className="jn-mood">{entry.mood}</span>}
                    </div>
                    <h3>
                      <Button variant="link" onClick={() => openEntry(entry.url)}>
                        {entry.title || "Untitled entry"}
                      </Button>
                    </h3>
                    <p>{excerpt(entry.text, 220)}</p>
                    <div className="jn-entry-footer">
                      <span>
                        {wordCount(entry.text)} words
                        {entry.images?.length ? ` · ${entry.images.length} photos` : ""}
                      </span>
                      <div className="jn-tags">
                        {entry.tags?.map((tag) => (
                          <Button key={tag} variant="ghost" size="sm" onClick={() => setQuery(tag)}>
                            #{tag}
                          </Button>
                        ))}
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
      <div ref={sentinel}>
        {view === "timeline" && filtered.length > limit && (
          <Button variant="outline" onClick={() => setLimit((value) => value + 20)}>
            Show older entries
          </Button>
        )}
      </div>
      <p className="jn-footnote">
        A private space in your pod. No sharing, no audience — just you.
      </p>
      <Editor
        key={editorKey}
        returnFocus={() => focusReturn.current?.focus()}
        {...(editing ? { entry: editing } : {})}
        open={editorOpen}
        close={(saved) => {
          setEditorOpen(false);
          if (saved) {
            newDraftStarted.current = false;
            setEditing(undefined);
            setEditorKey((value) => value + 1);
          }
        }}
      />
      <Dialog
        open={!!selected}
        onOpenChange={(open) => {
          if (!open) {
            setReading(undefined);
            setDeleting(false);
          }
        }}
      >
        <DialogContent
          className="jn-reader"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (!editorOpen) focusReturn.current?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>{selected?.title || "Untitled entry"}</DialogTitle>
            <DialogDescription>
              {selected?.created.toLocaleString("en-GB")} · Only you can see this
            </DialogDescription>
          </DialogHeader>
          {selected && (
            <>
              <div className="jn-row">
                {selected.mood && <span className="jn-mood">{selected.mood}</span>}
                <span className="jn-muted">
                  {[selected.location, selected.weather].filter(Boolean).join(" · ")}
                </span>
              </div>
              <SafeMarkdown className="jn-prose">{selected.text}</SafeMarkdown>
              {selected.images?.map((url, index) => (
                <Photo key={url} url={url} number={index + 1} />
              ))}
              <p className="jn-muted">{selected.tags?.map((tag) => `#${tag}`).join(" ")}</p>
              <DialogFooter>
                {deleting ? (
                  <>
                    <p>Delete this entry? This cannot be undone.</p>
                    <Button variant="outline" onClick={() => setDeleting(false)}>
                      Keep entry
                    </Button>
                    <Button
                      variant="destructive"
                      onClick={() => {
                        controller.remove(selected);
                        setReading(undefined);
                        setDeleting(false);
                      }}
                    >
                      Delete permanently
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      variant="ghost"
                      disabled={!selected.etag}
                      onClick={() => setDeleting(true)}
                    >
                      Delete entry
                    </Button>
                    <Button
                      disabled={!selected.etag}
                      onClick={() => {
                        setEditing(selected);
                        setEditorKey((value) => value + 1);
                        setReading(undefined);
                        setEditorOpen(true);
                      }}
                    >
                      Edit entry
                    </Button>
                  </>
                )}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
