// AUTHORED-BY Codex GPT-6.1-Sol
"use client";

import { useId, useRef } from "react";
import { Button } from "../components/ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog.js";
import type { SyncConflict } from "./types.js";

export type ConflictStrategy = "mine" | "theirs" | "both";
export interface ConflictDialogProps {
  open: boolean;
  conflict: SyncConflict | null;
  onChoose: (strategy: ConflictStrategy) => void;
  onOpenChange: (open: boolean) => void;
}
export function ConflictDialog({ open, conflict, onChoose, onOpenChange }: ConflictDialogProps) {
  const both = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const id = useId();
  if (!conflict) return null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="suite-conflict-dialog"
        onOpenAutoFocus={(event) => {
          returnFocus.current =
            document.activeElement instanceof HTMLElement ? document.activeElement : null;
          event.preventDefault();
          both.current?.focus();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnFocus.current?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>This item changed somewhere else</DialogTitle>
          <DialogDescription>{conflict.summary}</DialogDescription>
        </DialogHeader>
        <p>
          <strong>{conflict.name}</strong>
          <span className="suite-sync-note">{conflict.where}</span>
        </p>
        <div className="suite-conflict-actions">
          <Button variant="outline" onClick={() => onChoose("mine")}>
            Keep mine
          </Button>
          <Button variant="outline" onClick={() => onChoose("theirs")}>
            Keep theirs
          </Button>
          <Button
            variant="outline"
            ref={both}
            aria-describedby={id}
            onClick={() => onChoose("both")}
          >
            Keep both
          </Button>
        </div>
        <p id={id} className="suite-sync-note">
          Keep both saves your version as a copy.
        </p>
      </DialogContent>
    </Dialog>
  );
}
