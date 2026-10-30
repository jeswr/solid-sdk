// AUTHORED-BY Codex
"use client";
import { Check, LoaderCircle, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { SaveState } from "../lib/editor/logic";
/** Visual feedback follows every write; saved announcements are capped at once per 30 seconds. */
export function SaveIndicator({ status, state }: { status: string; state: SaveState }) {
  const [announcement, setAnnouncement] = useState("");
  const lastSaved = useRef(0);
  useEffect(() => {
    if (status.startsWith("Saved to your pod")) {
      const now = Date.now();
      if (now - lastSaved.current < 30_000) {
        setAnnouncement("");
        return;
      }
      lastSaved.current = now;
    }
    setAnnouncement(status);
  }, [status]);
  const Icon = state === "saved" ? Check : state === "saving" ? LoaderCircle : TriangleAlert;
  return (
    <div className="docs-save" data-state={state} role="status" aria-live="polite" title={status}>
      <Icon size={16} aria-hidden="true" />
      <span aria-hidden="true">{status}</span>
      <span className="sr-only">{announcement}</span>
    </div>
  );
}
