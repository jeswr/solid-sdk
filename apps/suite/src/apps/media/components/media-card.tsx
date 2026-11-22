// AUTHORED-BY Codex (GPT-6.1 Sol)
// AUTHORED-BY Codex GPT-6
"use client";
import { createGuardedFetch } from "@jeswr/guarded-fetch";
import type { MediaRecord } from "@jeswr/solid-media-log";
import { Button } from "@jeswr/suite-ui";
import { BookOpen, Clapperboard, Gamepad2, Tv } from "lucide-react";
import Image from "next/image";
import { type ReactNode, useEffect, useState } from "react";
import { KIND_LABELS, STATUS_LABELS } from "../lib/view";

const fetchCover = createGuardedFetch({
  fetch: (input, init) => globalThis.fetch(input, init),
  dnsLookup: null,
  maxRedirects: 0,
  maxBytes: 2 * 1024 * 1024,
  allowedContentTypes: ["image/jpeg", "image/png", "image/webp", "image/avif", "image/gif"],
});

function Cover({ url, children }: { url: string; children: ReactNode }) {
  const [requested, setRequested] = useState(false);
  const [source, setSource] = useState<string>();
  useEffect(() => {
    if (!requested) return;
    const controller = new AbortController();
    let objectUrl: string | undefined;
    void (async () => {
      try {
        const response = await fetchCover(url, {
          signal: controller.signal,
          credentials: "omit",
          referrerPolicy: "no-referrer",
          redirect: "error",
        });
        if (!response.ok || !response.body) return;
        const blob = await response.blob();
        if (controller.signal.aborted || blob.size === 0) return;
        objectUrl = URL.createObjectURL(blob);
        setSource(objectUrl);
      } catch {
        // Keep the shelf's placeholder when the cover cannot be loaded safely.
      }
    })();
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [requested, url]);
  if (source)
    return (
      <Image
        unoptimized
        width={400}
        height={300}
        src={source}
        alt=""
        onError={() => setSource(undefined)}
      />
    );
  return (
    <>
      {children}
      {!requested && (
        <Button size="sm" variant="ghost" onClick={() => setRequested(true)}>
          Load cover
        </Button>
      )}
    </>
  );
}

export function MediaCard({
  record,
  offline,
  onEdit,
  onFinish,
}: {
  record: MediaRecord;
  offline: boolean;
  onEdit: () => void;
  onFinish: () => void;
}) {
  const item = record.data;
  const Icon =
    item.kind === "film"
      ? Clapperboard
      : item.kind === "book"
        ? BookOpen
        : item.kind === "game"
          ? Gamepad2
          : Tv;
  const placeholder = (
    <>
      <Icon size={36} strokeWidth={1.3} aria-hidden="true" />
      <span>{KIND_LABELS[item.kind]}</span>
    </>
  );
  return (
    <article className="media-card">
      <div className="media-cover" data-kind={item.kind}>
        {item.cover ? (
          <Cover key={item.cover} url={item.cover}>
            {placeholder}
          </Cover>
        ) : (
          placeholder
        )}
      </div>
      <div className="media-card-body">
        <p className="media-eyebrow">
          {STATUS_LABELS[item.status]}
          {item.year ? ` · ${item.year}` : ""}
        </p>
        <h3>{item.title}</h3>
        {item.creator && <p className="media-muted">{item.creator}</p>}
        {item.rating !== undefined && (
          <p className="media-rating">
            ★ {item.rating.toFixed(1)}
            <span className="media-muted"> / 5</span>
          </p>
        )}
        {item.progress !== undefined && (
          <p className="media-muted">
            {item.progressUnit === "episode"
              ? "Episode"
              : item.progressUnit === "page"
                ? "Page"
                : "Progress"}{" "}
            {item.progress}
          </p>
        )}
        {(item.repeatCount ?? 0) > 0 && (
          <p className="media-muted">
            {item.repeatCount} repeat{item.repeatCount === 1 ? "" : "s"}
          </p>
        )}
        {item.finished && (
          <p className="media-muted">
            Finished{" "}
            {new Intl.DateTimeFormat("en-GB", {
              day: "numeric",
              month: "short",
              year: "numeric",
              timeZone: "UTC",
            }).format(new Date(item.finished))}
          </p>
        )}
        {item.review && <p className="media-review">{item.review}</p>}
        <p className="media-source media-muted">
          {item.source ?? "Manual"}
          {!record.url && item.source !== "Manual" && item.source !== "Imported"
            ? " · imported"
            : ""}
        </p>
        {record.unconfirmed && (
          <p className="media-muted" role="status">
            Saved · awaiting confirmation. Refresh before editing again.
          </p>
        )}
        <div className="media-card-actions">
          <Button
            size="sm"
            variant="outline"
            onClick={onEdit}
            aria-label={`Edit & review ${item.title}`}
          >
            Edit & review
          </Button>
          {item.status !== "finished" && (
            <Button
              size="sm"
              variant="ghost"
              onClick={onFinish}
              disabled={offline}
              aria-label={`Mark finished: ${item.title}`}
            >
              Mark finished
            </Button>
          )}
        </div>
      </div>
    </article>
  );
}
