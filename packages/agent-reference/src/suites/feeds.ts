// AUTHORED-BY Codex GPT-6
/** Specification 10–19, “Which checks draw on it”. Transport admits no verdict variation (CORE-L-8). */

import type { Check } from "../trace/types.js";
import type { LayerId } from "./registry.js";
export const LAYER_FEEDS: Readonly<Record<LayerId, readonly Check[]>> = {
  transport: [],
  "data-access": ["disclosure", "data-terms", "source", "fitness"],
  identity: ["integrity", "recipient", "authority"],
  meaning: ["terms", "fitness", "disclosure"],
  authority: ["authority", "mandate", "limits-approval"],
  authenticity: ["integrity", "source", "fitness", "disclosure", "evidence"],
  trust: ["source", "authority", "recipient"],
  reliance: ["fitness", "evidence"],
  "usage-control": ["terms", "mandate", "disclosure", "data-terms"],
  commitments: ["limits-approval", "authority", "evidence"],
  // Every check is recorded, but the only verdict this layer feeds is the evidence check.
  accountability: ["evidence"],
};
