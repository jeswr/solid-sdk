// AUTHORED-BY Codex GPT-6.1-Sol
import { createFeedbackHandlers } from "@/feedback/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const handlers = createFeedbackHandlers({ env: process.env });
export function POST(request: Request) {
  return handlers.audio(request);
}
export function OPTIONS(request: Request) {
  return handlers.options(request);
}
