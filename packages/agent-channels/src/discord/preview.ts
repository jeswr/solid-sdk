// AUTHORED-BY Codex GPT-6.1-Sol
import { ChannelParseError } from "../errors.js";
import { previewJson, previewObject, previewText } from "../preview.js";
import { DISCORD_FOOTER } from "../profiles.js";
import type { Wire } from "../types.js";

export async function preview(wire: Wire): Promise<string> {
  const plan = previewJson(wire, "application/json", DISCORD_FOOTER.maxBytes);
  if (!Array.isArray(plan.embeds) || plan.embeds.length !== 1)
    throw new ChannelParseError("unsupported Discord preview embeds");
  const embed = previewObject(plan.embeds[0]);
  if (Object.keys(embed).join() !== "footer")
    throw new ChannelParseError("unsupported Discord preview embed");
  const footer = previewText(previewObject(embed.footer).text);
  const content = previewText(plan.content);
  if (content.length > 2000 || footer.length > 2048)
    throw new ChannelParseError("Discord preview exceeds text limit");
  return `${content}\n${footer}`;
}
