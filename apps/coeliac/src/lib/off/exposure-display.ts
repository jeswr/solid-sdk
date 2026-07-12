// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * Presentation mapping for derived exposures — pure, testable. NEVER a bare green
 * "safe" tick (DESIGN §10.4): a product with no detected tracked trigger still
 * gets the "verify against the packet" honesty framing, and OFF data-quality is
 * surfaced so the user judges the data rather than trusting a colour.
 */
import type { ExposureLevel } from "@jeswr/solid-health-diary";

/** A UI tone for an exposure level (drives colour + wording, never a lone tick). */
export type ExposureTone = "danger" | "warn" | "caution" | "info";

export interface ExposureDisplay {
  tone: ExposureTone;
  label: string;
}

const LEVEL_DISPLAY: Record<ExposureLevel, ExposureDisplay> = {
  present: { tone: "danger", label: "Contains" },
  trace: { tone: "warn", label: "May contain (traces)" },
  "possible-undeclared": { tone: "caution", label: "Possibly undeclared" },
  absent: { tone: "info", label: "Not detected" },
};

/** The display for an exposure level. */
export function exposureDisplay(level: ExposureLevel): ExposureDisplay {
  return LEVEL_DISPLAY[level];
}

/** A friendly, capitalised label for a trigger slug (e.g. `sulphites` → "Sulphites"). */
export function triggerLabel(trigger: string): string {
  return trigger
    .split("-")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

/**
 * A short, honest data-quality caveat from OFF `data_quality_tags` +
 * completeness. Always returns SOMETHING (never silence implying "safe").
 */
export function dataQualityNote(input: {
  found: boolean;
  dataQualityTags: readonly string[];
  completeness?: number;
  lastEdit?: string;
}): string {
  if (!input.found) {
    return "This barcode isn't in Open Food Facts — enter the details by hand and always read the packet.";
  }
  const flags: string[] = [];
  if (input.completeness !== undefined && input.completeness < 0.5) {
    flags.push("this entry is incomplete");
  }
  if (input.dataQualityTags.some((t) => t.includes("to-be-completed") || t.includes("to-be-checked"))) {
    flags.push("some fields are unverified");
  }
  const base =
    "Open Food Facts is crowdsourced and can be wrong or out of date — always verify against the packet.";
  return flags.length ? `${base} Note: ${flags.join("; ")}.` : base;
}
