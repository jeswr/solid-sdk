// AUTHORED-BY Codex
"use client";
import { useNow } from "../hooks/use-now";
import { relativeTime } from "../lib/editor/logic";

export function ModifiedTime({ value }: { value: string | undefined }) {
  const now = useNow();
  if (!value) return <span title="Unknown">—</span>;
  return (
    <time dateTime={value} title={value}>
      {now === null ? value : relativeTime(Date.parse(value), now)}
    </time>
  );
}
