/**
 * Triage vocabulary. The owner's taxonomy (urgent, needs_reply, action, waiting, read_later, fyi,
 * noise) mixes one time dimension ("urgent") with six kinds of message, so urgency is kept as a
 * SEPARATE axis: a message can be both urgent and needs_reply. Every axis has "uncertain", which
 * means "ask the owner" (the owner's rule: ask when uncertain; do not guess).
 */
import { z } from "zod";

export const PRIMARY_CLASSES = [
  "needs_reply",
  "action",
  "waiting",
  "read_later",
  "fyi",
  "noise",
] as const;
export type PrimaryClass = (typeof PRIMARY_CLASSES)[number];
export type Primary = PrimaryClass | "uncertain";

export const URGENCY_CLASSES = ["urgent", "not_urgent"] as const;
export type UrgencyClass = (typeof URGENCY_CLASSES)[number];
export type Urgency = UrgencyClass | "uncertain";

/** Generic descriptions (sent to a hosted classifier; no personal names). */
export const PRIMARY_DESCRIPTIONS: Record<PrimaryClass, string> = {
  needs_reply: "A response from the recipient is reasonably expected.",
  action: "The recipient needs to do something other than reply.",
  waiting: "The recipient is waiting on another person or event; nothing to do now.",
  read_later: "Worth reading but not time-sensitive.",
  fyi: "Useful context with no current action.",
  noise: "Low-value, repetitive or safely ignorable.",
};
export const URGENCY_DESCRIPTIONS: Record<UrgencyClass, string> = {
  urgent: "Time-sensitive and consequential for the recipient; should be surfaced immediately.",
  not_urgent: "Not time-sensitive, or not consequential.",
};

/**
 * Confidence thresholds below which a suggestion becomes "uncertain" (ask the owner).
 * UNCALIBRATED defaults: they follow the provider's general guidance (below 0.5 "don't guess",
 * above 0.9 "act") set conservatively, and have not been fitted to any labelled data.
 */
export const DEFAULT_THRESHOLDS = {
  primary: 0.8,
  urgency: 0.8,
  needsReplyYes: 0.8,
  needsReplyNo: 0.2,
} as const;

/** One message sample (plain text). Bounded; nothing here is a live message in this phase. */
export const sampleSchema = z.strictObject({
  from: z.string().max(200).optional(),
  subject: z.string().max(300),
  body: z.string().min(1).max(4000),
});
export type Sample = z.infer<typeof sampleSchema>;

export interface TriageSuggestion {
  /**
   * "agent-protocol": the text LOOKS like a structured agent message (a marker only — nothing is
   * verified here). It is never classified; the agent's protocol validation decides what it is.
   */
  route: "agent-protocol" | "suggestion";
  primary: Primary;
  /** The best guess when `primary` is uncertain (shown, never acted on). */
  primaryCandidate?: PrimaryClass;
  urgency: Urgency;
  needsReply: "yes" | "no" | "uncertain";
  /** The provider's distribution-shape statistic (or the baseline's fixed value). */
  confidence: { primary: number | null; urgency: number | null; needsReply: number | null };
  /** Probability of the chosen label (hosted answers only); differs from confidence. */
  probability?: { primary: number; urgency: number };
  /** Full hosted distributions, kept for review and evaluation. */
  distribution?: { primary: Record<string, number>; urgency: Record<string, number> };
  source: "none" | "deterministic-baseline" | "typesafe";
  model?: string;
  /** What to ask the owner (their "ask when uncertain" rule); empty = nothing uncertain. */
  askOwner: string[];
  reasons: string[];
  /** A suggestion never authorises an action. */
  mayAct: false;
  hosted: {
    status: "not-requested" | "not-allowed" | "ok" | "failed" | "invalid-response";
    detail: string;
  };
}
