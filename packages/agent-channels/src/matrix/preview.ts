// AUTHORED-BY Codex GPT-6.1-Sol
import { ChannelParseError } from "../errors.js";
import { previewJson, previewObject, previewText } from "../preview.js";
import { MATRIX_CONTENT } from "../profiles.js";
import type { Wire } from "../types.js";

export async function preview(wire: Wire): Promise<string> {
  const plan = previewJson(wire, "application/json", MATRIX_CONTENT.maxBytes);
  const content = previewObject(plan.content);
  if (content.msgtype !== "m.text" || "formatted_body" in content)
    throw new ChannelParseError("unsupported Matrix preview content");
  return previewText(content.body);
}
