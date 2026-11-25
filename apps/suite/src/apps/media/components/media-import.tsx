// AUTHORED-BY Codex (GPT-6.1 Sol)
"use client";
import {
  decodeMediaCsv,
  MAX_IMPORT_CHARS,
  type MediaEntry,
  type MediaImport,
  type MediaRecord,
  mediaImportIndex,
  mediaImportKey,
  parseGoodreadsCsv,
  parseLetterboxdCsv,
} from "@jeswr/solid-media-log";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@jeswr/suite-ui";
import { useId, useMemo, useRef, useState } from "react";
export function MediaImportDialog({
  records,
  offline,
  onClose,
  onImport,
}: {
  records: MediaRecord[];
  offline: boolean;
  onClose: () => void;
  onImport: (entries: MediaEntry[], skipped: number) => void;
}) {
  const id = useId();
  const [format, setFormat] = useState("letterboxd");
  const [result, setResult] = useState<MediaImport | null>(null);
  const [error, setError] = useState("");
  const [legacyEncoding, setLegacyEncoding] = useState(false);
  const [reading, setReading] = useState(false);
  const sequence = useRef(0);
  const known = useMemo(() => mediaImportIndex(records.map((record) => record.data)), [records]);
  const entries = result?.entries.filter((entry) => !known.has(entry)) ?? [];
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) {
          sequence.current++;
          onClose();
        }
      }}
    >
      <DialogContent className="media-dialog">
        <DialogHeader>
          <DialogTitle>Bring your library over</DialogTitle>
          <DialogDescription>
            Choose a Letterboxd CSV or Goodreads library export. Review the preview before adding
            items. Files stay in this browser.
          </DialogDescription>
        </DialogHeader>
        <div className="media-field">
          <Label htmlFor={`${id}-format`}>Export format</Label>
          <Select
            value={format}
            onValueChange={(value) => {
              sequence.current++;
              setReading(false);
              setFormat(value);
              setResult(null);
              setError("");
              setLegacyEncoding(false);
            }}
          >
            <SelectTrigger id={`${id}-format`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="letterboxd">
                Letterboxd · diary, watched, ratings or reviews
              </SelectItem>
              <SelectItem value="watchlist">Letterboxd · watchlist</SelectItem>
              <SelectItem value="goodreads">Goodreads · library</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="media-field">
          <Label htmlFor={`${id}-file`}>CSV file (up to 4 MiB, 5,000 rows)</Label>
          <Input
            key={format}
            type="file"
            id={`${id}-file`}
            accept=".csv,text/csv"
            onChange={(event) => {
              const file = event.target.files?.[0];
              const token = ++sequence.current;
              setResult(null);
              setError("");
              setLegacyEncoding(false);
              if (!file) {
                setReading(false);
                return;
              }
              if (file.size > MAX_IMPORT_CHARS) {
                setReading(false);
                setError("Choose a CSV smaller than 4 MiB");
                return;
              }
              setReading(true);
              void file
                .arrayBuffer()
                .then((buffer) => {
                  if (token !== sequence.current) return;
                  const { text, legacyEncoding } = decodeMediaCsv(new Uint8Array(buffer));
                  setLegacyEncoding(legacyEncoding);
                  setResult(
                    format === "goodreads"
                      ? parseGoodreadsCsv(text)
                      : parseLetterboxdCsv(text, format === "watchlist" ? "want" : "finished"),
                  );
                })
                .catch((error: unknown) => {
                  if (token === sequence.current)
                    setError(
                      error instanceof TypeError
                        ? error.message
                        : "Couldn't read that CSV. Try exporting it again.",
                    );
                })
                .finally(() => {
                  if (token === sequence.current) setReading(false);
                });
            }}
          />
        </div>
        {reading && <p role="status">Reading your export…</p>}
        {legacyEncoding && (
          <p role="status">
            This export uses an older text encoding. We decoded it as Windows-1252; check the
            preview before importing.
          </p>
        )}
        {error && (
          <p role="alert" className="media-form-error">
            {error}
          </p>
        )}
        {result && (
          <div className="media-import-preview">
            <p role="status">
              {entries.length} ready to import · {result.issues.length} skipped ·{" "}
              {result.entries.length - entries.length} already in your library
            </p>
            <ul>
              {entries.slice(0, 5).map((entry) => (
                <li key={`${mediaImportKey(entry)}:${entry.finished ?? ""}`}>
                  {entry.title}
                  {entry.year ? ` (${entry.year})` : ""}
                </li>
              ))}
            </ul>
            {entries.length > 5 && <p>And {entries.length - 5} more.</p>}
            {result.issues.length > 0 && (
              <details>
                <summary>Review skipped rows</summary>
                <ul>
                  {result.issues.slice(0, 30).map((issue) => (
                    <li key={issue.row}>
                      Row {issue.row}: {issue.message}
                    </li>
                  ))}
                </ul>
                {result.issues.length > 30 && <p>Showing the first 30 skipped rows.</p>}
              </details>
            )}
          </div>
        )}
        <p className="media-muted">
          Netflix, Goodreads and Steam items already imported through Home appear in your shelves
          automatically. Netflix episode titles are grouped by series; watching episodes does not
          mark a whole series finished.
        </p>
        {offline && <p role="status">Reconnect to import. Your preview stays open.</p>}
        <div className="media-dialog-actions">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={reading || !entries.length || offline}
            onClick={() =>
              onImport(
                entries,
                (result?.issues.length ?? 0) + (result?.entries.length ?? 0) - entries.length,
              )
            }
          >
            Import {entries.length || ""} {entries.length === 1 ? "item" : "items"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
