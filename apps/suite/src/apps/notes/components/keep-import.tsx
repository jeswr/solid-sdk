// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
"use client";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Progress,
  toast,
} from "@jeswr/suite-ui";
import { FileJson, FolderOpen } from "lucide-react";
import { useRef, useState } from "react";
import {
  KEEP_SKIP_REASONS,
  type KeepImportItem,
  type KeepImportPlan,
  type KeepNoteFile,
  keepFingerprint,
  MAX_KEEP_NOTE_BYTES,
  planKeepImport,
} from "../lib/keep";
import type { NoteFailure, StoredNote } from "../lib/model/store";
import { useNotesContext } from "../state/notes-context";
import { NoteFailures } from "./note-failures";

type Phase =
  | { kind: "choose"; reading?: boolean }
  | { kind: "review"; plan: KeepImportPlan }
  | { kind: "importing"; total: number; done: number; stopping: boolean }
  | {
      kind: "finished";
      imported: number;
      failed: KeepImportItem[];
      remaining: KeepImportItem[];
      unarchived: number;
      archiveFailures: NoteFailure[];
    };

const plural = (count: number, one: string, many = `${one}s`) =>
  `${count.toLocaleString()} ${count === 1 ? one : many}`;

/** Read only the small JSON files of a selection; Takeout also includes HTML copies and media. */
async function readSelection(list: FileList) {
  const files: KeepNoteFile[] = [];
  const oversized: { fileName: string; reason: string }[] = [];
  let ignored = 0;
  const media = new Map<string, File>();
  for (const file of Array.from(list)) {
    const fileName = file.webkitRelativePath || file.name;
    if (!/\.json$/i.test(file.name)) {
      media.set(fileName, file);
      ignored++;
    } else if (file.size > MAX_KEEP_NOTE_BYTES)
      oversized.push({ fileName, reason: KEEP_SKIP_REASONS.NOTE_TOO_LARGE });
    else files.push({ fileName, json: await file.text() });
  }
  return { files, oversized, ignored, media };
}

