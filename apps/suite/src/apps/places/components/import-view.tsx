// AUTHORED-BY Codex (GPT-6.1 Sol)
"use client";
import type { TimelineImport } from "@jeswr/solid-places";
import { Button, EmptyState, Input, Label, toast } from "@jeswr/suite-ui";
import { FileUp, ShieldCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { readTimeline } from "../lib/import-worker";
import type { PlacesController } from "../state/controller";
export function ImportView({
  controller,
  offline,
}: {
  controller: PlacesController;
  offline: boolean;
}) {
  const [preview, setPreview] = useState<TimelineImport | null>(null);
  const [stage, setStage] = useState<"idle" | "reading" | "saving" | "done">("idle");
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [error, setError] = useState("");
  const [filename, setFilename] = useState("");
  const operation = useRef<AbortController | null>(null);
  useEffect(() => () => operation.current?.abort(), []);
  const read = async (file: File) => {
    operation.current?.abort();
    const active = new AbortController();
    operation.current = active;
    setPreview(null);
    setError("");
    setStage("reading");
    setFilename(file.name);
    try {
      const parsed = await readTimeline(file, active.signal);
      if (operation.current === active && !active.signal.aborted) {
        setPreview(parsed);
        setStage("idle");
      }
    } catch (reason) {
      if (operation.current !== active) return;
      setStage("idle");
      setError(
        active.signal.aborted
          ? "Reading cancelled."
          : reason instanceof Error
            ? reason.message
            : "Could not read this file.",
      );
    }
  };
  const importPreview = async () => {
    if (!preview || offline) return;
    const active = new AbortController();
    operation.current = active;
    setStage("saving");
    setError("");
    try {
      await controller.importTimeline(
        preview,
        (done, total) => {
          if (!active.signal.aborted) setProgress({ done, total });
        },
        active.signal,
      );
      if (!active.signal.aborted) {
        setStage("done");
        toast.success("Your history is home in your pod.");
      }
    } catch {
      if (!active.signal.aborted)
        toast.error("Some history could not be saved. You can safely retry this file.");
      setStage("idle");
      setError(
        active.signal.aborted
          ? "Import cancelled. Records already saved are kept; re-importing this file will skip them."
          : "The import stopped. Records already saved are kept. Reconnect or check your private storage, then retry.",
      );
    }
  };
  const busy = stage === "reading" || stage === "saving";
  return (
    <section aria-label="Import location history">
      <div className="pl-import-card">
        <FileUp size={32} aria-hidden="true" />
        <h3>Your history, on your terms</h3>
        <p>
          Choose Timeline.json from your on-device export, or a monthly JSON file from Google
          Takeout’s Semantic Location History.
        </p>
        <p className="pl-muted">
          For a Takeout zip, extract it first and choose a JSON file. Up to 32 MiB and 50,000
          records per file. We don’t upload the export to a service.
        </p>
        <Label htmlFor="pl-timeline-file">Google Timeline JSON file</Label>
        <Input
          id="pl-timeline-file"
          type="file"
          accept=".json,application/json"
          disabled={busy}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void read(file);
            event.target.value = "";
          }}
        />
        <p className="pl-private-copy">
          <ShieldCheck size={16} aria-hidden="true" />
          Processed in your browser. Saved only to your private pod.
        </p>
      </div>
      <div role="status" aria-live="polite" className="pl-import-status">
        {stage === "reading"
          ? `Reading ${filename}…`
          : stage === "saving"
            ? `Saving ${progress.done} of ${progress.total} records…`
            : stage === "done"
              ? "Import complete. Open Timeline or Places to explore."
              : ""}
      </div>
      {busy && (
        <Button variant="outline" onClick={() => operation.current?.abort()}>
          Cancel {stage === "reading" ? "reading" : "import"}
        </Button>
      )}
      {stage === "saving" && (
        <progress
          aria-label="Import progress"
          max={Math.max(1, progress.total)}
          value={progress.done}
        />
      )}
      {error && (
        <p role="alert" className="pl-notice">
          {error}
        </p>
      )}
      {preview && (
        <div className="pl-preview">
          <h3>Preview · {filename}</h3>
          <div className="pl-stats">
            <article>
              <p>Places</p>
              <strong>{preview.places.length}</strong>
            </article>
            <article>
              <p>Visits</p>
              <strong>{preview.visits.length}</strong>
            </article>
            <article>
              <p>Journeys</p>
              <strong>{preview.journeys.length}</strong>
            </article>
          </div>
          <p className="pl-muted">
            {preview.skipped} unsupported or invalid records skipped. These counts describe this
            file. Previously imported records are kept, including your names, notes and saved
            places.
          </p>
          {preview.places.length + preview.visits.length + preview.journeys.length === 0 ? (
            <EmptyState
              title="No history found in this file"
              body="Choose a different Timeline JSON file. Invalid dates or coordinates are skipped."
            />
          ) : (
            <Button
              disabled={offline || busy || stage === "done"}
              onClick={() => void importPreview()}
            >
              {stage === "done" ? "Imported" : "Import into my private pod"}
            </Button>
          )}
        </div>
      )}
      {offline && (
        <p className="pl-muted">
          You can preview a file offline. Reconnect before importing it into your pod.
        </p>
      )}
    </section>
  );
}
