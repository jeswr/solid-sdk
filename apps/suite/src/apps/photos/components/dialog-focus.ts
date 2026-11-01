// AUTHORED-BY Codex GPT-6
"use client";
import { useRef } from "react";

/** Controlled dialogs have no Radix trigger to restore focus to. */
export function useDialogFocus() {
  const opener = useRef<HTMLElement | null>(null);
  return {
    onOpenAutoFocus: () => {
      opener.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
    },
    onCloseAutoFocus: (event: Event) => {
      event.preventDefault();
      if (opener.current?.isConnected && !opener.current.matches(":disabled"))
        opener.current.focus();
      else {
        const heading = document.querySelector<HTMLElement>(".pho-page h1");
        heading?.setAttribute("tabindex", "-1");
        heading?.focus();
      }
    },
  };
}
