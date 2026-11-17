// AUTHORED-BY Codex GPT-6
"use client";
import { podScopedUrl } from "@jeswr/guarded-fetch";
import { useEffect, useState } from "react";
import { usePodSessionState } from "@/lib/session/pod-session";
import { acquireCoverUrl } from "../lib/browser/object-url";
import { artworkUrl } from "../lib/model";
import { useMusic } from "../state/music-context";
export function Artwork({
  name,
  image,
  identity = name,
}: {
  name: string;
  image?: string | undefined;
  identity?: string;
}) {
  const music = useMusic();
  const [failed, setFailed] = useState<string>();
  const sessionState = usePodSessionState();
  const session = sessionState.status === "ready" ? sessionState.session : undefined;
  const local =
    image && session ? podScopedUrl(session.storageUrl, image, { allowRoot: false }) : undefined;
  const [localUrl, setLocalUrl] = useState<{ source: string; url: string }>();
  useEffect(() => {
    if (!local || !session) return;
    const cover = acquireCoverUrl(session.fetch, session.storageUrl, local);
    let live = true;
    void cover.promise
      .then((url) => {
        if (live) setLocalUrl({ source: local, url });
      })
      .catch(() => {});
    return () => {
      live = false;
      cover.release();
    };
  }, [local, session]);
  const url = local
    ? localUrl?.source === local
      ? localUrl.url
      : undefined
    : music.snapshot
      ? artworkUrl(image, music.snapshot.preferences.value)
      : undefined;
  const hash = Array.from(identity).reduce(
    (value, char) => (Math.imul(value, 31) + (char.codePointAt(0) ?? 0)) >>> 0,
    0,
  );
  const tone = hash % 6;
  return (
    <span className={`mus-artwork mus-tone-${tone}`} aria-hidden="true">
      {url && failed !== url ? (
        // biome-ignore lint/performance/noImgElement: Artwork is opt-in and must go directly to the chosen source without a proxy.
        <img
          src={url}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailed(url)}
        />
      ) : (
        <span>
          {name
            .split(/\s+/u)
            .slice(0, 2)
            .map((word) => word[0])
            .join("")
            .toUpperCase()}
        </span>
      )}
    </span>
  );
}
