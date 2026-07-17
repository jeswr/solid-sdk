// AUTHORED-BY Claude Fable 5
"use client";

import type { CSSProperties } from "react";
import type { DisclaimerPack, DisclaimerVariant } from "./disclaimers.js";
import { useDisclaimerPack } from "./trust-context.js";

export interface ConceptDemoBannerProps {
  organization: string;
  /**
   * Journey role, e.g. "consumer data custodian". Omitted → the role clause is omitted.
   * (Named `orgRole` rather than `role` so it cannot be confused with the ARIA attribute.)
   */
  orgRole?: string | undefined;
  /** "own" only for surfaces published under the convener's own branding. */
  variant?: DisclaimerVariant | undefined;
  /** Destination of the "About this demo" link; defaults to the pack's `aboutHref`. */
  aboutHref?: string | undefined;
  /**
   * "fixed" pins the banner to the bottom of the viewport (stub-compatible default for
   * layouts without `AppShell`); "static" renders it in flow — `AppShell` uses this to
   * place it directly below the brand header (four-Ps adjacency).
   */
  placement?: "fixed" | "static" | undefined;
  /** Explicit pack; defaults to the nearest `ShowcaseTrustProvider`. */
  pack?: DisclaimerPack | undefined;
}

const BASE_STYLE: CSSProperties = {
  background: "#0f172a",
  color: "#f8fafc",
  fontFamily: "ui-sans-serif, system-ui, sans-serif",
  fontSize: "0.875rem",
  lineHeight: 1.5,
  padding: "0.625rem 1rem",
  textAlign: "center",
};

const FIXED_STYLE: CSSProperties = {
  ...BASE_STYLE,
  bottom: 0,
  left: 0,
  position: "fixed",
  right: 0,
  zIndex: 50,
};

const LINK_STYLE: CSSProperties = {
  color: "#bae6fd",
  fontWeight: 600,
  marginLeft: "0.375rem",
  textDecorationLine: "underline",
  textUnderlineOffset: "2px",
};

/**
 * Deliberately self-contained CSS (no Tailwind dependency) so the banner renders correctly
 * on error pages and in apps whose stylesheet pipeline failed — the compliance surface must
 * never depend on app CSS configuration.
 */
const RESPONSIVE_CSS = [
  "[data-concept-demo-banner] [data-cdb-compact]{display:none}",
  "@media (max-width: 639px){",
  "[data-concept-demo-banner] [data-cdb-full]{display:none}",
  "[data-concept-demo-banner] [data-cdb-compact]{display:inline}",
  "}",
].join("");

/**
 * Persistent source- and offer-negation banner on every route including error pages.
 * Unremovable by design: there is no prop that hides it, and the copy comes exclusively
 * from the disclaimer pack.
 */
export function ConceptDemoBanner({
  organization,
  orgRole,
  variant = "modelled",
  aboutHref,
  placement = "fixed",
  pack,
}: ConceptDemoBannerProps) {
  const resolvedPack = useDisclaimerPack(pack);
  const href = aboutHref ?? resolvedPack.aboutHref;
  const full = resolvedPack.bannerFullCopy({ organization, role: orgRole, variant });
  const compact = resolvedPack.bannerCompactCopy({ organization, role: orgRole, variant });
  return (
    <div
      aria-label="Concept demonstration notice"
      data-concept-demo-banner=""
      role="note"
      style={placement === "fixed" ? FIXED_STYLE : BASE_STYLE}
    >
      <style>{RESPONSIVE_CSS}</style>
      <span data-cdb-full="">
        <strong>{full.lead}</strong>
        {full.rest}
        <a href={href} style={LINK_STYLE}>
          {full.aboutLabel}
        </a>
      </span>
      <span data-cdb-compact="">
        <strong>{compact.lead}</strong>
        {compact.rest}
        <a href={href} style={LINK_STYLE}>
          {compact.aboutLabel}
        </a>
      </span>
    </div>
  );
}
