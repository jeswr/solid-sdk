// AUTHORED-BY Codex
"use client";

import { type ReactNode, useLayoutEffect, useRef } from "react";
import { focusDriveListing } from "./ui";

const MODAL =
  '[role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"], dialog[open]';

/** Last-resort recovery for any focused control removed inside the Drive app. */
export function DriveFocusBoundary({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const app = root.current;
    if (!app) return;
    const doc = app.ownerDocument;
    let focused: Element | null = null;
    const onFocus = () => {
      const active = doc.activeElement;
      // Include focus outside the app so an old removal cannot reclaim it later.
      focused = active && app.contains(active) && !active.closest(MODAL) ? active : null;
    };
    onFocus();
    doc.addEventListener("focusin", onFocus, true);
    const observer = new MutationObserver(() => {
      if (!focused || focused.isConnected) return;
      focused = null;
      if (!app.isConnected || doc.activeElement !== doc.body || doc.querySelector(MODAL)) return;
      // Mutation delivery follows layout effects: row-URL recovery and registered
      // control replacements get first choice, then the shared region fallbacks.
      focusDriveListing(undefined, undefined, app.querySelector("[data-drive-listing]"), app);
    });
    observer.observe(app, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      doc.removeEventListener("focusin", onFocus, true);
    };
  }, []);
  return (
    <div ref={root} style={{ display: "contents" }}>
      {children}
    </div>
  );
}
