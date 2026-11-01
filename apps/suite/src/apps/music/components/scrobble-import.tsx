// AUTHORED-BY Claude Opus 5.5
"use client";
import { Button } from "@jeswr/suite-ui";
import { FileUp, History, LockKeyhole } from "lucide-react";
import Link from "next/link";
import { useId, useState } from "react";
import {
  planScrobbleImport,
  readScrobbleFiles,
  type ScrobblePlan,
  scrobbleErrorMessage,
} from "../lib/data/scrobbles";
import { useMusic } from "../state/music-context";
import { MusicSurface } from "./music-app";

const count = (value: number, noun: string) =>
  `${value.toLocaleString("en")} ${noun}${value === 1 ? "" : "s"}`;
const day = (date: Date) =>
  date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });

type Phase =
  | { name: "idle" }
  | { name: "reading" }
  | { name: "preview"; plan: ScrobblePlan }
  | { name: "saving"; plan: ScrobblePlan; done: number; total: number }
  | { name: "done"; added: number; existing: number };

function Importer() {
  const music = useMusic();
  const inputId = useId();
  const errorId = useId();
  const [phase, setPhase] = useState<Phase>({ name: "idle" });
  const [error, setError] = useState<{ text: string; attempt: number }>();
  const fail = (text: string) =>
    setError((current) => ({ text, attempt: (current?.attempt ?? 0) + 1 }));
  const library = music.snapshot?.library;
  const busy = phase.name === "reading" || phase.name === "saving";

  async function choose(list: FileList | null) {
    const files = Array.from(list ?? []);
    if (!files.length || !library) return;
    setError(undefined);
    setPhase({ name: "reading" });
    try {
      const texts = await Promise.all(
        files.map(async (file) => ({ name: file.name, text: await file.text() })),
      );
      const { listens, warnings } = readScrobbleFiles(texts, new Date());
      if (!listens.length) {
        setPhase({ name: "idle" });
        fail("No listens were found in that export.");
        return;
      }
      setPhase({
        name: "preview",
        plan: planScrobbleImport(listens, warnings, library.tracks, music.storage),
      });
    } catch (cause) {
      setPhase({ name: "idle" });
      fail(scrobbleErrorMessage(cause));
    }
  }

  async function save(plan: ScrobblePlan) {
    setError(undefined);
    setPhase({ name: "saving", plan, done: 0, total: 0 });
    try {
      const result = await music.importListens(plan, (done, total) =>
        setPhase({ name: "saving", plan, done, total }),
      );
      setPhase({ name: "done", ...result });
    } catch {
      setPhase({ name: "preview", plan });
      fail(
        "Some listens couldn't be saved. Months that finished are kept; import the same files again to finish.",
      );
    }
  }

  return (
    <section className="mus-import" aria-labelledby="mus-import-title">
      <span className="mus-import-icon">
        <FileUp size={24} aria-hidden="true" />
      </span>
      <h2 id="mus-import-title">Last.fm and ListenBrainz</h2>
      <p className="mus-muted">
        Bring in years of listening. Plays count towards your history and top artists. Songs that
        aren&apos;t in your library are kept by name.
      </p>
      <ul className="mus-import-help mus-muted">
        <li>
          <strong>ListenBrainz:</strong> the listens files from your ListenBrainz export (.json or
          .jsonl). You can choose several monthly files at once.
        </li>
        <li>
          <strong>Last.fm:</strong> a .csv file with artist, album, track and timestamp columns.
        </li>
      </ul>
      {(phase.name === "idle" || phase.name === "reading") && (
        <div className="mus-import-pick">
          <label htmlFor={inputId}>Choose export files</label>
          <input
            id={inputId}
            type="file"
            multiple
            accept=".csv,.json,.jsonl,text/csv,application/json"
            disabled={busy || !library}
            aria-describedby={error ? errorId : undefined}
            onChange={(event) => {
              const files = event.target.files;
              void choose(files).finally(() => {
                event.target.value = "";
              });
            }}
          />
        </div>
      )}
      <div role="status" aria-atomic="true" className="mus-import-status">
        {phase.name === "reading" && <p>Reading your export…</p>}
        {phase.name === "preview" && (
          <div className="mus-import-preview">
            <h3>Ready to import</h3>
            <p>
              {count(phase.plan.plays.length, "listen")}
              {phase.plan.first && phase.plan.last
                ? ` from ${day(phase.plan.first)} to ${day(phase.plan.last)}`
                : ""}
            </p>
            <dl>
              <div>
                <dt>Songs in your library</dt>
                <dd>{phase.plan.matched.toLocaleString("en")}</dd>
              </div>
              <div>
                <dt>Kept by name</dt>
                <dd>{phase.plan.unmatched.toLocaleString("en")}</dd>
              </div>
              {phase.plan.warnings.length > 0 && (
                <div>
                  <dt>Rows skipped</dt>
                  <dd>{phase.plan.warnings.length.toLocaleString("en")}</dd>
                </div>
              )}
            </dl>
            {phase.plan.warnings.length > 0 && (
              <details>
                <summary>Why rows were skipped</summary>
                <ul className="mus-muted">
                  {phase.plan.warnings.slice(0, 20).map((warning) => (
                    <li key={`${warning.source}-${warning.line}-${warning.code}`}>
                      {warning.source === "lastfm" ? "Last.fm" : "ListenBrainz"} line {warning.line}
                      : {warning.message}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
        {phase.name === "saving" && (
          <div className="mus-import-preview">
            <p>
              {phase.total
                ? `Saving month ${phase.done} of ${phase.total}…`
                : "Saving your listens…"}
            </p>
            <progress
              aria-label="Import progress"
              max={phase.total || 1}
              value={phase.total ? phase.done : 0}
            />
          </div>
        )}
        {phase.name === "done" && (
          <div className="mus-import-preview">
            <h3>Import finished</h3>
            <p>
              Added {count(phase.added, "listen")}.
              {phase.existing ? ` ${count(phase.existing, "listen")} were already in Music.` : ""}{" "}
              History shows the last year; use Load older history for earlier listens.
            </p>
          </div>
        )}
      </div>
      {error && (
        <p key={error.attempt} id={errorId} role="alert" className="mus-import-error">
          {error.text}
        </p>
      )}
      <div className="mus-import-actions">
        {phase.name === "preview" && (
          <>
            <Button onClick={() => void save(phase.plan)}>
              Import {count(phase.plan.plays.length, "listen")}
            </Button>
            <Button variant="outline" onClick={() => setPhase({ name: "idle" })}>
              Choose different files
            </Button>
          </>
        )}
        {phase.name === "done" && (
          <>
            <Button asChild>
              <Link href="/music/history">
                <History size={16} aria-hidden="true" />
                View history
              </Link>
            </Button>
            <Button variant="outline" onClick={() => setPhase({ name: "idle" })}>
              Import more
            </Button>
          </>
        )}
      </div>
      <p className="mus-import-note mus-muted">
        <LockKeyhole size={16} aria-hidden="true" />
        Files are read on this device and saved only to your pod.
      </p>
    </section>
  );
}

export function ScrobbleImport() {
  return (
    <>
      <header className="mus-page-header">
        <div>
          <p className="mus-eyebrow">Your library</p>
          <h1>Import listening history</h1>
        </div>
      </header>
      <MusicSurface>
        <Importer />
      </MusicSurface>
    </>
  );
}
