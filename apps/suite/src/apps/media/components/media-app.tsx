// AUTHORED-BY Codex (GPT-6.1 Sol)
"use client";
import {
  createMediaRepository,
  type MediaRecord,
  type MediaRepository,
} from "@jeswr/solid-media-log";
import {
  Button,
  EmptyState,
  ErrorState,
  Input,
  LoadingSkeleton,
  Toaster,
  toast,
} from "@jeswr/suite-ui";
import {
  BarChart3,
  BookOpen,
  Clapperboard,
  Gamepad2,
  Library,
  Plus,
  Tv,
  Upload,
} from "lucide-react";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { type PodSession, PodSessionProvider, usePodSessionState } from "@/lib/session/pod-session";
import { AppFrame, AppHeading, AppSessionGuard } from "@/shell/app-frame";
import { useConnectionState } from "@/shell/sync/connection-state";
import { ensureMediaSample } from "../demo/sample";
import { filterMedia, KIND_LABELS, type MediaFilters, STATUS_LABELS } from "../lib/view";
import { MediaStore } from "../state/media-store";
import { MediaCard } from "./media-card";
import { MediaEditor } from "./media-editor";
import { MediaImportDialog } from "./media-import";
import { MediaStats } from "./media-stats";

const repositories = new WeakMap<typeof fetch, Map<string, Promise<MediaRepository>>>();
function repositoryFor(session: PodSession) {
  let account = repositories.get(session.fetch);
  if (!account) {
    account = new Map();
    repositories.set(session.fetch, account);
  }
  const key = `${session.mode}\u0000${session.webId}\u0000${session.storageUrl}`;
  const existing = account.get(key);
  if (existing) return existing;
  const pending = createMediaRepository({
    knownSolid: session.mode === "demo",
    fetch: session.fetch,
    storage: session.storageUrl,
    webId: session.webId,
  })
    .then(async (repository) => {
      await ensureMediaSample(repository, session.mode);
      return repository;
    })
    .catch((error: unknown) => {
      account.delete(key);
      throw error;
    });
  account.set(key, pending);
  return pending;
}
const INITIAL_FILTERS: MediaFilters = { kind: "all", status: "all", query: "", rated: false };
const shelves = [
  { kind: "all", label: "All media", icon: Library },
  { kind: "film", label: "Films", icon: Clapperboard },
  { kind: "tv", label: "TV", icon: Tv },
  { kind: "book", label: "Books", icon: BookOpen },
  { kind: "game", label: "Games", icon: Gamepad2 },
] as const;
function Tracker({ session }: { session: PodSession }) {
  const [attempt, setAttempt] = useState(0);
  // A fresh store and repository retry are scoped to the active session object.
  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt recreates failed initialisation
  const store = useMemo(() => new MediaStore(repositoryFor(session)), [session, attempt]);
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const connection = useConnectionState();
  const offline = connection !== "online" && session.mode !== "demo";
  const [filters, setFilters] = useState<MediaFilters>(INITIAL_FILTERS);
  const [stats, setStats] = useState(false);
  const [editor, setEditor] = useState<MediaRecord | "new" | null>(null);
  const [importing, setImporting] = useState(false);
  useEffect(() => {
    void store.load();
    return session.subscribe(() => {
      void store.load();
    });
  }, [store, session]);
  useEffect(() => {
    if (!offline && state.saving === 0) void store.load();
  }, [offline, state.saving, store]);
  const visible = filterMedia(state.records, filters);
  const retry = () => {
    if (state.records.length) void store.load();
    else setAttempt((value) => value + 1);
  };
  const save = (record: MediaRecord) => {
    try {
      void store
        .save(
          { ...record.data, status: "finished", finished: new Date().toISOString().slice(0, 10) },
          record,
        )
        .catch(() =>
          toast.error(
            "Couldn't save this item. Your change was rolled back. Try again when connected.",
          ),
        );
    } catch (error) {
      toast.error(
        error instanceof TypeError
          ? error.message
          : "Couldn't prepare this item. Please edit it and try again.",
      );
    }
  };
  return (
    <AppFrame
      app="media"
      sidebar={
        <div className="media-sidebar">
          <strong className="media-brand">
            <Clapperboard size={22} aria-hidden="true" />
            Media
          </strong>
          <p className="media-muted">Your shelves</p>
          <nav aria-label="Media shelves">
            {shelves.map(({ kind, label, icon: Icon }) => (
              <Button
                key={kind}
                variant="ghost"
                aria-pressed={!stats && filters.kind === kind}
                onClick={() => {
                  setStats(false);
                  setFilters((current) => ({ ...current, kind }));
                }}
              >
                <Icon size={18} aria-hidden="true" />
                <span>{label}</span>
                <span className="media-count">
                  {
                    state.records.filter(
                      ({ data }) =>
                        kind === "all" ||
                        data.kind === kind ||
                        (kind === "tv" && data.kind === "episode"),
                    ).length
                  }
                </span>
              </Button>
            ))}
          </nav>
          <Button variant="ghost" aria-pressed={stats} onClick={() => setStats(true)}>
            <BarChart3 size={18} aria-hidden="true" />
            Your year
          </Button>
          <p className="media-sidebar-foot media-muted">
            Watch. Read. Play.
            <br />A little record of what stayed with you.
            {session.mode === "demo" && (
              <>
                <br />
                Fictional sample library
              </>
            )}
          </p>
        </div>
      }
      actions={
        <Button size="sm" onClick={() => setEditor("new")} disabled={state.loading || offline}>
          <Plus size={16} aria-hidden="true" />
          Add item
        </Button>
      }
    >
      <div className="media-page">
        <header className="media-heading">
          <div>
            <AppHeading>{stats ? "Your year in media" : "Your media"}</AppHeading>
            <p className="media-muted">
              {stats
                ? "Stories, worlds and discoveries worth remembering."
                : "Keep the next thing close. Remember the things you loved."}
            </p>
          </div>
          <div className="media-heading-actions">
            <Button variant="ghost" onClick={() => setStats(!stats)}>
              {stats ? "Back to shelves" : "Your year"}
            </Button>
            <Button
              variant="outline"
              onClick={() => setImporting(true)}
              disabled={state.loading || offline}
            >
              <Upload size={16} aria-hidden="true" />
              Import CSV
            </Button>
          </div>
        </header>
        {offline && (
          <p className="media-notice" role="status">
            You're offline. You can browse items already loaded. Reconnect to save or import; open
            drafts stay here.
          </p>
        )}
        {state.incomplete && (
          <p className="media-notice" role="status">
            This is a partial library. The scan reached its limit; some imported items may be
            missing.
          </p>
        )}
        {state.loading ? (
          <LoadingSkeleton preset="grid" label="Loading your media" />
        ) : (
          <>
            {state.error && (
              <ErrorState error="unreachable" actions={{ retry }}>
                <p>We couldn't refresh your media. Items already loaded remain available.</p>
              </ErrorState>
            )}
            {stats ? (
              !state.error || state.records.length > 0 ? (
                <MediaStats records={state.records} />
              ) : null
            ) : (
              <>
                <section className="media-tools" aria-label="Search and filter media">
                  <Input
                    aria-label="Search media"
                    placeholder="Search titles, creators or reviews"
                    value={filters.query}
                    onChange={(event) => setFilters({ ...filters, query: event.target.value })}
                  />
                  <Button
                    variant={filters.rated ? "secondary" : "outline"}
                    aria-pressed={filters.rated}
                    onClick={() => setFilters({ ...filters, rated: !filters.rated })}
                  >
                    Rated only
                  </Button>
                </section>
                <fieldset className="media-kind-tabs" aria-label="Media kind">
                  {shelves.map(({ kind, label }) => (
                    <Button
                      size="sm"
                      key={kind}
                      variant={filters.kind === kind ? "secondary" : "ghost"}
                      aria-pressed={filters.kind === kind}
                      onClick={() => setFilters({ ...filters, kind })}
                    >
                      {label}
                    </Button>
                  ))}
                </fieldset>
                <fieldset className="media-status-tabs" aria-label="Shelf">
                  <Button
                    size="sm"
                    variant={filters.status === "all" ? "secondary" : "ghost"}
                    aria-pressed={filters.status === "all"}
                    onClick={() => setFilters({ ...filters, status: "all" })}
                  >
                    All shelves
                  </Button>
                  {(Object.keys(STATUS_LABELS) as (keyof typeof STATUS_LABELS)[]).map((status) => (
                    <Button
                      size="sm"
                      key={status}
                      variant={filters.status === status ? "secondary" : "ghost"}
                      aria-pressed={filters.status === status}
                      onClick={() => setFilters({ ...filters, status })}
                    >
                      {STATUS_LABELS[status]}
                    </Button>
                  ))}
                </fieldset>
                <p className="media-muted media-result-count" role="status">
                  {visible.length} {visible.length === 1 ? "item" : "items"}
                  {filters.kind === "all" ? " in your library" : ` · ${KIND_LABELS[filters.kind]}`}
                </p>
                {visible.length ? (
                  <ul className="media-grid" aria-label="Media items">
                    {visible.map((record) => (
                      <li key={record.id}>
                        <MediaCard
                          record={record}
                          offline={offline}
                          onEdit={() => setEditor(record)}
                          onFinish={() => save(record)}
                        />
                      </li>
                    ))}
                  </ul>
                ) : (
                  !state.error && (
                    <EmptyState
                      variant={
                        state.records.length
                          ? "filtered-empty"
                          : offline
                            ? "not-available-offline"
                            : "first-use"
                      }
                      title={
                        state.records.length
                          ? "Nothing on this shelf yet"
                          : "Your next favourite starts here"
                      }
                      body={
                        state.records.length
                          ? "Try another shelf or clear your filters."
                          : "Add a film, series, book or game, or bring your library over from a CSV export."
                      }
                      primaryAction={
                        <Button
                          onClick={() =>
                            state.records.length ? setFilters(INITIAL_FILTERS) : setEditor("new")
                          }
                          disabled={offline}
                        >
                          {state.records.length ? "Clear filters" : "Add your first item"}
                        </Button>
                      }
                    />
                  )
                )}
              </>
            )}
          </>
        )}
        <p className="media-save-status" role="status" aria-live="polite">
          {state.saving ? `Saving ${state.saving === 1 ? "change" : "changes"} to your pod…` : ""}
        </p>
      </div>
      {editor && (
        <MediaEditor
          key={editor === "new" ? "new" : editor.id}
          record={editor === "new" ? undefined : editor}
          offline={offline}
          onClose={() => setEditor(null)}
          onSave={(entry) => {
            const task = store.save(entry, editor === "new" ? undefined : editor);
            setEditor(null);
            void task.catch(() =>
              toast.error(
                "Couldn't save this item. Your change was rolled back. Please try again.",
              ),
            );
          }}
        />
      )}
      {importing && (
        <MediaImportDialog
          records={state.records}
          offline={offline}
          onClose={() => setImporting(false)}
          onImport={(entries) => {
            setImporting(false);
            for (const entry of entries)
              void store
                .save(entry)
                .catch(() =>
                  toast.error(
                    `Couldn't import ${entry.title}. Other items will continue importing.`,
                  ),
                );
          }}
        />
      )}
    </AppFrame>
  );
}
function SessionGate() {
  const state = usePodSessionState();
  if (state.status === "loading")
    return (
      <div className="media-page">
        <AppHeading>Opening Media</AppHeading>
        <LoadingSkeleton preset="grid" />
      </div>
    );
  if (state.status === "signed-out")
    return (
      <div className="media-page">
        <AppHeading>Media</AppHeading>
        <p role="status">Sign in to open your media library.</p>
      </div>
    );
  if (state.status === "error")
    return (
      <div className="media-page">
        <AppHeading>Can't open Media</AppHeading>
        <ErrorState error="unreachable" actions={{ retry: () => location.reload() }} />
      </div>
    );
  return (
    <Tracker
      key={`${state.session.mode}:${state.session.webId}:${state.session.storageUrl}`}
      session={state.session}
    />
  );
}
export function MediaApp() {
  return (
    <AppSessionGuard>
      <PodSessionProvider>
        <SessionGate />
        <Toaster position="bottom-center" />
      </PodSessionProvider>
    </AppSessionGuard>
  );
}
