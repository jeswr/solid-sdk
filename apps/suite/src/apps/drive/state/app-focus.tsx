// AUTHORED-BY Codex
"use client";

import { type ReactNode, useLayoutEffect, useRef } from "react";
import { focusDriveListing } from "./ui";

const MODAL =
  '[role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"], dialog[open]';
const OVERLAY = '[role="menu"], [role="listbox"], [role="dialog"], [role="alertdialog"]';

function hidden(element: HTMLElement) {
  const style = getComputedStyle(element);
  return (
    Boolean(element.closest("[hidden], [inert]")) ||
    style.display === "none" ||
    ["hidden", "collapse"].includes(style.visibility)
  );
}

function usable(element: Element | null | undefined): element is HTMLElement {
  return (
    element instanceof HTMLElement &&
    element.isConnected &&
    !hidden(element) &&
    element.getClientRects().length > 0
  );
}

type OwnedFocus = {
  element: HTMLElement;
  overlay: HTMLElement | null;
  beforeOpen: HTMLElement | null;
};

/** Last-resort recovery for removed controls, including Drive's React portals. */
export function DriveFocusBoundary({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  const focused = useRef<OwnedFocus | null>(null);
  useLayoutEffect(() => {
    const app = root.current;
    if (!app) return;
    const doc = app.ownerDocument;
    let recovery: ReturnType<typeof setTimeout> | undefined;
    const onFocus = () => {
      const active = doc.activeElement;
      // React's capture handler runs for owned portals before this document listener.
      // A deliberate move outside Drive cancels any pending close recovery.
      if (active && (app.contains(active) || focused.current?.overlay?.contains(active))) return;
      focused.current = null;
      clearTimeout(recovery);
    };
    doc.addEventListener("focusin", onFocus);
    const observer = new MutationObserver(() => {
      const saved = focused.current;
      if (!saved) return;
      if (saved.overlay) {
        if (
          saved.overlay.isConnected &&
          !hidden(saved.overlay) &&
          saved.overlay.dataset.state !== "closed"
        )
          return;
        clearTimeout(recovery);
        // Radix runs close autofocus in a timer after portal removal. Let its
        // visible trigger win before trying the pre-open control and regions.
        recovery = setTimeout(() => {
          if (
            !app.isConnected ||
            (doc.activeElement !== doc.body && usable(doc.activeElement)) ||
            [...doc.querySelectorAll<HTMLElement>(MODAL)].some(
              (modal) => modal.dataset.state !== "closed" && !hidden(modal),
            )
          )
            return;
          focused.current = null;
          for (const target of [
            saved.beforeOpen,
            app.querySelector("[data-drive-listing]"),
            app.querySelector('main, [role="main"]'),
          ]) {
            if (!usable(target)) continue;
            target.focus();
            if (doc.activeElement === target) break;
          }
        }, 0);
        return;
      }
      if (saved.element.isConnected) return;
      focused.current = null;
      if (!app.isConnected || doc.activeElement !== doc.body || doc.querySelector(MODAL)) return;
      // Mutation delivery follows layout effects: row-URL recovery and registered
      // control replacements get first choice, then the shared region fallbacks.
      focusDriveListing(undefined, undefined, app.querySelector("[data-drive-listing]"), app);
    });
    observer.observe(doc.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["hidden", "inert", "style", "data-state"],
    });
    return () => {
      clearTimeout(recovery);
      observer.disconnect();
      doc.removeEventListener("focusin", onFocus);
    };
  }, []);
  return (
    <div
      ref={root}
      style={{ display: "contents" }}
      onFocusCapture={(event) => {
        const element = event.target;
        const overlay = element.closest<HTMLElement>(OVERLAY);
        const previous = focused.current;
        focused.current = {
          element,
          overlay,
          beforeOpen: overlay
            ? previous?.overlay
              ? previous.beforeOpen
              : (previous?.element ?? null)
            : null,
        };
      }}
    >
      {children}
    </div>
  );
}
