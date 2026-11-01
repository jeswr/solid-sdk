// AUTHORED-BY Codex GPT-6
"use client";
import { useState } from "react";
import { artworkUrl } from "../lib/model";
import { useMusic } from "../state/music-context";
export function Artwork({ name, image }: { name: string; image?: string | undefined }) {
  const music = useMusic();
  const [failed, setFailed] = useState<string>();
  const url = music.snapshot ? artworkUrl(image, music.snapshot.preferences.value) : undefined;
  const tone = Array.from(name).reduce((sum, char) => sum + (char.codePointAt(0) ?? 0), 0) % 3;
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
