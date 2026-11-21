// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
"use client";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
  formatBytes,
} from "@jeswr/suite-ui";
import { ImageMinus } from "lucide-react";
import { useRef, useState } from "react";
import { useConnectionState } from "@/shell/sync/connection-state";
import type { NoteImageCleanupPlan, NoteImageCleanupResult } from "../lib/image-cleanup";
import { useNotesContext } from "../state/notes-context";

type Phase =
  | { kind: "scanning" }
  | { kind: "review"; plan: NoteImageCleanupPlan }
  | { kind: "deleting" }
  | ({ kind: "done" } & NoteImageCleanupResult)
  | { kind: "error"; deleting: boolean };

const imageCount = (count: number, unused = false) =>
  `${count} ${unused ? "unused " : ""}${count === 1 ? "image" : "images"}`;

export function ImageCleanup() {
  const { store } = useNotesContext();
  const online = useConnectionState() === "online";
  const connection = useRef(online);
  connection.current = online;
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: "scanning" });
  const request = useRef(0);
  const busy = phase.kind === "scanning" || phase.kind === "deleting";
  const scan = async () => {
    const current = ++request.current;
    setPhase({ kind: "scanning" });
    try {
      const plan = await store.imageCleanup.scan();
      if (current === request.current) setPhase({ kind: "review", plan });
    } catch {
      if (current === request.current) setPhase({ kind: "error", deleting: false });
    }
  };
  const remove = async (plan: NoteImageCleanupPlan) => {
    setPhase({ kind: "deleting" });
    try {
      const result = await store.imageCleanup.delete(
        plan,
        () => connection.current && navigator.onLine,
      );
      setPhase({ kind: "done", ...result });
    } catch {
      setPhase({ kind: "error", deleting: true });
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value && phase.kind === "deleting") return;
        setOpen(value);
        if (value && online) void scan();
        else {
          request.current++;
          if (value) setPhase({ kind: "error", deleting: false });
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="ghost">
          <ImageMinus size={18} aria-hidden="true" />
          Clean up unused images
        </Button>
      </DialogTrigger>
      <DialogContent className="notes-image-cleanup" showCloseButton={phase.kind !== "deleting"}>
        <DialogTitle>Clean up unused images</DialogTitle>
        <DialogDescription>
          Check images against all notes, including Archive, Trash and note history. Review the size
          before permanently deleting unused images.
        </DialogDescription>
        <div aria-live="polite" aria-busy={online && busy}>
          {phase.kind === "done" ? (
            <p role={phase.stopped ? "alert" : "status"}>
              {phase.stopped === "offline"
                ? "Cleanup stopped after going offline. Scan again when you're connected to check what remains. "
                : phase.stopped
                  ? "Cleanup stopped because an image couldn't be deleted. Scan again to check what remains. "
                  : ""}
              Deleted {imageCount(phase.deleted)}. Kept {imageCount(phase.kept)}. Failed{" "}
              {imageCount(phase.failed)}.
            </p>
          ) : !online ? (
            <p role="status">You're offline. Reconnect, then scan again to check unused images.</p>
          ) : phase.kind === "scanning" ? (
            <p role="status">Checking all notes and images…</p>
          ) : phase.kind === "review" ? (
            <p role="status">
              {phase.plan.images.length === 0
                ? "No unused images found."
                : `${imageCount(phase.plan.images.length, true)} · ${formatBytes(phase.plan.totalBytes)}. Nothing has been deleted.`}
            </p>
          ) : phase.kind === "deleting" ? (
            <p role="status">Rechecking notes and deleting unused images…</p>
          ) : (
            <p role="alert">
              {phase.deleting
                ? "Couldn't safely recheck every note. Nothing was deleted. Deleted 0 images. Kept 0 images. Failed 0 images. Try scanning again."
                : "Couldn't safely check every note and image. Nothing was deleted. Try scanning again."}
            </p>
          )}
        </div>
        <div className="notes-confirm-actions">
          <Button
            variant="outline"
            disabled={phase.kind === "deleting"}
            onClick={() => {
              request.current++;
              setOpen(false);
            }}
          >
            Close
          </Button>
          {phase.kind !== "deleting" && (
            <Button
              variant="outline"
              disabled={!online || (open && busy)}
              onClick={() => void scan()}
            >
              Scan again
            </Button>
          )}
          {phase.kind === "review" && phase.plan.images.length > 0 && (
            <Button
              variant="destructive"
              disabled={!online}
              onClick={() => void remove(phase.plan)}
            >
              Delete unused images
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
