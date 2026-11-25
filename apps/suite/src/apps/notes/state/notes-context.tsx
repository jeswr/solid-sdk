// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
"use client";
import { isDirectChild } from "@jeswr/solid-docs/layout";
import { toast } from "@jeswr/suite-ui";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { encodeRef } from "@/lib/refs";
import type { PodSession } from "@/lib/session/pod-session";
import { NoteFailures } from "../components/note-failures";
import { ShareNote } from "../components/share-note";
import { NoteMoveBlockedError } from "../lib/model/errors";
import { type NoteColour, rekeyPreferences, togglePinned } from "../lib/model/prefs";
import {
  createNotesStore,
  type NoteChanges,
  type NoteFailure,
  type StoredNote,
} from "../lib/model/store";
import { discoverNoteShares } from "../lib/sharing";
import { getPendingDrafts } from "./draft-registry";
import { useNotesMutations } from "./mutations";
import { useNotesPreferences } from "./prefs";
import { useNotes } from "./use-notes";

function useNotesValue(session: PodSession) {
  const store = useMemo(
    () =>
      createNotesStore({
        fetch: session.fetch,
        podRoot: session.storageUrl,
        webId: session.webId,
      }),
    [session],
  );
  const [prefs, updatePrefs] = useNotesPreferences(session.webId);
  const [sharedNotes, setSharedNotes] = useState<Record<string, boolean>>({});
  const [shareRevision, setShareRevision] = useState(0);
  const [sharing, setSharing] = useState<StoredNote>();
  const [batchFailures, setBatchFailures] = useState<NoteFailure[]>([]);
  const active = useNotes(store, { location: "active" });
  const archived = useNotes(store, { location: "archived" });
  const trashed = useNotes(store, { location: "trashed" });
  const refresh = useCallback(async () => {
    await Promise.all([active.refresh(), archived.refresh(), trashed.refresh()]);
  }, [active.refresh, archived.refresh, trashed.refresh]);
  const mutations = useNotesMutations(store, refresh);
  const pending = getPendingDrafts(session.webId);
  const [, redrawDrafts] = useState(0);
  useEffect(() => {
    const unsubscribe = pending.subscribe((_url, saved) => {
      redrawDrafts((value) => value + 1);
      if (saved) void refresh();
    });
    for (const entry of pending.all()) {
      if (
        Object.values(store.containers).some((container) =>
          isDirectChild(entry.note.url, container),
        )
      )
        pending.bind(entry.note, (...args) => store.save(...args));
    }
    void pending.retry();
    return unsubscribe;
  }, [pending, store, refresh]);
  const projected = mutations.project([
    ...(active.data ?? []),
    ...(archived.data ?? []),
    ...(trashed.data ?? []),
  ]);
  const recovered = pending
    .all()
    .filter((entry) =>
      Object.values(store.containers).some((container) => isDirectChild(entry.note.url, container)),
    );
  const notes = [
    ...projected.filter((note) => !recovered.some((entry) => entry.note.url === note.url)),
    ...recovered.map(({ note, draft }) => {
      const current = projected.find((item) => item.url === note.url);
      const freshPermission =
        current?.readOnly !== undefined &&
        current.localGeneration !== undefined &&
        current.localGeneration > (note.localGeneration ?? -1);
      return { ...note, ...draft, ...(freshPermission ? { readOnly: current.readOnly } : {}) };
    }),
  ];
  const shareUrls = JSON.stringify(
    notes.filter((note) => note.etag !== null).map((note) => note.url),
  );
  // Discovery runs after rendering the list, never as part of its loading state.
  // biome-ignore lint/correctness/useExhaustiveDependencies: shareRevision explicitly invalidates ACL knowledge after the dialog closes
  useEffect(() => {
    const controller = new AbortController();
    setSharedNotes({});
    void discoverNoteShares(JSON.parse(shareUrls), session, controller.signal, (url, shared) => {
      setSharedNotes((current) => ({ ...current, [url]: shared }));
    });
    return () => controller.abort();
  }, [shareUrls, session, shareRevision]);
  const router = useRouter();
  const pathname = usePathname();
  const query = useSearchParams().toString();
  const opener = useRef<HTMLElement | null>(null);
  const pendingFrom = useRef<string | undefined>(undefined);
  const [extraLabels, setExtraLabels] = useState<string[]>([]);
  const labelsKey = `suite.notes.labels.${session.webId}`;
  useEffect(() => {
    try {
      const parsed: unknown = JSON.parse(localStorage.getItem(labelsKey) ?? "[]");
      if (Array.isArray(parsed))
        setExtraLabels(
          parsed.filter((label): label is string => typeof label === "string" && !!label.trim()),
        );
    } catch {
      /* The notes themselves still supply their labels. */
    }
  }, [labelsKey]);
  const persistLabels = (labels: string[]) => {
    setExtraLabels(labels);
    try {
      localStorage.setItem(labelsKey, JSON.stringify(labels));
    } catch {
      toast.error("Couldn't remember unused labels on this device");
    }
  };
  const labels = [
    ...new Set([
      ...extraLabels,
      ...notes.filter((note) => note.location !== "trashed").flatMap((note) => note.labels),
    ]),
  ].sort((a, b) => a.localeCompare(b));
  useEffect(() => {
    if (pathname.startsWith("/notes/n/") && pendingFrom.current) {
      history.replaceState({ ...history.state, from: pendingFrom.current }, "");
      pendingFrom.current = undefined;
    }
  }, [pathname]);
  const openNote = (note: StoredNote, element: HTMLElement) => {
    opener.current = element;
    pendingFrom.current = `${pathname}${query ? `?${query}` : ""}`;
    router.push(`/notes/n/${encodeRef(note.url)}`, { scroll: false });
  };
  const closeNote = () => {
    const from: unknown = history.state?.from;
    router.push(
      typeof from === "string" &&
        /^\/notes(?:\/(?:archive|trash|search|reminders|label\/[^/?#]+))?(?:\?[^#]*)?$/.test(from)
        ? from
        : "/notes",
      { scroll: false },
    );
  };
  const pin = (url: string) => updatePrefs((value) => togglePinned(value, url));
  const colour = (url: string, value: NoteColour) =>
    updatePrefs((prefs) => ({ ...prefs, colours: { ...prefs.colours, [url]: value } }));
  const move = async (note: StoredNote, action: "archive" | "unarchive" | "trash" | "restore") => {
    // Cards can act on a draft whose dialog has already unmounted. Finish that
    // writer before moving its URL, so it cannot recreate the old source later.
    const saved = await pending.flush(note, (...args) => store.save(...args));
    const moved = await mutations[action](saved);
    updatePrefs((value) => rekeyPreferences(value, note.url, moved.url));
    return moved;
  };
  const openShare = (url: string) => {
    void store.read(url).then(
      (note) => {
        if (note) setSharing(note);
        else toast.error("This note isn't here any more");
      },
      () => toast.error("Couldn't open sharing for this note"),
    );
  };
  const reportError = (error: NoteMoveBlockedError) => {
    toast.error(error.message, {
      action: { label: "Share", onClick: () => openShare(error.url) },
    });
  };
  const attempt = (work: () => Promise<unknown>, message = "Couldn't update this note") => {
    void work().catch((error) => {
      if (error instanceof NoteMoveBlockedError) reportError(error);
      else
        toast.error(message, { action: { label: "Retry", onClick: () => attempt(work, message) } });
    });
  };
  const moveMany = async (selected: readonly StoredNote[], action: "archive" | "trash") => {
    const moved: StoredNote[] = [];
    const failed: NoteFailure[] = [];
    for (const note of selected) {
      try {
        moved.push(await move(note, action));
      } catch (error) {
        failed.push({ url: note.url, error });
      }
    }
    setBatchFailures(failed);
    return { moved, failed };
  };
  const create = async (input: NoteChanges, pinned: boolean, value: NoteColour) => {
    const note = await mutations.create(input);
    updatePrefs((prefs) => ({
      ...prefs,
      pinned: pinned ? [...prefs.pinned, note.url] : prefs.pinned,
      colours: { ...prefs.colours, [note.url]: value },
    }));
    return note;
  };
  return {
    session,
    store,
    prefs,
    updatePrefs,
    active,
    archived,
    trashed,
    notes,
    refresh,
    mutations,
    labels,
    persistLabels,
    extraLabels,
    openNote,
    closeNote,
    opener,
    pin,
    colour,
    move,
    moveMany,
    attempt,
    reportError,
    openShare,
    sharing,
    batchFailures,
    closeShare: () => {
      setSharing(undefined);
      setShareRevision((value) => value + 1);
    },
    create,
    sharedNotes,
    refreshSharing: () => setShareRevision((value) => value + 1),
  };
}
type NotesContextValue = ReturnType<typeof useNotesValue>;
const Context = createContext<NotesContextValue | null>(null);
export function NotesProvider({ session, children }: { session: PodSession; children: ReactNode }) {
  const value = useNotesValue(session);
  return (
    <Context value={value}>
      {children}
      <NoteFailures failures={value.batchFailures} />
      {value.sharing && (
        <ShareNote note={value.sharing} session={session} onClose={value.closeShare} />
      )}
    </Context>
  );
}
export function useNotesContext() {
  const value = useContext(Context);
  if (!value) throw new Error("NotesProvider is required");
  return value;
}
