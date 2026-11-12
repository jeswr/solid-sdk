// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
import { canonicalJson } from "@jeswr/agent-model";
import { ChannelParseError } from "../errors.js";
import { exactKeys, previewJson, previewObject, previewText } from "../preview.js";
import { DISCORD_FOOTER } from "../profiles.js";
import type { Wire } from "../types.js";

/** Closed world: content plus one footer embed; no components, polls, files or mentions. */
export async function preview(wire: Wire): Promise<string> {
  const plan = previewJson(wire, "application/json", DISCORD_FOOTER.maxBytes);
  exactKeys(plan, ["content", "embeds", "allowed_mentions", "enforce_nonce", "nonce"], "Discord");
  if (
    canonicalJson(plan.allowed_mentions) !== canonicalJson({ parse: [] }) ||
    plan.enforce_nonce !== true ||
    typeof plan.nonce !== "string" ||
    !/^[A-Za-z0-9_-]{1,25}$/.test(plan.nonce)
  )
    throw new ChannelParseError("unsupported Discord preview options");
  if (!Array.isArray(plan.embeds) || plan.embeds.length !== 1)
    throw new ChannelParseError("unsupported Discord preview embeds");
  const embed = previewObject(plan.embeds[0]);
  exactKeys(embed, ["footer"], "Discord embed");
  const footerObject = previewObject(embed.footer);
  exactKeys(footerObject, ["text"], "Discord footer");
  const footer = previewText(footerObject.text);
  const content = previewText(plan.content);
  if (content.length > 2000 || footer.length > 2048)
    throw new ChannelParseError("Discord preview exceeds text limit");
  return `${content}\n${footer}`;
}
