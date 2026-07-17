// AUTHORED-BY Claude Fable 5
"use client";

import type { CSSProperties, ReactNode } from "react";
import { type DisclaimerPack, ILLUSTRATIVE_FIGURE_TAG } from "./disclaimers.js";
import { useShowcaseTrust } from "./trust-context.js";

export interface IllustrativeFigureProps {
  /** The rendered rate/fee/payment/decision, e.g. "6.875%". */
  children: ReactNode;
  /** Explicit pack; defaults to the nearest `ShowcaseTrustProvider`, then the default tag. */
  pack?: DisclaimerPack | undefined;
}

const TAG_STYLE: CSSProperties = {
  fontSize: "0.75em",
  fontWeight: 400,
};

/**
 * Illustrative-figure tag: wraps any rendered rate, fee, payment, or decision so the
 * qualifier sits in the same element and travels with the number into any screenshot.
 * Self-contained inline styles by design. The tag ALWAYS renders — without a provider it
 * falls back to the default wording rather than dropping the qualifier.
 */
export function IllustrativeFigure({ children, pack }: IllustrativeFigureProps) {
  const trust = useShowcaseTrust();
  const tag = pack?.illustrativeTag ?? trust?.pack.illustrativeTag ?? ILLUSTRATIVE_FIGURE_TAG;
  return (
    <span data-illustrative-figure="">
      {children}
      <span style={TAG_STYLE}>{` — ${tag}`}</span>
    </span>
  );
}
