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
import { DOCX_FORMATTING_WARNING } from "../lib/convert/skipped";

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
  const afterClose = useRef<(() => void) | null>(null);
  const finish = (imported: { done: () => void }) => {
    afterClose.current = imported.done;
    close();
  };
  const start = async () => {
    if (!file || working.current) return;
    working.current = true;
    setBusy(true);
    setError("");
    try {
      validateImportFile(file);
      const imported = await run(file, setProgress);
      if (imported.skipped.length) setResult(imported);
      else finish(imported);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "We couldn't import this file. Try again.");
    } finally {
      working.current = false;
      setBusy(false);
    }
  };
  const formattingWarning = result?.skipped.some((item) => item.label === DOCX_FORMATTING_WARNING);
  const skipped = result?.skipped.filter((item) => item.label !== DOCX_FORMATTING_WARNING) ?? [];
  return (
    <Dialog
      open
      onOpenChange={(open: boolean) => {
        if (!open && !busy) {
          if (result) finish(result);
          else close();
        }
      }}
    >
      <DialogContent
        onCloseAutoFocus={(event: Event) => {
          event.preventDefault();
          const done = afterClose.current;
          afterClose.current = null;
          if (done) done();
          else if (invokingControl.current?.isConnected) invokingControl.current.focus();
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
            ? skipped.length
              ? "Some items weren't imported"
              : "Document imported"
            : replace
              ? "Import to replace document"
              : "Import document"}
        </DialogTitle>
        <DialogDescription>
          {result
            ? skipped.length
              ? "Your document is ready. These unsupported items were skipped."
              : "Your document is ready."
            : replace
              ? "Import a DOCX or Markdown file to replace this document's contents. You can undo the replacement."
              : "Upload a DOCX or Markdown file (50 MB maximum) to create a document."}
        </DialogDescription>
        {result ? (
          <>
            {formattingWarning && <p role="status">{DOCX_FORMATTING_WARNING}</p>}
            {skipped.length > 0 && (
              <ul>
                {skipped.map((item) => (
                  <li key={item.label}>
                    {item.label} ({item.count}) weren't imported
                  </li>
                ))}
              </ul>
            )}
          </>
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
            <Button onClick={() => finish(result)}>Open document</Button>
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
