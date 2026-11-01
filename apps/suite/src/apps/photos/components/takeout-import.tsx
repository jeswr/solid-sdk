// AUTHORED-BY Claude Opus 5.5
"use client";
import { Button } from "@jeswr/suite-ui";
import { FolderInput, Images, LockKeyhole } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { planTakeout, type TakeoutPlan } from "../lib/data/takeout";
import { usePhotos } from "../state/photos-context";

const count = (value: number, noun: string, plural = `${noun}s`) =>
  `${value.toLocaleString("en")} ${value === 1 ? noun : plural}`;

type Phase =
  | { name: "idle" }
  | { name: "reading" }
  | { name: "preview"; plan: TakeoutPlan }
  | { name: "saving"; plan: TakeoutPlan }
  | { name: "done"; saved: number; failed: number; albums: number };

export function TakeoutImport() {
  const photos = usePhotos();
  const inputId = useId();
  const errorId = useId();
  const stripId = useId();
  const [phase, setPhase] = useState<Phase>({ name: "idle" });
  const [error, setError] = useState<{ text: string; attempt: number }>();
  const [strip, setStrip] = useState(true);
  useEffect(() => {
    try {
      setStrip(localStorage.getItem("photos-remove-location") !== "false");
    } catch {
      /* Storage may be disabled. */
    }
  }, []);
  // Each step's first element takes focus, so keyboard users keep their place.
  const focusTarget = useRef<HTMLElement | null>(null);
  const moved = useRef(false);
  useEffect(() => {
    if (!moved.current) return;
    moved.current = false;
    focusTarget.current?.focus();
  });
  const target = (element: HTMLElement | null) => {
    focusTarget.current = element;
  };
  const go = (next: Phase) => {
    moved.current = true;
    setPhase(next);
  };
  const fail = (text: string) =>
    setError((current) => ({ text, attempt: (current?.attempt ?? 0) + 1 }));

  async function choose(list: FileList | null) {
    const files = Array.from(list ?? []);
    if (!files.length) return;
    setError(undefined);
    go({ name: "reading" });
    try {
      const plan = await planTakeout(
        files.map((file) => ({ path: file.webkitRelativePath || file.name, file })),
      );
      if (!plan.items.length) {
        go({ name: "idle" });
        fail(
          plan.videos
            ? "That folder only has videos, which Photos can't import yet."
            : "No photos were found in that folder. Choose the Google Photos folder from your Takeout download.",
        );
        return;
      }
      go({ name: "preview", plan });
    } catch {
      go({ name: "idle" });
      fail("Couldn't read that folder. Try choosing it again.");
    }
  }

  async function save(plan: TakeoutPlan) {
    setError(undefined);
    go({ name: "saving", plan });
    const result = await photos.importTakeout(plan, strip);
    go({ name: "done", ...result });
  }

  return (
    <div className="pho-page pho-takeout">
      <header className="pho-page-header">
        <div className="pho-header-text">
          <h1>Import from Google Takeout</h1>
          <p>Bring your Google Photos library into your pod, with dates, places and albums.</p>
        </div>
      </header>
      <section className="pho-takeout-card" aria-labelledby="pho-takeout-title">
        <span className="pho-takeout-icon">
          <FolderInput size={24} aria-hidden="true" />
        </span>
        <h2 id="pho-takeout-title">Google Photos folder</h2>
        <ol className="pho-takeout-steps">
          <li>
            Download Google Photos from{" "}
            <a href="https://takeout.google.com/" target="_blank" rel="noreferrer">
              Google Takeout
            </a>{" "}
            and unzip it.
          </li>
          <li>
            Choose the <strong>Google Photos</strong> folder inside it. Dates, places and captions
            come from the files next to each photo, and album folders become albums.
          </li>
        </ol>
        <div className="pho-takeout-option">
          <input
            id={stripId}
            type="checkbox"
            checked={strip}
            disabled={phase.name === "saving"}
            onChange={(event) => setStrip(event.target.checked)}
          />
          <label htmlFor={stripId}>Remove location from imported photos</label>
        </div>
        {phase.name === "idle" && (
          <div className="pho-takeout-pick">
            <label htmlFor={inputId}>Choose folder</label>
            <input
              ref={target}
              id={inputId}
              type="file"
              multiple
              {...{ webkitdirectory: "" }}
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
          <p ref={target} tabIndex={-1} className="pho-takeout-panel">
            Reading your Takeout folder…
          </p>
        )}
        {phase.name === "preview" && (
          <div className="pho-takeout-panel">
            <h3 ref={target} tabIndex={-1}>
              Ready to import
            </h3>
            <dl>
              <div>
                <dt>Photos</dt>
                <dd>{phase.plan.items.length.toLocaleString("en")}</dd>
              </div>
              <div>
                <dt>With dates, places or captions from Takeout</dt>
                <dd>{phase.plan.withDetails.toLocaleString("en")}</dd>
              </div>
              <div>
                <dt>Albums</dt>
                <dd>{phase.plan.albums.length.toLocaleString("en")}</dd>
              </div>
            </dl>
            {(phase.plan.videos > 0 || phase.plan.duplicates > 0 || phase.plan.unsupported > 0) && (
              <ul className="pho-takeout-notes">
                {phase.plan.duplicates > 0 && (
                  <li>
                    {count(phase.plan.duplicates, "copy", "copies")} of photos that are also in an
                    album will be imported once.
                  </li>
                )}
                {phase.plan.videos > 0 && (
                  <li>
                    {count(phase.plan.videos, "video")} will be left out. Photos can't store videos
                    yet.
                  </li>
                )}
                {phase.plan.unsupported > 0 && (
                  <li>{count(phase.plan.unsupported, "other file")} will be left out.</li>
                )}
              </ul>
            )}
          </div>
        )}
        {phase.name === "saving" && (
          <p ref={target} tabIndex={-1} className="pho-takeout-panel">
            Importing {count(phase.plan.items.length, "photo")}. You can follow each one in the
            upload panel.
          </p>
        )}
        {phase.name === "done" && (
          <div className="pho-takeout-panel">
            <h3 ref={target} tabIndex={-1}>
              Import finished
            </h3>
            <p>
              Imported {count(phase.saved, "photo")}
              {phase.albums ? ` into ${count(phase.albums, "album")}` : ""}.
              {phase.failed
                ? ` ${count(phase.failed, "photo")} didn't import; retry them in the upload panel.`
                : ""}
            </p>
          </div>
        )}
        {error && (
          <p key={error.attempt} id={errorId} role="alert" className="pho-takeout-error">
            {error.text}
          </p>
        )}
        {(phase.name === "preview" || phase.name === "done") && (
          <div className="pho-takeout-actions">
            {phase.name === "preview" ? (
              <>
                <Button onClick={() => void save(phase.plan)}>
                  Import {count(phase.plan.items.length, "photo")}
                </Button>
                <Button variant="outline" onClick={() => go({ name: "idle" })}>
                  Choose a different folder
                </Button>
              </>
            ) : (
              <>
                <Button asChild>
                  <Link href="/photos">
                    <Images size={16} aria-hidden="true" />
                    View photos
                  </Link>
                </Button>
                <Button variant="outline" onClick={() => go({ name: "idle" })}>
                  Import another folder
                </Button>
              </>
            )}
          </div>
        )}
        <p className="pho-takeout-note">
          <LockKeyhole size={16} aria-hidden="true" />
          Files are read on this device and saved only to your pod.
        </p>
      </section>
    </div>
  );
}
