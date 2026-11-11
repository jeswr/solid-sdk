// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { useMemo, useRef } from "react";
import type { PodSession } from "@/lib/session/pod-session";
import { ShareDialog, type SharingAdapter, wacShareCapabilities } from "../../../shell/share";
import type { NotesStore, StoredNote } from "../lib/model/store";
import { noteHref } from "../lib/shared-note";
import { NoteSharingAdapter } from "../lib/sharing";

export function ShareNote({
  note,
  session,
  onClose,
  adapter: supplied,
  store,
  onPrepared,
}: {
  note: StoredNote;
  session: PodSession;
  onClose: () => void;
  adapter?: SharingAdapter;
  store?: NotesStore;
  onPrepared?: (note: StoredNote) => void;
}) {
  const latest = useRef(note);
  latest.current = note;
  const callback = useRef(onPrepared);
  callback.current = onPrepared;
  const { url, body } = note;
  const adapter = useMemo(() => {
    let prepared = false;
    return new NoteSharingAdapter({ url, body }, session, supplied, async () => {
      if (store && !prepared) {
        const saved = await store.prepareSharing(latest.current);
        prepared = true;
        callback.current?.(saved);
      }
    });
  }, [url, body, session, supplied, store]);
  return (
    <ShareDialog
      open
      onOpenChange={onClose}
      url={note.url}
      name={note.title || "Untitled note"}
      kind="document"
      adapter={adapter}
      caps={wacShareCapabilities}
      suiteHref={new URL(noteHref(note.url), window.location.href).href}
      notice="Referenced Notes images receive read access only. Images may also appear in other notes. Removing a collaborator or restricting this note leaves image access in place. Labels, pin, colour and reminders stay yours. Realtime co-editing is not available."
    />
  );
}
