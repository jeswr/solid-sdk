// AUTHORED-BY Codex (GPT-6.1 Sol)
"use client";
import { Button, LoadingSkeleton } from "@jeswr/suite-ui";
import { useEffect, useState } from "react";
import { useJournal } from "../state/journal-context";

export function Photo({ url, number }: { url: string; number: number }) {
  const { store } = useJournal();
  const [src, setSrc] = useState("");
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt retries a failed image
  useEffect(() => {
    let live = true;
    let objectUrl: string | undefined;
    setFailed(false);
    setSrc("");
    void store
      .photo(url)
      .then((blob) => {
        if (!live) return;
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [store, url, attempt]);
  if (failed)
    return (
      <div className="jn-photo-error">
        <p>Photo {number} isn't available. Your words are still here.</p>
        <Button variant="outline" onClick={() => setAttempt((value) => value + 1)}>
          Retry photo {number}
        </Button>
      </div>
    );
  if (!src) return <LoadingSkeleton preset="detail" label={`Loading photo ${number}`} />;
  // Authenticated blobs have no remote requests, cookies or bearer credentials in the img URL.
  // biome-ignore lint/performance/noImgElement: private attachments use local object URLs
  return <img className="jn-photo" src={src} alt={`Journal attachment ${number}`} />;
}
