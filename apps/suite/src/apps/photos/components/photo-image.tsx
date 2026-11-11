// AUTHORED-BY Codex GPT-6
"use client";
import { createPodScopedFetch } from "@jeswr/guarded-fetch";
import { ImageOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { usePhotos } from "../state/photos-context";

export function usePhotoUrl(url: string | undefined, media: "image" | "video" = "image") {
  const { session } = usePhotos();
  const [state, setState] = useState<{
    key: string;
    url?: string;
    size?: number;
    error?: boolean;
  }>();
  const [attempt, setAttempt] = useState(0);
  const key = `${media}:${attempt}:${url}`;
  useEffect(() => {
    if (!url) return;
    let live = true;
    let objectUrl: string | undefined;
    const controller = new AbortController();
    const fetch = createPodScopedFetch(session.storageUrl, { fetch: session.fetch });
    void fetch(url, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Media unavailable");
        const blob = await response.blob();
        if (!blob.type.startsWith(`${media}/`)) throw new Error("Unexpected media type");
        if (!live) return;
        objectUrl = URL.createObjectURL(blob);
        setState({ key, url: objectUrl, size: blob.size });
      })
      .catch(() => {
        if (live) setState({ key, error: true });
      });
    return () => {
      live = false;
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url, session, key, media]);
  return { ...(state?.key === key ? state : {}), retry: () => setAttempt((value) => value + 1) };
}
export function PhotoImage({ url, name }: { url: string | undefined; name: string }) {
  const frame = useRef<HTMLSpanElement>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const node = frame.current;
    if (!node) return;
    if (typeof IntersectionObserver === "undefined") {
      setNear(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setNear(true);
          observer.disconnect();
        }
      },
      { rootMargin: "400px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const image = usePhotoUrl(near ? url : undefined);
  const [broken, setBroken] = useState<string>();
  return (
    <span className="pho-image" ref={frame}>
      {image.url && broken !== image.url ? (
        // biome-ignore lint/performance/noImgElement: authenticated object URLs must stay in this browser
        <img
          src={image.url}
          alt={name}
          loading="lazy"
          draggable={false}
          onError={() => setBroken(image.url)}
        />
      ) : (
        <span
          role="img"
          className="pho-image-placeholder"
          aria-label={
            !url || image.error || broken ? `${name}: preview unavailable` : `Loading ${name}`
          }
        >
          <ImageOff size={24} aria-hidden="true" />
        </span>
      )}
    </span>
  );
}
