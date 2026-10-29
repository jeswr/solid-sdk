// AUTHORED-BY Codex
"use client";
import { useRef } from "react";

/** Programmatically opened dialogs have no Radix DialogTrigger to restore. */
export function useDialogFocus() {
  const invokingControl = useRef<HTMLElement | null>(null);
  return {
    onOpenAutoFocus() {
      invokingControl.current = document.activeElement as HTMLElement | null;
    },
    onCloseAutoFocus(event: Event) {
      event.preventDefault();
      if (invokingControl.current?.isConnected) invokingControl.current.focus();
    },
  };
}
