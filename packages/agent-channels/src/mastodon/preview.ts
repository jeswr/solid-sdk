// AUTHORED-BY Codex GPT-6.1-Sol
import { previewJson, previewObject, previewText } from "../preview.js";
import type { Wire } from "../types.js";

export async function preview(wire: Wire): Promise<string> {
  const plan = previewJson(wire, "application/vnd.jeswr.mastodon-status+json", 96 * 1024);
  return previewText(previewObject(plan.request).status);
}
