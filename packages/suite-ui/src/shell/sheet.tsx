// AUTHORED-BY Codex GPT-6.1-Sol
"use client";

import { Dialog } from "radix-ui";
import { X } from "lucide-react";
import type { ReactNode } from "react";

/** Shell-only shadcn Sheet anatomy; Radix owns modality, Escape and focus trapping. */
export function ShellSheet({
  id,
  open,
  onOpenChange,
  side,
  title,
  children,
  restoreFocus,
}: {
  id: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  side: "left" | "right";
  title: string;
  children: ReactNode;
  restoreFocus: () => void;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="suite-sheet-overlay" />
        <Dialog.Content
          id={id}
          className={`suite-sheet suite-sheet-${side}`}
          aria-describedby={undefined}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            restoreFocus();
          }}
        >
          <div className="suite-sheet-heading">
            <Dialog.Title>{title}</Dialog.Title>
            <Dialog.Close
              className="suite-icon-button"
              aria-label={`Close ${title.toLowerCase()}`}
              title="Close (Esc)"
            >
              <X size={20} strokeWidth={1.75} aria-hidden="true" />
            </Dialog.Close>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
