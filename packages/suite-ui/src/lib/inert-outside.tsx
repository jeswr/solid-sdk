// AUTHORED-BY Claude Opus 5.5
"use client";
import { useEffect } from "react";

const MARKER = "[data-aria-hidden]";

/**
 * Radix's modal Select, DropdownMenu and ContextMenu aria-hide the rest of the page while
 * open (`aria-hidden` package, marker `data-aria-hidden`) but leave it focusable: axe
 * `aria-hidden-focus` (serious). Rendered inside such a popup, this makes exactly the nodes
 * the popup hid `inert` as well, and lifts that before Radix returns focus to the trigger
 * (FocusScope refocuses in a timeout after unmount; this cleanup runs during unmount).
 * Nodes hidden earlier by another layer (an open dialog) are left as they were.
 */
export function InertOutside() {
  useEffect(() => {
    const before = new Set(document.querySelectorAll(MARKER));
    const applied: Element[] = [];
    // Radix hides the outside from its own (parent, or next-render) effect: apply after it.
    const timer = window.setTimeout(() => {
      for (const element of document.querySelectorAll(MARKER)) {
        // Radix's focus guards must stay focusable for its own focus trapping.
        if (before.has(element) || element.hasAttribute("inert")) continue;
        if (element.hasAttribute("data-radix-focus-guard")) continue;
        element.setAttribute("inert", "");
        applied.push(element);
      }
    }, 0);
    return () => {
      window.clearTimeout(timer);
      for (const element of applied) element.removeAttribute("inert");
    };
  }, []);
  return null;
}
