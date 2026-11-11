// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { Button } from "@jeswr/suite-ui";
import { useEffect, useRef, useState } from "react";
import { durationLabel, emptyManifest, type MediaEntry, mediaUrl, parseManifest } from "./media";

const pending =
  "This video isn't ready yet. The guided walkthrough covers the same ground in the meantime.";

function VideoCard({
  id,
  title,
  summary,
  entry,
  loading,
  unavailable,
}: {
  id: string;
  title: string;
  summary: string;
  entry?: MediaEntry | undefined;
  loading: boolean;
  unavailable: boolean;
}) {
  const [duration, setDuration] = useState<number>();
  const [failed, setFailed] = useState(false);
  return (
    <article className="welcome-card welcome-video-card">
      <div className="welcome-video-screen">
        {entry?.file && !failed ? (
          // biome-ignore lint/a11y/useMediaCaption: The manifest's captions track is rendered conditionally below.
          <video
            src={mediaUrl(entry.file)}
            controls
            preload="metadata"
            playsInline
            aria-labelledby={`${id}-title`}
            data-testid={`${id}-video`}
            onLoadedMetadata={(event) => {
              if (Number.isFinite(event.currentTarget.duration))
                setDuration(event.currentTarget.duration);
            }}
            onError={() => setFailed(true)}
          >
            {entry.captions && (
              <track
                kind="captions"
                srcLang="en"
                label="English"
                src={mediaUrl(entry.captions)}
                default
              />
            )}
          </video>
        ) : (
          <p data-testid={`${id}-pending`}>
            {loading
              ? "Checking for the video..."
              : unavailable
                ? "This video can't be loaded right now. The guided walkthrough covers the same ground."
                : pending}
          </p>
        )}
      </div>
      <div className="welcome-video-copy">
        <h3 id={`${id}-title`}>{title}</h3>
        {duration !== undefined && (
          <p className="welcome-note">
            {durationLabel(duration)}
            {entry?.captions ? ", with captions" : ""}
          </p>
        )}
        <p>{summary}</p>
      </div>
    </article>
  );
}

export function FeatureClips({
  clips,
  loading = false,
  unavailable = false,
}: {
  clips: readonly MediaEntry[];
  loading?: boolean;
  unavailable?: boolean;
}) {
  const [picked, setPicked] = useState("");
  const [autoplay, setAutoplay] = useState(false);
  const [failed, setFailed] = useState<string[]>([]);
  const section = useRef<HTMLElement>(null);
  useEffect(() => {
    const fromHash = () => {
      const id = /^#clip-([a-z0-9-]+)$/.exec(location.hash)?.[1];
      if (id) {
        setPicked(id);
        setAutoplay(false);
      }
    };
    fromHash();
    addEventListener("hashchange", fromHash);
    return () => removeEventListener("hashchange", fromHash);
  }, []);
  const available = clips.filter((clip) => clip.file && !failed.includes(clip.id));
  const current = available.find((clip) => clip.id === picked) ?? available[0];
  const next = current && available[available.indexOf(current) + 1];
  useEffect(() => {
    if (current && location.hash === `#clip-${current.id}`)
      section.current?.scrollIntoView({ block: "start" });
  }, [current]);
  const choose = (id: string, play: boolean) => {
    setPicked(id);
    setAutoplay(play);
    // Keep Next's history state intact when changing only the fragment.
    history.replaceState(history.state, "", `#clip-${id}`);
  };
  return (
    <section ref={section} id="clips" className="welcome-section" aria-labelledby="clips-title">
      <h2 id="clips-title">More features</h2>
      {current?.file ? (
        <article className="welcome-card welcome-playlist">
          {/* biome-ignore lint/a11y/useMediaCaption: The manifest's captions track is rendered conditionally below. */}
          <video
            key={current.id}
            src={mediaUrl(current.file)}
            controls
            playsInline
            preload="metadata"
            autoPlay={autoplay}
            aria-labelledby="clip-title"
            data-testid="clip-video"
            onEnded={() => {
              if (next) choose(next.id, true);
            }}
            onError={() => setFailed((ids) => [...ids, current.id])}
          >
            {current.captions && (
              <track
                kind="captions"
                srcLang="en"
                label="English"
                src={mediaUrl(current.captions)}
                default
              />
            )}
          </video>
          <div className="welcome-video-copy">
            <label htmlFor="clip-picker">Choose a feature</label>
            <select
              id="clip-picker"
              value={current.id}
              onChange={(event) => choose(event.target.value, false)}
            >
              {available.map((clip) => (
                <option key={clip.id} value={clip.id}>
                  {clip.title}
                </option>
              ))}
            </select>
            <h3 id="clip-title">{current.title}</h3>
            <p>{current.summary}</p>
            {next && (
              <Button variant="outline" size="sm" onClick={() => choose(next.id, true)}>
                Next: {next.title}
              </Button>
            )}
          </div>
        </article>
      ) : (
        <div className="welcome-card welcome-pending" data-testid="clips-pending">
          {loading
            ? "Checking for the clips..."
            : unavailable
              ? "The feature clips can't be loaded right now. The guided walkthrough covers the same ground."
              : "The feature clips aren't ready yet. The guided walkthrough covers the same ground in the meantime."}
        </div>
      )}
    </section>
  );
}

export function WelcomeVideos() {
  const [manifest, setManifest] = useState(emptyManifest);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/media/manifest.json", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Media manifest unavailable");
        const value = await response.json();
        if (!controller.signal.aborted) setManifest(parseManifest(value));
      })
      .catch(() => {
        if (!controller.signal.aborted) setUnavailable(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);
  return (
    <>
      <section className="welcome-section" aria-labelledby="videos-title">
        <h2 id="videos-title">Watch first, if you like</h2>
        <p>These videos are optional. The guided walkthrough covers the same ground.</p>
        <div className="welcome-video-grid">
          <VideoCard
            id="tour"
            title="A tour of the Solid Suite"
            summary={
              manifest.videos.tour?.summary ??
              "Meet the apps and see how to decide who can see your data."
            }
            entry={manifest.videos.tour}
            loading={loading}
            unavailable={unavailable}
          />
          <VideoCard
            id="feedback"
            title="How to give feedback"
            summary={
              manifest.videos.feedback?.summary ??
              "See how to share what worked and what got in the way."
            }
            entry={manifest.videos.feedback}
            loading={loading}
            unavailable={unavailable}
          />
        </div>
      </section>
      <FeatureClips clips={manifest.clips} loading={loading} unavailable={unavailable} />
    </>
  );
}
