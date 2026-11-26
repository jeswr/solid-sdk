// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
import { ChannelParseError } from "../errors.js";
import { bounded, exactKeys, previewJson, previewObject, previewText } from "../preview.js";
import type { Wire } from "../types.js";

/** Closed world: a direct status with no spoiler, poll, media or other request fields. */
export async function preview(wire: Wire): Promise<string> {
  const plan = previewJson(wire, "application/vnd.jeswr.mastodon-status+json", 96 * 1024);
  exactKeys(plan, ["instance", "account", "compactJws", "request"], "Mastodon");
  const request = previewObject(plan.request);
  exactKeys(request, ["status", "visibility"], "Mastodon request");
  if (request.visibility !== "direct")
    throw new ChannelParseError("unsupported Mastodon preview visibility");
  return bounded(previewText(request.status));
}
