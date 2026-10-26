// AUTHORED-BY Codex
"use client";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  Input,
} from "@jeswr/suite-ui";
import { useId, useRef, useState } from "react";
import { validateImportFile } from "../editor/import-document";
import type { ImportProgress, SkippedItem } from "../lib/convert/docx-import";

export function ImportDialog({
  replace = false,
  run,
  close,
}: {
  replace?: boolean;
  run: (
    file: File,
    progress: (value: ImportProgress) => void,
  ) => Promise<{ skipped: SkippedItem[]; done: () => void }>;
  close: () => void;
}) {
  // Capture before Radix moves focus into this conditionally mounted dialog.
  const invokingControl = useRef(
    typeof document === "undefined" ? null : (document.activeElement as HTMLElement | null),
  );
  const id = useId();
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ skipped: SkippedItem[]; done: () => void } | null>(null);
  const working = useRef(false);
  const start = async () => {
    if (!file || working.current) return;
    working.current = true;
    setBusy(true);
    setError("");
    try {
      validateImportFile(file);
      const imported = await run(file, setProgress);
      if (imported.skipped.length) setResult(imported);
      else {
        close();
        imported.done();
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "We couldn't import this file. Try again.");
    } finally {
      working.current = false;
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(open: boolean) => {
        if (!open && !busy) {
          close();
          result?.done();
        }
      }}
    >
      <DialogContent
        onCloseAutoFocus={(event: Event) => {
          event.preventDefault();
          if (invokingControl.current?.isConnected) invokingControl.current.focus();
        }}
        onEscapeKeyDown={(event: KeyboardEvent) => {
          if (busy) event.preventDefault();
        }}
        onInteractOutside={(event: Event) => {
          if (busy) event.preventDefault();
        }}
      >
        <DialogTitle>
          {result
            ? "Some items weren't imported"
            : replace
              ? "Import to replace document"
              : "Import document"}
        </DialogTitle>
        <DialogDescription>
          {result
            ? "Your document is ready. These unsupported items were skipped."
            : replace
              ? "Import a DOCX or Markdown file to replace this document's contents. You can undo the replacement."
              : "Upload a DOCX or Markdown file (50 MB maximum) to create a document."}
        </DialogDescription>
        {result ? (
          <ul>
            {result.skipped.map((item) => (
              <li key={item.label}>
                {item.label} ({item.count}) weren't imported
              </li>
            ))}
          </ul>
        ) : (
          <>
            <label htmlFor={id}>Document file</label>
            <Input
              id={id}
              type="file"
              accept=".docx,.md,.markdown"
              disabled={busy}
              aria-describedby={`${id}-error`}
              onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                setFile(event.target.files?.[0] ?? null);
                setError("");
              }}
            />
            {busy && (
              <p role="status">
                {progress?.total
                  ? `Importing… ${progress.completed} of ${progress.total} images`
                  : "Importing…"}
              </p>
            )}
            <p id={`${id}-error`} role={error ? "alert" : undefined}>
              {error}
            </p>
          </>
        )}
        <DialogFooter>
          {result ? (
            <Button
              onClick={() => {
                close();
                result.done();
              }}
            >
              Open document
            </Button>
          ) : (
            <>
              <Button variant="outline" disabled={busy} onClick={close}>
                Cancel
              </Button>
              <Button disabled={busy || !file} onClick={() => void start()}>
                {replace ? "Replace contents" : "Import"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
