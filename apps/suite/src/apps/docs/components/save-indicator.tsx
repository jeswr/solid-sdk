// AUTHORED-BY Codex
"use client";
import { Check } from "lucide-react";
import { useEffect, useRef, useState } from "react";
/** Visual feedback follows every write; saved announcements are capped at once per 30 seconds. */
export function SaveIndicator({ status }: { status: string }) {
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
  return (
    <div className="docs-save" role="status" aria-live="polite" title={status}>
      <Check size={16} aria-hidden="true" />
      <span aria-hidden="true">{status}</span>
      <span className="sr-only">{announcement}</span>
    </div>
  );
}
