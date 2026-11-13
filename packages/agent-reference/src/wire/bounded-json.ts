// AUTHORED-BY Codex GPT-6
import { assertJsonBounds, BoundsError, DEFAULT_LIMITS, type PilotLimits } from "../core/limits.js";

/**
 * Parse untrusted JSON text under the size/depth/node bounds. The nesting depth is
 * pre-scanned linearly BEFORE `JSON.parse`, so a deeply nested document cannot exhaust
 * the parser's stack; the node/string/array bounds are checked on the parsed value.
 */
export function parseBoundedJson(text: string, limits: PilotLimits = DEFAULT_LIMITS): unknown {
  if (Buffer.byteLength(text, "utf8") > limits.maxEnvelopeBytes) {
    throw new BoundsError("too-large", `JSON exceeds ${limits.maxEnvelopeBytes} bytes`);
  }
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === 0x5c) escaped = true;
      else if (ch === 0x22) inString = false;
      continue;
    }
    if (ch === 0x22) inString = true;
    else if (ch === 0x7b || ch === 0x5b) {
      depth++;
      if (depth > limits.maxJsonDepth) {
        throw new BoundsError("too-deep", `JSON nesting exceeds ${limits.maxJsonDepth}`);
      }
    } else if (ch === 0x7d || ch === 0x5d) depth--;
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new BoundsError("not-json", "input is not valid JSON");
  }
  assertJsonBounds(value, limits);
  return value;
}
