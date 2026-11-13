// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
"use client";
import { ErrorState, formatBytes, LoadingSkeleton } from "@jeswr/suite-ui";
import { useEffect, useRef, useState } from "react";
import type { LibraryPhoto } from "../lib/data/library";
import { usePhotoUrl } from "./photo-image";

export function VideoPlayer({ photo }: { photo: LibraryPhoto }) {
  const media = usePhotoUrl(photo.contentUrl, "video");
  const poster = usePhotoUrl(photo.thumbnailUrl);
  const video = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState<"decode" | "unreachable">();
  const [metadataTimedOut, setMetadataTimedOut] = useState(false);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (!media.url || failed) return;
    const node = video.current;
    const timer = loaded
      ? undefined
      : setTimeout(() => {
          setMetadataTimedOut(true);
          setFailed("decode");
        }, 15000);
    return () => {
      clearTimeout(timer);
      node?.pause();
    };
  }, [media.url, loaded, failed]);
  return (
    <div className="pho-viewer">
      <figure className="pho-video-stage" aria-label="Video viewer">
        {failed === "decode" ? (
          <div role="alert">
            <p>This video format can't be played in this browser</p>
            <a href={media.url} download={photo.name}>
              Download video
            </a>
            {metadataTimedOut && (
              <button
                type="button"
                onClick={() => {
                  setFailed(undefined);
                  setMetadataTimedOut(false);
                  setLoaded(false);
                }}
              >
                Retry
              </button>
            )}
          </div>
        ) : media.error || failed ? (
          <ErrorState
            error="unreachable"
            actions={{
              retry: () => {
                setFailed(undefined);
                setLoaded(false);
                if (!media.url) media.retry();
              },
            }}
          />
        ) : media.url ? (
          // biome-ignore lint/a11y/useMediaCaption: personal videos have no supplied captions; native controls remain available
          <video
            ref={video}
            src={media.url}
            poster={poster.url}
            aria-label={photo.name}
            controls
            playsInline
            preload="metadata"
            onLoadedMetadata={() => setLoaded(true)}
            onError={(event) => {
              const code = event.currentTarget.error?.code;
              setFailed(code === 3 || code === 4 ? "decode" : "unreachable");
            }}
          />
        ) : (
          <LoadingSkeleton preset="detail" label="Loading original video…" />
        )}
      </figure>
      <p className="pho-file-size">
        {media.size === undefined ? "Original video" : formatBytes(media.size)}
      </p>
    </div>
  );
}
