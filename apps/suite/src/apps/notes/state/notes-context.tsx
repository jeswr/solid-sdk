// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
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
import { type NoteColour, rekeyPreferences, togglePinned } from "../lib/model/prefs";
import { createNotesStore, type NoteChanges, type StoredNote } from "../lib/model/store";
import { useNotesMutations } from "./mutations";
import { useNotesPreferences } from "./prefs";
import { useNotes } from "./use-notes";

function useNotesValue(session: PodSession) {
  const store = useMemo(
    () =>
      createNotesStore({ fetch: session.fetch, podRoot: session.storageUrl, webId: session.webId }),
    [session],
  );
  const [prefs, updatePrefs] = useNotesPreferences(session.webId);
  const active = useNotes(store, { location: "active" });
  const archived = useNotes(store, { location: "archived" });
  const trashed = useNotes(store, { location: "trashed" });
  const refresh = useCallback(async () => {
    await Promise.all([active.refresh(), archived.refresh(), trashed.refresh()]);
  }, [active.refresh, archived.refresh, trashed.refresh]);
  const mutations = useNotesMutations(store, refresh);
  const notes = mutations.project([
    ...(active.data ?? []),
    ...(archived.data ?? []),
    ...(trashed.data ?? []),
  ]);
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
        /^\/notes(?:\/(?:archive|trash|search|label\/[^/?#]+))?(?:\?[^#]*)?$/.test(from)
        ? from
        : "/notes",
      { scroll: false },
    );
  };
  const pin = (url: string) => updatePrefs((value) => togglePinned(value, url));
  const colour = (url: string, value: NoteColour) =>
    updatePrefs((prefs) => ({ ...prefs, colours: { ...prefs.colours, [url]: value } }));
  const move = async (note: StoredNote, action: "archive" | "unarchive" | "trash" | "restore") => {
    const moved = await mutations[action](note);
    updatePrefs((value) => rekeyPreferences(value, note.url, moved.url));
    return moved;
  };
  const attempt = (work: () => Promise<unknown>, message = "Couldn't update this note") => {
    void work().catch(() =>
      toast.error(message, { action: { label: "Retry", onClick: () => attempt(work, message) } }),
    );
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
    attempt,
    create,
  };
}
type NotesContextValue = ReturnType<typeof useNotesValue>;
const Context = createContext<NotesContextValue | null>(null);
export function NotesProvider({ session, children }: { session: PodSession; children: ReactNode }) {
  return <Context value={useNotesValue(session)}>{children}</Context>;
}
export function useNotesContext() {
  const value = useContext(Context);
  if (!value) throw new Error("NotesProvider is required");
  return value;
}
