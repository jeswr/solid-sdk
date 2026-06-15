// AUTHORED-BY Claude Opus 4.8
"use client";

import { Check, CloudOff, Loader2 } from "lucide-react";
import type { SaveState } from "@/lib/use-issues";

/**
 * A small, non-intrusive pill that reflects the state of in-flight pod writes
 * (pss-w29w): "Saving…" while a board mutation is persisting, a brief "Saved"
 * on success, and "Save failed" on error. Hidden when idle so it never clutters
 * the UI. Lives in a fixed corner so it follows the user across scroll/views.
 */
export function SaveIndicator({ state }: { state: SaveState }) {
  if (state === "idle") return null;

  const config = {
    saving: { icon: <Loader2 className="size-3.5 animate-spin" aria-hidden />, label: "Saving…", tone: "text-muted-foreground" },
    saved: { icon: <Check className="size-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden />, label: "Saved", tone: "text-foreground" },
    error: { icon: <CloudOff className="size-3.5 text-destructive" aria-hidden />, label: "Save failed", tone: "text-destructive" },
  }[state];

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed bottom-20 right-4 z-40 flex items-center gap-1.5 rounded-full border bg-card/95 px-3 py-1.5 text-xs font-medium shadow-md backdrop-blur md:bottom-6"
    >
      {config.icon}
      <span className={config.tone}>{config.label}</span>
    </div>
  );
}
