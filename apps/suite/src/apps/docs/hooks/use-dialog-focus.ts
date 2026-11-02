// AUTHORED-BY Codex
"use client";
import { useRef } from "react";

/** Programmatically opened dialogs have no Radix DialogTrigger to restore. */
export function useDialogFocus(fallback?: () => HTMLElement | null) {
  const invokingControl = useRef<HTMLElement | null>(null);
  return {
    onOpenAutoFocus() {
      invokingControl.current = document.activeElement as HTMLElement | null;
    },
    onCloseAutoFocus(event: Event) {
      event.preventDefault();
      const target = invokingControl.current?.isConnected ? invokingControl.current : fallback?.();
      target?.focus();
    },
  };
}
