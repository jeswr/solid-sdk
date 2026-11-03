// AUTHORED-BY Codex GPT-6.1-Sol
import type { IncomingMessage, ServerResponse } from "node:http";
import { configuredRelay } from "../src/config.js";

let relay: ReturnType<typeof configuredRelay> | undefined;
/** Vercel Node function; preserves raw bytes for Content-Digest verification. */
export default function handler(request: IncomingMessage, response: ServerResponse) {
  relay ??= configuredRelay();
  return relay.handler(request, response);
}
