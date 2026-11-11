// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
"use client";
import { IconButton, LoadingSkeleton, Toaster, toast } from "@jeswr/suite-ui";
import { Grid2X2, List } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { type ReactNode, useEffect, useRef } from "react";
import { SuiteFrame } from "@/components/interim-shell/suite-frame";
import { decodeRef } from "@/lib/refs";
import { useRoutePathname } from "@/lib/route-params";
import { PodSessionProvider, usePodSessionState } from "@/lib/session/pod-session";
import type { StoredNote } from "../lib/model/store";
import { NotesProvider, useNotesContext } from "../state/notes-context";
import { useNoteReminders } from "../state/reminders";
import { NoteDialog } from "./note-dialog";
import { NotesGrid } from "./notes-grid";
import { NotesLoadError, NotesMissingState } from "./notes-states";
import { NotesSidebar } from "./sidebar";

const purged = new Set<string>();
function NotesRoutes() {
  const pathname = useRoutePathname();
  const query = useSearchParams().get("q") ?? "";
  const { notes, active, archived, trashed, refresh } = useNotesContext();
  const reference = pathname.startsWith("/notes/n/")
    ? pathname.slice("/notes/n/".length)
    : undefined;
  let url: string | undefined;
  let invalid = false;
  if (reference) {
    try {
      url = decodeRef(reference);
    } catch {
      invalid = true;
    }
  }
  const found = notes.find((note) => note.url === url);
  // Keep the dialog mounted while a move settles and the router leaves its former URL.
  const resolved = useRef<{ reference: string; note: StoredNote } | undefined>(undefined);
  if (found && reference) resolved.current = { reference, note: found };
  if (!reference) resolved.current = undefined;
  const selected =
    found ?? (resolved.current?.reference === reference ? resolved.current?.note : undefined);
  const ready =
    !active.loading &&
    !archived.loading &&
    !trashed.loading &&
    !active.error &&
    !archived.error &&
    !trashed.error;
  if (reference && (invalid || (ready && !selected))) return <NotesMissingState />;
  if (reference && !selected)
    return (
      <div className="notes-workspace">
        <h1>Note</h1>
        {active.error || archived.error || trashed.error ? (
          <NotesLoadError retry={() => void refresh()} />
        ) : (
          <LoadingSkeleton preset="list" />
        )}
      </div>
    );
  let label: string | undefined;
  if (pathname.startsWith("/notes/label/")) {
    try {
      label = decodeURIComponent(pathname.slice("/notes/label/".length));
    } catch {
      label = "";
    }
  }
  return (
    <>
      <NotesGrid
        view={
          pathname === "/notes/reminders"
            ? "reminders"
            : pathname === "/notes/archive"
              ? "archived"
              : pathname === "/notes/trash"
                ? "trashed"
                : pathname === "/notes/search"
                  ? "search"
                  : label !== undefined
                    ? "label"
                    : "active"
        }
        {...(label === undefined ? {} : { label })}
        query={query}
      />
      {reference && selected && !invalid && <NoteDialog key={reference} note={selected} />}
    </>
  );
}
function NotesChrome({ children }: { children: ReactNode }) {
  const { store, session, refresh, prefs, updatePrefs, notes, openNote } = useNotesContext();
  useNoteReminders(
    session.webId,
    notes,
    (note) => openNote(note, document.getElementById("main-content") ?? document.body),
    store,
  );
  useEffect(() => {
    const key = `suite.notes.purged.${session.webId}.${store.containers.active}`;
    if (purged.has(key)) return;
    purged.add(key);
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, "1");
    } catch {
      /* The tab marker remains effective. */
    }
    void store.purgeTrash(30).then(
      (result) => {
        if (result.failed.length) toast.error("Couldn't delete some expired notes from Trash");
        if (result.deleted.length) void refresh();
      },
      () => toast.error("Couldn't clear expired notes from Trash"),
    );
  }, [store, session.webId, refresh]);
  return (
    <SuiteFrame
      app="notes"
      sidebar={<NotesSidebar />}
      search={{ placeholder: "Search notes", action: "/notes/search", scopeLabel: "in Notes" }}
      actions={
        <IconButton
          label={prefs.view === "grid" ? "List view" : "Grid view"}
          variant="ghost"
          aria-pressed={prefs.view === "list"}
          onClick={() =>
            updatePrefs((value) => ({ ...value, view: value.view === "grid" ? "list" : "grid" }))
          }
        >
          {prefs.view === "grid" ? (
            <List size={20} aria-hidden="true" />
          ) : (
            <Grid2X2 size={20} aria-hidden="true" />
          )}
        </IconButton>
      }
    >
      <NotesRoutes />
      {children}
    </SuiteFrame>
  );
}
function SessionGate({ children }: { children: ReactNode }) {
  const state = usePodSessionState();
  if (state.status === "loading")
    return (
      <div className="notes-boot" role="status">
        Opening your Notes…
      </div>
    );
  if (state.status === "error")
    return (
      <div className="notes-boot">
        <h1>Can't open your Notes</h1>
        <NotesLoadError retry={() => location.reload()} />
      </div>
    );
  // Native builds start signed out until native sign-in lands.
  if (state.status === "signed-out")
    return (
      <div className="notes-boot">
        <h1>Notes</h1>
        <p role="status">Sign in to open your Notes</p>
      </div>
    );
  return (
    <NotesProvider key={state.session.webId} session={state.session}>
      <NotesChrome>{children}</NotesChrome>
    </NotesProvider>
  );
}
export function NotesApp({ children }: { children: ReactNode }) {
  return (
    <PodSessionProvider>
      <SessionGate>{children}</SessionGate>
      <Toaster position="bottom-center" />
    </PodSessionProvider>
  );
}
