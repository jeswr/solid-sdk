// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import type { IncomingMessage, ServerResponse } from "node:http";
import { productionRelay } from "../src/config.js";

let relay: ReturnType<typeof productionRelay> | undefined;
/** Vercel Node function; preserves raw bytes for Content-Digest verification. */
export default function handler(request: IncomingMessage, response: ServerResponse) {
  relay ??= productionRelay();
  return relay.handler(request, response);
}
