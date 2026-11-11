// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { useEffect, useRef, useState } from "react";
import { readPodImage } from "../../docs/lib/editor/image-upload";

/** Lazy authenticated bytes, with the pod URL kept out of the browser's image fetcher. */
export function NoteCover({
  src,
  alt,
  fetchImpl,
}: {
  src: string;
  alt: string;
  fetchImpl: typeof fetch;
}) {
  const ref = useRef<HTMLImageElement>(null);
  const [blob, setBlob] = useState<{ source: string; url: string }>();
  useEffect(() => {
    let alive = true;
    let started = false;
    let objectUrl: string | undefined;
    const abort = new AbortController();
    const load = () => {
      if (started) return;
      started = true;
      observer?.disconnect();
      void readPodImage(src, fetchImpl, abort.signal)
        .then((bytes) => {
          if (!alive) return;
          objectUrl = URL.createObjectURL(bytes);
          setBlob({ source: src, url: objectUrl });
        })
        .catch(() => {
          /* An unavailable cover must not interrupt the notes grid. */
        });
    };
    const observer =
      typeof IntersectionObserver === "undefined"
        ? undefined
        : new IntersectionObserver((entries) => {
            if (entries.some((entry) => entry.isIntersecting)) load();
          });
    if (observer && ref.current) observer.observe(ref.current);
    else load();
    return () => {
      alive = false;
      observer?.disconnect();
      abort.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [src, fetchImpl]);
  // Authenticated bytes cannot be loaded by Next’s image proxy.
  return (
    // biome-ignore lint/performance/noImgElement: authenticated blob URL
    <img
      ref={ref}
      className="notes-card-cover"
      src={blob?.source === src ? blob.url : undefined}
      alt={alt}
      loading="lazy"
    />
  );
}
