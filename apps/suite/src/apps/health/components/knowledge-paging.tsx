// AUTHORED-BY Claude Sonnet 5.5
"use client";
import { Button } from "@jeswr/suite-ui";
import { useState } from "react";
import { KNOWLEDGE_PAGE_SIZE } from "../lib/knowledge/view-model";

/** Shows the first page of a list and a "Show more" action, so a large graph never mounts at once. */
export function usePaged<T>(items: readonly T[], size = KNOWLEDGE_PAGE_SIZE) {
  const [pages, setPages] = useState(1);
  const shown = Math.min(items.length, pages * size);
  return {
    visible: items.slice(0, shown),
    remaining: items.length - shown,
    more: () => setPages((p) => p + 1),
  };
}
export function ShowMore({
  remaining,
  noun,
  onMore,
}: {
  remaining: number;
  noun: string;
  onMore(): void;
}) {
  if (remaining <= 0) return null;
  return (
    <Button variant="outline" onClick={onMore}>
      Show more {noun} ({remaining} remaining)
    </Button>
  );
}
/** The caveat the memory package documents for a claim whose later update could not be read. */
export function UncertaintyBadge({ note }: { note: string }) {
  return note ? (
    <>
      <span className="hlt-knowledge-badge">May be out of date</span>
      <span className="hlt-small hlt-muted">{note}</span>
    </>
  ) : null;
}
