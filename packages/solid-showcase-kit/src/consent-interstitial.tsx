// AUTHORED-BY Claude Fable 5
"use client";

import {
  type CSSProperties,
  Fragment,
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import {
  type DisclaimerPack,
  type DisclaimerVariant,
  INTERSTITIAL_CONTINUE_LABEL,
  INTERSTITIAL_HEADING,
  INTERSTITIAL_LEARN_MORE_LABEL,
} from "./disclaimers.js";
import { useDisclaimerPack } from "./trust-context.js";

export interface ConsentInterstitialProps {
  organization: string;
  /** Stable per-app slug used in the consent cookie name, e.g. "wallet". */
  appId: string;
  /** "own" only for surfaces published under the convener's own branding. */
  variant?: DisclaimerVariant | undefined;
  /** Destination of "Learn more about the project" (the tour/shell app). */
  learnMoreHref?: string | undefined;
  /** Explicit pack; defaults to the nearest `ShowcaseTrustProvider`. */
  pack?: DisclaimerPack | undefined;
}

const CONSENT_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

function hasConsentCookie(cookiePrefix: string, appId: string): boolean {
  return document.cookie.split("; ").some((entry) => entry.startsWith(`${cookiePrefix}${appId}=`));
}

const OVERLAY_STYLE: CSSProperties = {
  alignItems: "center",
  background: "rgba(15, 23, 42, 0.6)",
  display: "flex",
  inset: 0,
  justifyContent: "center",
  overflowY: "auto",
  padding: "1.5rem",
  position: "fixed",
  zIndex: 100,
};

const PANEL_STYLE: CSSProperties = {
  background: "#ffffff",
  borderRadius: "0.75rem",
  boxShadow: "0 20px 50px rgba(15, 23, 42, 0.35)",
  color: "#0f172a",
  fontFamily: "ui-sans-serif, system-ui, sans-serif",
  fontSize: "0.9375rem",
  lineHeight: 1.6,
  margin: "auto",
  maxHeight: "100%",
  maxWidth: "40rem",
  overflowY: "auto",
  padding: "2rem",
};

const HEADING_STYLE: CSSProperties = {
  fontSize: "1.375rem",
  fontWeight: 700,
  lineHeight: 1.3,
  margin: "0 0 1rem",
};

const PARAGRAPH_STYLE: CSSProperties = {
  margin: "0 0 0.875rem",
};

const ACTIONS_STYLE: CSSProperties = {
  alignItems: "center",
  display: "flex",
  flexWrap: "wrap",
  gap: "1rem",
  marginTop: "1.25rem",
};

const CONTINUE_STYLE: CSSProperties = {
  background: "#0f172a",
  border: "none",
  borderRadius: "0.5rem",
  color: "#f8fafc",
  cursor: "pointer",
  fontSize: "0.9375rem",
  fontWeight: 600,
  padding: "0.625rem 1.25rem",
};

const LEARN_MORE_STYLE: CSSProperties = {
  color: "#1d4ed8",
  fontWeight: 500,
  textDecorationLine: "underline",
  textUnderlineOffset: "2px",
};

/**
 * Consent interstitial: first visit per app, cookie-persisted, affirmative continue.
 * Server-renders open (fail-safe: shows when consent is unknown) and closes on mount when
 * the consent cookie is present. Blocks interaction until acknowledged; Escape does not
 * dismiss it — continuing must be affirmative. The four-paragraph copy structure comes
 * from the disclaimer pack and is fixed by design.
 */
export function ConsentInterstitial({
  organization,
  appId,
  variant = "modelled",
  learnMoreHref = "/",
  pack,
}: ConsentInterstitialProps) {
  const resolvedPack = useDisclaimerPack(pack);
  const cookiePrefix = resolvedPack.consentCookiePrefix;
  const [open, setOpen] = useState(true);
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const headingId = useId();

  useEffect(() => {
    // Re-evaluate consent for the CURRENT appId/cookiePrefix: close when this app has
    // stored consent, and RE-OPEN when it does not — a component reused across apps must
    // enforce the per-app acknowledgement, not inherit a previous app's dismissal.
    setOpen(!hasConsentCookie(cookiePrefix, appId));
  }, [cookiePrefix, appId]);

  useEffect(() => {
    if (!open) return;
    previouslyFocused.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panelRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
      previouslyFocused.current?.focus();
    };
  }, [open]);

  const accept = useCallback(() => {
    // biome-ignore lint/suspicious/noDocumentCookie: Cookie Store API is not available in all supported browsers; this writes same-origin consent state only.
    document.cookie = `${cookiePrefix}${appId}=1; path=/; max-age=${CONSENT_COOKIE_MAX_AGE_SECONDS}; samesite=lax`;
    setOpen(false);
  }, [cookiePrefix, appId]);

  const trapFocus = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Tab") return;
    const panel = panelRef.current;
    if (panel === null) return;
    const focusable = panel.querySelectorAll<HTMLElement>("a[href], button:not([disabled])");
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (first === undefined || last === undefined) return;
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === panel)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }, []);

  if (!open) return null;

  return (
    <div data-consent-interstitial="" style={OVERLAY_STYLE}>
      <div
        aria-labelledby={headingId}
        aria-modal="true"
        onKeyDown={trapFocus}
        ref={panelRef}
        role="dialog"
        style={PANEL_STYLE}
        tabIndex={-1}
      >
        <h2 id={headingId} style={HEADING_STYLE}>
          {INTERSTITIAL_HEADING}
        </h2>
        {resolvedPack.interstitialParagraphs(organization, variant).map((paragraph) => (
          <p key={paragraph.map((segment) => segment.text).join("")} style={PARAGRAPH_STYLE}>
            {paragraph.map((segment) =>
              segment.strong === true ? (
                <strong key={segment.text}>{segment.text}</strong>
              ) : (
                <Fragment key={segment.text}>{segment.text}</Fragment>
              ),
            )}
          </p>
        ))}
        <div style={ACTIONS_STYLE}>
          <button onClick={accept} style={CONTINUE_STYLE} type="button">
            {INTERSTITIAL_CONTINUE_LABEL}
          </button>
          <a href={learnMoreHref} style={LEARN_MORE_STYLE}>
            {INTERSTITIAL_LEARN_MORE_LABEL}
          </a>
        </div>
      </div>
    </div>
  );
}