export function KeepImportDialog({ open, close }: { open: boolean; close: () => void }) {
  const { notes, store, updatePrefs, refresh, active, archived, trashed } = useNotesContext();
  const lists = [active, archived, trashed];
  // Duplicates are found against every note, so wait until all three lists have loaded.
  const failedLists = lists.some((list) => list.error !== undefined);
  const loaded = lists.every((list) => list.data !== undefined && list.error === undefined);
  const [phase, setPhase] = useState<Phase>({ kind: "choose" });
  const stopped = useRef(false);
  const filesInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);

  const choose = async (list: FileList | null) => {
    if (!list?.length) return;
    setPhase({ kind: "choose", reading: true });
    try {
      const { files, oversized, ignored, media } = await readSelection(list);
      const plan = planKeepImport(
        files,
        notes.filter((note) => note.location !== "trashed"),
        media,
      );
      setPhase({
        kind: "review",
        plan: {
          ...plan,
          skipped: [...oversized, ...plan.skipped],
          ignored: Math.max(
            0,
            plan.ignored +
              ignored -
              plan.ready.reduce((sum, item) => sum + (item.images?.length ?? 0), 0),
          ),
        },
      });
    } catch {
      setPhase({ kind: "choose" });
      toast.error("Couldn't read those files. Try choosing them again.");
    }
  };

  const run = async (selected: readonly KeepImportItem[]) => {
    stopped.current = false;
    // A failed save may still have reached the pod: never import a note that is now there.
    const present = new Set(
      notes.filter((note) => note.location !== "trashed").map(keepFingerprint),
    );
    const items = selected.filter((item) => !present.has(keepFingerprint(item.input)));
    const failed: KeepImportItem[] = [];
    const archiveFailures: NoteFailure[] = [];
    let remaining: KeepImportItem[] = [];
    let imported = 0;
    let unarchived = 0;
    setPhase({ kind: "importing", total: items.length, done: 0, stopping: false });
    for (const [index, item] of items.entries()) {
      if (stopped.current) {
        remaining = items.slice(index);
        break;
      }
      // Write through the store and refresh the lists once at the end: the context's
      // mutations reload every note after each write, which a large import can't afford.
      let note: StoredNote;
      try {
        let body = item.input.body;
        for (const file of item.images ?? []) {
          const src = await store.uploadImage(file);
          const image = document.createElement("img");
          image.src = src;
          image.alt = "";
          body += image.outerHTML;
        }
        note = await store.create({ ...item.input, body });
        imported++;
      } catch {
        failed.push(item);
        setPhase({
          kind: "importing",
          total: items.length,
          done: index + 1,
          stopping: stopped.current,
        });
        continue;
      }
      if (item.archived)
        note = await store.archive(note).catch((error) => {
          unarchived++;
          archiveFailures.push({ url: note.url, error });
          return note;
        });
      const url = note.url;
      if (item.pinned || item.colour !== "default")
        updatePrefs((prefs) => ({
          ...prefs,
          pinned: item.pinned ? [...prefs.pinned, url] : prefs.pinned,
          colours:
            item.colour === "default" ? prefs.colours : { ...prefs.colours, [url]: item.colour },
        }));
      setPhase({
        kind: "importing",
        total: items.length,
        done: index + 1,
        stopping: stopped.current,
      });
    }
    await refresh().catch(() => undefined);
    setPhase({ kind: "finished", imported, failed, remaining, unarchived, archiveFailures });
  };

  const stop = () => {
    stopped.current = true;
    setPhase((current) =>
      current.kind === "importing" ? { ...current, stopping: true } : current,
    );
  };
  const dismiss = () => {
    if (phase.kind === "importing") {
      stop();
      return;
    }
    setPhase({ kind: "choose" });
    close();
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && dismiss()}>
      <DialogContent className="notes-keep-import">
        <DialogTitle>Import from Google Keep</DialogTitle>
        <DialogDescription>
          Choose the Keep folder from your Google Takeout download, or the note files inside it.
          Notes keeps their text, checklists, labels, colours, pins and archive state. Images
          included in a Keep folder are imported as decorative; you can add descriptions in the
          note.
        </DialogDescription>
        {phase.kind === "choose" && (
          <div className="notes-keep-choose">
            <input
              ref={folderInput}
              type="file"
              hidden
              multiple
              aria-label="Keep folder"
              {...{ webkitdirectory: "" }}
              onChange={(event) => void choose(event.target.files)}
            />
            <input
              ref={filesInput}
              type="file"
              hidden
              multiple
              accept=".json,application/json"
              aria-label="Keep note files"
              onChange={(event) => void choose(event.target.files)}
            />
            <Button
              disabled={phase.reading || !loaded}
              onClick={() => folderInput.current?.click()}
            >
              <FolderOpen size={18} aria-hidden="true" />
              Choose Keep folder
            </Button>
            <Button
              variant="outline"
              disabled={phase.reading || !loaded}
              onClick={() => filesInput.current?.click()}
            >
              <FileJson size={18} aria-hidden="true" />
              Choose note files
            </Button>
            {phase.reading && <p role="status">Reading your notes…</p>}
            {!loaded && !failedLists && <p role="status">Loading the notes you already have…</p>}
            {failedLists && (
              <p role="alert">
                Couldn't load all of your notes, so Notes can't check which ones you've already
                imported.{" "}
                <Button variant="link" onClick={() => void refresh().catch(() => undefined)}>
                  Try again
                </Button>
              </p>
            )}
          </div>
        )}
        {phase.kind === "review" && (
          <div className="notes-keep-review">
            <p role="status">
              {phase.plan.ready.length
                ? `${plural(phase.plan.ready.length, "note")} ready to import.`
                : "No notes to import from these files."}
            </p>
            <ul>
              {phase.plan.trashed > 0 && (
                <li>{plural(phase.plan.trashed, "note")} from Keep's Trash will be left out.</li>
              )}
              {phase.plan.attachments > 0 && (
                <li>
                  {plural(phase.plan.attachments, "image or recording", "images or recordings")}{" "}
                  will stay in Takeout. Choose the Keep folder to include supported images.
                </li>
              )}
              {phase.plan.adjusted > 0 && (
                <li>
                  {plural(phase.plan.adjusted, "note")} had a colour or link Notes can't use; the
                  rest of {phase.plan.adjusted === 1 ? "it" : "them"} will be imported.
                </li>
              )}
              {phase.plan.ignored > 0 && (
                <li>
                  {plural(phase.plan.ignored, "other file")} in the selection will be ignored.
                </li>
              )}
            </ul>
            {phase.plan.skipped.length > 0 && (
              <details>
                <summary>{plural(phase.plan.skipped.length, "file")} can't be imported</summary>
                <ul className="notes-keep-skipped">
                  {phase.plan.skipped.map((entry, index) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: Takeout file names can repeat.
                    <li key={index}>
                      <span>{entry.fileName}</span>: {entry.reason}
                    </li>
                  ))}
                </ul>
              </details>
            )}
            <div className="notes-keep-actions">
              <Button variant="ghost" onClick={() => setPhase({ kind: "choose" })}>
                Choose other files
              </Button>
              <Button
                disabled={!phase.plan.ready.length}
                onClick={() => void run(phase.plan.ready)}
              >
                {phase.plan.ready.length
                  ? `Import ${plural(phase.plan.ready.length, "note")}`
                  : "Import"}
              </Button>
            </div>
          </div>
        )}
        {phase.kind === "importing" && (
          <div className="notes-keep-progress">
            <p role="status">
              {phase.stopping
                ? "Stopping after this note…"
                : `Importing ${phase.done.toLocaleString()} of ${phase.total.toLocaleString()}…`}
            </p>
            <Progress value={phase.done} max={phase.total} aria-label="Import progress" />
            <Button variant="outline" disabled={phase.stopping} onClick={stop}>
              Stop
            </Button>
          </div>
        )}
        {phase.kind === "finished" && (
          <div className="notes-keep-review">
            <p role="status">
              {phase.imported
                ? `Imported ${plural(phase.imported, "note")}.`
                : "No notes were imported."}
            </p>
            {phase.unarchived > 0 && (
              <p>
                {plural(phase.unarchived, "note")} couldn't be moved to the Archive and{" "}
                {phase.unarchived === 1 ? "is" : "are"} in Notes instead.
              </p>
            )}
            <NoteFailures failures={phase.archiveFailures} />
            {phase.remaining.length > 0 && (
              <p>Stopped with {plural(phase.remaining.length, "note")} still to import.</p>
            )}
            {phase.failed.length > 0 && (
              <p role="alert">
                {plural(phase.failed.length, "note")} couldn't be saved to your pod.
              </p>
            )}
            <div className="notes-keep-actions">
              {phase.failed.length + phase.remaining.length > 0 && (
                <Button
                  variant="outline"
                  onClick={() => void run([...phase.failed, ...phase.remaining])}
                >
                  {phase.failed.length ? "Try again" : "Import the rest"}
                </Button>
              )}
              <Button onClick={dismiss}>Done</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
