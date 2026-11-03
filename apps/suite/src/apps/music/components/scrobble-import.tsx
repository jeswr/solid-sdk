// AUTHORED-BY Claude Opus 5.5
"use client";
import { Button } from "@jeswr/suite-ui";
import { FileUp, History, LockKeyhole } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import {
  planScrobbleImport,
  readScrobbleFiles,
  type ScrobblePlan,
  saveErrorMessage,
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
/** Let the browser paint the busy state before synchronous parsing starts. */
const nextFrame = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));

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
  // Each phase's first element takes focus (and so is read out), so keyboard and
  // screen reader users keep their place when the control they used is replaced.
  const focusTarget = useRef<HTMLElement | null>(null);
  const moved = useRef(false);
  const fail = (text: string) =>
    setError((current) => ({ text, attempt: (current?.attempt ?? 0) + 1 }));
  const library = music.snapshot?.library;
  const go = (next: Phase) => {
    moved.current = true;
    setPhase(next);
  };
  useEffect(() => {
    if (!moved.current) return;
    moved.current = false;
    focusTarget.current?.focus();
  });
  const target = (element: HTMLElement | null) => {
    focusTarget.current = element;
  };

  async function choose(list: FileList | null) {
    const files = Array.from(list ?? []);
    if (!files.length || !library) return;
    setError(undefined);
    go({ name: "reading" });
    try {
      const texts = await Promise.all(
        files.map(async (file) => ({ name: file.name, text: await file.text() })),
      );
      await nextFrame();
      const { listens, warnings } = readScrobbleFiles(texts, new Date());
      if (!listens.length) {
        go({ name: "idle" });
        fail("No listens were found in that export.");
        return;
      }
      const plan = planScrobbleImport(listens, warnings, library.tracks, music.storage);
      go({ name: "preview", plan });
    } catch (cause) {
      go({ name: "idle" });
      fail(scrobbleErrorMessage(cause));
    }
  }

  async function save(plan: ScrobblePlan) {
    setError(undefined);
    go({ name: "saving", plan, done: 0, total: 0 });
    try {
      const result = await music.importListens(plan, (done, total) =>
        setPhase({ name: "saving", plan, done, total }),
      );
      go({ name: "done", ...result });
    } catch (cause) {
      go({ name: "preview", plan });
      fail(saveErrorMessage(cause));
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
      {phase.name === "idle" && (
        <div className="mus-import-pick">
          <label htmlFor={inputId}>Choose export files</label>
          <input
            ref={target}
            id={inputId}
            type="file"
            multiple
            accept=".csv,.json,.jsonl,text/csv,application/json"
            disabled={!library}
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
      {phase.name === "reading" && (
        <p ref={target} tabIndex={-1} className="mus-import-preview">
          Reading your export…
        </p>
      )}
      {phase.name === "preview" && (
        <div className="mus-import-preview">
          <h3 ref={target} tabIndex={-1}>
            Ready to import
          </h3>
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
            {phase.plan.skipped.length > 0 && (
              <div>
                <dt>Rows skipped</dt>
                <dd>{phase.plan.skipped.length.toLocaleString("en")}</dd>
              </div>
            )}
          </dl>
          {phase.plan.skipped.length > 0 && (
            <details>
              <summary>Why rows were skipped</summary>
              <ul className="mus-muted">
                {phase.plan.skipped.slice(0, 20).map((warning) => (
                  <li key={`${warning.file}\u0000${warning.line}`}>
                    {warning.file}, line {warning.line}: {warning.message}
                  </li>
                ))}
              </ul>
              {phase.plan.skipped.length > 20 && (
                <p className="mus-muted">
                  And {count(phase.plan.skipped.length - 20, "more row")}.
                </p>
              )}
            </details>
          )}
        </div>
      )}
      {phase.name === "saving" && (
        <div className="mus-import-preview">
          <p ref={target} tabIndex={-1}>
            {phase.total ? `Saving month ${phase.done} of ${phase.total}…` : "Saving your listens…"}
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
          <h3 ref={target} tabIndex={-1}>
            Import finished
          </h3>
          <p>
            Added {count(phase.added, "listen")}.
            {phase.existing ? ` ${count(phase.existing, "listen")} were already in Music.` : ""}{" "}
            History shows the last year; use Load older history for earlier listens.
          </p>
        </div>
      )}
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
            <Button variant="outline" onClick={() => go({ name: "idle" })}>
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
            <Button variant="outline" onClick={() => go({ name: "idle" })}>
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
