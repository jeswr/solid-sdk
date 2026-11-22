// AUTHORED-BY Codex (GPT-6.1 Sol)
"use client";
import type { MediaRecord } from "@jeswr/solid-media-log";
import { Button } from "@jeswr/suite-ui";
import { BookOpen, Clapperboard, Gamepad2, Tv } from "lucide-react";
import Image from "next/image";
import { useState } from "react";
import { KIND_LABELS, STATUS_LABELS } from "../lib/view";
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
  const [broken, setBroken] = useState(false);
  const item = record.data;
  const Icon =
    item.kind === "film"
      ? Clapperboard
      : item.kind === "book"
        ? BookOpen
        : item.kind === "game"
          ? Gamepad2
          : Tv;
  return (
    <article className="media-card">
      <div className="media-cover" data-kind={item.kind}>
        {item.cover && !broken ? (
          <Image
            unoptimized
            width={400}
            height={300}
            src={item.cover}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setBroken(true)}
          />
        ) : (
          <>
            <Icon size={36} strokeWidth={1.3} aria-hidden="true" />
            <span>{KIND_LABELS[item.kind]}</span>
          </>
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
