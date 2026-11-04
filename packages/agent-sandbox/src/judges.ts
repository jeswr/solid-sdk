// AUTHORED-BY Claude Opus 5.5
// A stand-in for the "llm" and "hybrid" modes when no model is connected. It is NOT a model:
// it looks for a few words, and says so in every answer. Pages must label it as a stand-in and
// offer a real model (the visitor's own key) for honest comparisons.
import type { JudgeModel } from "./types.js";

const MARKETING =
  /(% off|\bupgrade\b|\boffer\b|\bpromotion\b|\bdiscount\b|\bsale\b|premium plan|limited time|this week only)/i;
const DESTRUCTIVE = /\b(delete|drop|truncate|wipe)\b/i;

/** The keyword stand-in for a judging model. */
export const standInJudge: JudgeModel = {
  name: "Stand-in judge (keyword rules, not a model)",
  async complete(system: string, prompt: string): Promise<string> {
    if (system.startsWith("Classify")) {
      const message = prompt.slice(prompt.indexOf("Message:"));
      if (!MARKETING.test(message)) return JSON.stringify({ purpose: null });
      const line = prompt.split("\n").find((l) => /marketing/i.test(l) && l.startsWith("- "));
      const iri = line?.slice(2).split(" ")[0];
      return JSON.stringify({ purpose: iri ?? null });
    }
    const proposed = prompt.slice(prompt.indexOf("Proposed action:"));
    if (DESTRUCTIVE.test(proposed))
      return JSON.stringify({
        outcome: "stop",
        reason: "the action looks destructive (it mentions deleting).",
      });
    return JSON.stringify({
      outcome: "permit",
      reason: "nothing in the action looked risky to a keyword check.",
    });
  },
};
