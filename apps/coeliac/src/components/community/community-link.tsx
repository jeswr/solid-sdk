// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
"use client";
/**
 * An accessible external community link with a leaving-the-app interstitial
 * (design §3.1, rail §2). Built to the `accessible-html-links` skill:
 *
 *  - It is a native `<a href>` — never a `<div onclick>` / `<span role=link>`.
 *    The real `href` stays on the element, so right-click / middle-click /
 *    "open in new tab" / keyboard activation all keep working and the URL is
 *    inspectable by assistive tech.
 *  - `target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer"` on
 *    BOTH the trigger and the interstitial's Continue link, so no in-app URL,
 *    path, or referrer travels to the destination (rail §2 — the one leak the
 *    app can control; the DNS/SNI metadata of *visiting* a coeliac site is
 *    acknowledged as unavoidable in the design and not claimed away).
 *  - Descriptive link text (WCAG 2.4.4) + a visible "external site, new tab"
 *    affordance.
 *
 * A plain left-click is intercepted to show a brief interstitial ("you're
 * leaving for an external community; it's not moderated by this app; not medical
 * advice") BEFORE hand-off; the actual navigation happens only via the
 * interstitial's own native Continue anchor. Modified clicks (ctrl/cmd/middle)
 * pass straight through to the browser so power-user affordances are preserved.
 *
 * This surfaces NO app-stored health data and fetches nothing — it is a pure
 * link-out.
 */
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { CommunityLinkEntry } from "@/lib/community/communities";

/** The interstitial warning shown before leaving for an external community. */
export const EXTERNAL_COMMUNITY_NOTICE =
  "You're leaving for an external community. It's not moderated by this app, and posts are personal experience — not medical advice.";

export function CommunityLink({ entry }: { entry: CommunityLinkEntry }) {
  const [open, setOpen] = useState(false);
  const dialogId = useId();
  const titleId = `${dialogId}-title`;
  const continueRef = useRef<HTMLAnchorElement | null>(null);
  const triggerRef = useRef<HTMLAnchorElement | null>(null);

  const close = useCallback(() => {
    setOpen(false);
    // Return focus to the trigger for keyboard users.
    triggerRef.current?.focus();
  }, []);

  // Focus the Continue action + wire Escape-to-close while the interstitial is open.
  useEffect(() => {
    if (!open) return;
    continueRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, close]);

  const handleTriggerClick = useCallback((e: React.MouseEvent<HTMLAnchorElement>) => {
    // Let modified / non-primary clicks (ctrl/cmd/shift/alt, middle-click) reach
    // the browser so "open in new tab" etc. keep working.
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    setOpen(true);
  }, []);

  return (
    <>
      <a
        ref={triggerRef}
        className="community-link__go"
        href={entry.url}
        target="_blank"
        rel="noopener noreferrer"
        referrerPolicy="no-referrer"
        onClick={handleTriggerClick}
        aria-haspopup="dialog"
      >
        Visit {entry.name}
        <span className="community-link__ext"> (external site, opens in a new tab)</span>
      </a>

      {open ? (
        <div
          className="community-interstitial"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby={titleId}
        >
          <div className="community-interstitial__panel">
            <h3 id={titleId} className="community-interstitial__title">
              Leaving for {entry.org}
            </h3>
            <p className="community-interstitial__notice">{EXTERNAL_COMMUNITY_NOTICE}</p>
            <p className="community-interstitial__where">
              You&apos;re about to open <strong>{entry.name}</strong>, moderated by {entry.moderatedBy}.
            </p>
            <div className="community-interstitial__actions">
              <a
                ref={continueRef}
                className="btn btn--primary"
                href={entry.url}
                target="_blank"
                rel="noopener noreferrer"
                referrerPolicy="no-referrer"
                onClick={() => setOpen(false)}
              >
                Continue to {entry.org}
              </a>
              <button type="button" className="btn" onClick={close}>
                Stay in the app
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
