// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { useMemo } from "react";
import type { PodSession } from "@/lib/session/pod-session";
import { ShareDialog, type SharingAdapter, wacShareCapabilities } from "../../../shell/share";
import type { StoredNote } from "../lib/model/store";
import { noteHref } from "../lib/shared-note";
import { NoteSharingAdapter } from "../lib/sharing";

export function ShareNote({
  note,
  session,
  onClose,
  adapter: supplied,
}: {
  note: StoredNote;
  session: PodSession;
  onClose: () => void;
  adapter?: SharingAdapter;
}) {
  const { url, body } = note;
  const adapter = useMemo(
    () => new NoteSharingAdapter({ url, body }, session, supplied),
    [url, body, session, supplied],
  );
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
      notice={
        <>
          <p>When you save sharing changes, these Notes images also receive read access:</p>
          <ul aria-label="Images to share">
            {adapter.images.map((image) => (
              <li key={image}>{image}</li>
            ))}
          </ul>
          <p>
            Images added later need you to open Share again. Use Share listed images to give
            existing readers access. Images may also appear in other notes. Removing a collaborator
            or restricting this note leaves image access in place.
          </p>
          <p>
            Collaborators can see and edit this note's labels and reminders. Pin and colour stay
            yours. Realtime co-editing is not available.
          </p>
        </>
      }
      {...(adapter.images.length
        ? {
            additionalAction: {
              label: "Share listed images",
              run: () => adapter.shareImages(new AbortController().signal),
            },
          }
        : {})}
    />
  );
}
